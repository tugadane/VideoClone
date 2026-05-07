import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta


class VideoCloner:
    def __init__(self, ffmpeg_path, source, options, on_progress=None, on_complete=None, on_error=None):
        self.ffmpeg_path = ffmpeg_path
        self.source = source
        self.options = options
        self.on_progress = on_progress
        self.on_complete = on_complete
        self.on_error = on_error
        self.cancelled = False
        self.thread = None
        self._process = None
        self._text_overlay_cwd = None
        # Track all currently-running ffmpeg subprocesses so cancel() can kill
        # parallel pre-pass jobs in addition to the main clone process.
        self._wm_processes = []
        self._wm_lock = threading.Lock()

        # Build list of (source_path, count) pairs — supports both old and new format
        sources = options.get('sources')
        if sources:
            self._sources = [(s['filepath'], s['count']) for s in sources]
            self._source_platforms = {s['filepath']: s.get('source_platform') for s in sources}
        else:
            self._sources = [(source, options.get('count', 10))]
            self._source_platforms = {source: options.get('source_platform')}
        # Keep originals so we can revert / clean up after preprocessing
        self._original_sources = list(self._sources)
        self._preprocessed_files = []
        # Map cleaned-temp-path -> original {title} (basename without extension)
        # so naming templates using {title} keep the user's source name even
        # after watermark pre-pass swaps the file.
        self._source_titles = {
            path: os.path.splitext(os.path.basename(path))[0]
            for path, _ in self._sources
        }

        total_count = sum(c for _, c in self._sources)

        self.progress = {
            'status': 'idle',
            'stage': 'idle',
            'current_index': 0,
            'total': total_count,
            'percent': 0,
            'current_file': '',
            'elapsed': 0,
            'estimated_remaining': 0,
            'items': [],
            'error': None,
            # Pre-pass (watermark-hide) progress
            'preprocess_index': 0,
            'preprocess_total': 0,
            'preprocess_current': '',
        }

    def start(self):
        self.cancelled = False
        self.progress['status'] = 'running'
        total = self.progress['total']
        self.progress['items'] = [
            {'index': i + 1, 'filename': '', 'status': 'waiting', 'time': None}
            for i in range(total)
        ]
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def cancel(self):
        self.cancelled = True
        if self._process and self._process.poll() is None:
            try:
                self._process.kill()
            except Exception:
                pass
        # Kill any in-flight watermark pre-pass ffmpeg processes
        with self._wm_lock:
            procs = list(self._wm_processes)
        for p in procs:
            try:
                if p.poll() is None:
                    p.kill()
            except Exception:
                pass

    def _run(self):
        start_time = time.time()
        results = []
        times = []
        total = self.progress['total']
        global_index = 0

        try:
            self._preprocess_watermark_all()
            for source_path, count in self._sources:
                self.source = source_path
                for j in range(count):
                    if self.cancelled:
                        self.progress['status'] = 'cancelled'
                        return

                    global_index += 1
                    self.progress['current_index'] = global_index
                    self.progress['percent'] = int((global_index - 1) / total * 100)
                    filename = self._resolve_filename(global_index)
                    self.progress['current_file'] = filename
                    self.progress['items'][global_index - 1]['filename'] = filename
                    self.progress['items'][global_index - 1]['status'] = 'processing'

                    if self.on_progress:
                        self.on_progress(global_index, filename, 'processing', time.time() - start_time)

                    clone_start = time.time()
                    output_path = os.path.join(self.options['output_folder'], filename)
                    self._generate_clone(global_index, output_path)
                    clone_elapsed = time.time() - clone_start

                    if self.cancelled:
                        self.progress['status'] = 'cancelled'
                        return

                    times.append(clone_elapsed)
                    self.progress['items'][global_index - 1]['status'] = 'done'
                    self.progress['items'][global_index - 1]['time'] = round(clone_elapsed, 2)
                    self.progress['elapsed'] = round(time.time() - start_time, 2)

                    remaining_count = total - global_index
                    if times:
                        avg = sum(times) / len(times)
                        self.progress['estimated_remaining'] = round(avg * remaining_count, 2)

                    results.append({'filename': filename, 'time': round(clone_elapsed, 2)})

            self.progress['status'] = 'completed'
            self.progress['percent'] = 100
            self.progress['elapsed'] = round(time.time() - start_time, 2)
            self.progress['estimated_remaining'] = 0

            if self.on_complete:
                self.on_complete(results, self.progress['elapsed'])

        except Exception as e:
            self.progress['status'] = 'error'
            self.progress['error'] = str(e)
            if self.on_error:
                self.on_error(str(e))
        finally:
            self._cleanup_preprocessed()

    def _cleanup_preprocessed(self):
        """Remove temp files created by watermark preprocessing."""
        for path in self._preprocessed_files:
            try:
                if os.path.exists(path):
                    os.remove(path)
            except Exception:
                pass
        self._preprocessed_files = []

    def _preprocess_watermark_all(self):
        """Apply watermark-hide regions to each source video.
        Replaces self._sources entries with cleaned temp files when applicable.

        Runs jobs in parallel (up to ~half of CPU cores, capped at 3) and
        reports progress via self.progress so the UI can show how many
        sources have been pre-processed instead of appearing stuck at
        "Processing clone #0"."""
        wm = self.options.get('watermark_hide') or {}
        if not wm.get('enabled'):
            return

        # Snapshot work items so the original order of self._sources is preserved
        new_sources = list(self._sources)
        pending = []  # list of (idx, src_path, count, regions)
        for idx, (src_path, count) in enumerate(self._sources):
            platform = self._source_platforms.get(src_path)
            regions = self._resolve_watermark_regions(wm, platform)
            if regions:
                pending.append((idx, src_path, count, regions))

        if not pending:
            return

        # Initialise progress UI for the pre-pass stage
        self.progress['stage'] = 'preprocessing'
        self.progress['preprocess_total'] = len(pending)
        self.progress['preprocess_index'] = 0
        self.progress['preprocess_current'] = ''

        cpu = os.cpu_count() or 2
        # Conservative parallelism: ffmpeg already multi-threads internally,
        # so 2-3 parallel jobs typically saturate a desktop CPU without OOM.
        workers = max(1, min(3, cpu // 2))

        completed = 0

        def run_one(item):
            idx, src_path, count, regions = item
            cleaned = self._apply_watermark_filters(src_path, regions)
            return idx, src_path, count, cleaned

        if workers <= 1 or len(pending) == 1:
            # Sequential path (also used on single-core machines / single job)
            for item in pending:
                if self.cancelled:
                    self.progress['stage'] = 'idle'
                    return
                self.progress['preprocess_current'] = os.path.basename(item[1])
                idx, src_path, count, cleaned = run_one(item)
                completed += 1
                self.progress['preprocess_index'] = completed
                if cleaned and cleaned != src_path:
                    self._preprocessed_files.append(cleaned)
                    new_sources[idx] = (cleaned, count)
                    self._source_platforms[cleaned] = self._source_platforms.get(src_path)
                    self._source_titles[cleaned] = self._source_titles.get(
                        src_path, os.path.splitext(os.path.basename(src_path))[0]
                    )
        else:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futures = {ex.submit(run_one, item): item for item in pending}
                try:
                    for fut in as_completed(futures):
                        if self.cancelled:
                            for f in futures:
                                f.cancel()
                            break
                        try:
                            idx, src_path, count, cleaned = fut.result()
                        except Exception:
                            # On error, leave source unchanged and continue
                            completed += 1
                            self.progress['preprocess_index'] = completed
                            continue
                        completed += 1
                        self.progress['preprocess_index'] = completed
                        self.progress['preprocess_current'] = os.path.basename(src_path)
                        if cleaned and cleaned != src_path:
                            self._preprocessed_files.append(cleaned)
                            new_sources[idx] = (cleaned, count)
                            self._source_platforms[cleaned] = self._source_platforms.get(src_path)
                            self._source_titles[cleaned] = self._source_titles.get(
                                src_path, os.path.splitext(os.path.basename(src_path))[0]
                            )
                finally:
                    if self.cancelled:
                        # Make sure pool shuts down promptly when cancelled
                        ex.shutdown(wait=False, cancel_futures=True)

        self._sources = new_sources
        self.progress['stage'] = 'cloning'

    def _resolve_watermark_regions(self, wm, platform):
        """Combine user-defined regions with auto-Shopee preset when applicable.
        Returns a flat list of region dicts ready for filter generation."""
        regions = list(wm.get('regions') or [])
        auto_shopee = wm.get('auto_shopee', True)
        if auto_shopee and platform == 'shopee':
            already = any((r.get('preset') == 'shopee') for r in regions)
            if not already:
                regions.append({
                    'x_pct': 0, 'y_pct': 46, 'w_pct': 36, 'h_pct': 10,
                    'method': 'delogo_blur', 'strength': 8, 'preset': 'shopee',
                })
        # Filter to non-empty regions
        valid = []
        for r in regions:
            try:
                w = float(r.get('w_pct', 0))
                h = float(r.get('h_pct', 0))
                if w > 0 and h > 0:
                    valid.append(r)
            except (TypeError, ValueError):
                continue
        return valid

    def _apply_watermark_filters(self, src_path, regions):
        """Run a single ffmpeg pass that hides the listed regions.
        Returns path to cleaned temp file, or src_path if no-op."""
        info = get_video_info(self.ffmpeg_path, src_path)
        if not info:
            return src_path
        src_w = int(info.get('width') or 0)
        src_h = int(info.get('height') or 0)
        if src_w <= 0 or src_h <= 0:
            return src_path

        def to_px(region):
            x = max(0, int(src_w * float(region.get('x_pct', 0)) / 100.0))
            y = max(0, int(src_h * float(region.get('y_pct', 0)) / 100.0))
            w = max(1, int(src_w * float(region.get('w_pct', 0)) / 100.0))
            h = max(1, int(src_h * float(region.get('h_pct', 0)) / 100.0))
            if x + w > src_w:
                w = src_w - x
            if y + h > src_h:
                h = src_h - y
            return x, y, max(1, w), max(1, h)

        simple_filters = []
        fc_steps = []  # list of (kind, region) — kind is 'blur' (split+crop+overlay)

        for r in regions:
            method = r.get('method', 'delogo')
            x, y, w, h = to_px(r)
            if w < 2 or h < 2:
                continue
            if method == 'delogo':
                # delogo wants interior pixels (>=1 from each edge)
                dx = max(1, x)
                dy = max(1, y)
                dw = min(w, src_w - 1 - dx)
                dh = min(h, src_h - 1 - dy)
                if dw < 1 or dh < 1:
                    continue
                simple_filters.append(f"delogo=x={dx}:y={dy}:w={dw}:h={dh}:show=0")
            elif method == 'cover':
                color = (r.get('color') or '#000000').lstrip('#')
                opacity = float(r.get('opacity', 0.7))
                opacity = max(0.0, min(1.0, opacity))
                simple_filters.append(
                    f"drawbox=x={x}:y={y}:w={w}:h={h}:color=0x{color}@{opacity}:t=fill"
                )
            elif method == 'blur':
                fc_steps.append(('blur', r, (x, y, w, h)))
            elif method == 'delogo_blur':
                # Apply delogo first (simple), then a soft blur on the same region
                dx = max(1, x)
                dy = max(1, y)
                dw = min(w, src_w - 1 - dx)
                dh = min(h, src_h - 1 - dy)
                if dw >= 1 and dh >= 1:
                    simple_filters.append(f"delogo=x={dx}:y={dy}:w={dw}:h={dh}:show=0")
                fc_steps.append(('blur', r, (x, y, w, h)))

        if not simple_filters and not fc_steps:
            return src_path

        out_path = os.path.join(
            tempfile.gettempdir(), f'wmrem_{uuid.uuid4().hex[:8]}.mp4'
        )

        cmd = [self.ffmpeg_path, '-y', '-i', src_path]
        if fc_steps:
            # Build filter_complex: chain simple filters first, then split/crop/boxblur/overlay per fc step
            fc_parts = []
            cur = '0:v'
            if simple_filters:
                fc_parts.append(f"[{cur}]{','.join(simple_filters)}[v_pre]")
                cur = 'v_pre'
            for i, (_, region, (x, y, w, h)) in enumerate(fc_steps):
                strength = max(1, int(region.get('strength', 8)))
                base = f"v_base{i}"
                blur = f"v_blur{i}"
                cropped = f"v_crop{i}"
                nxt = f"v_wm{i}"
                fc_parts.append(f"[{cur}]split=2[{base}][{blur}]")
                fc_parts.append(
                    f"[{blur}]crop={w}:{h}:{x}:{y},boxblur={strength}:1[{cropped}]"
                )
                fc_parts.append(f"[{base}][{cropped}]overlay={x}:{y}[{nxt}]")
                cur = nxt
            cmd += [
                '-filter_complex', ';'.join(fc_parts),
                '-map', f'[{cur}]', '-map', '0:a?',
            ]
        else:
            cmd += ['-vf', ','.join(simple_filters), '-map', '0:v', '-map', '0:a?']

        # Pre-pass output is an intermediate file that the clone step re-encodes
        # again (typically with libx264 -crf 18). Quality of this intermediate
        # therefore has no impact on final output, so we use the fastest preset
        # available to minimise time spent in the pre-pass stage.
        cmd += [
            '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'copy',
            out_path,
        ]

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        # Track this process so cancel() can kill it even when running in
        # parallel (multiple pre-passes share the cancel signal).
        with self._wm_lock:
            self._wm_processes.append(proc)
        try:
            _, stderr = proc.communicate()
        finally:
            with self._wm_lock:
                try:
                    self._wm_processes.remove(proc)
                except ValueError:
                    pass
        if proc.returncode != 0:
            err = stderr.decode('utf-8', errors='replace').strip()[-400:]
            raise RuntimeError(f"Watermark hide preprocessing failed: {err}")
        return out_path

    def _generate_clone(self, index, output_path):
        self._text_overlay_cwd = None
        cmd = self._build_ffmpeg_command(index, output_path)
        self._process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=self._text_overlay_cwd,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        _, stderr = self._process.communicate()

        if self._process.returncode != 0 and not self.cancelled:
            error_msg = stderr.decode('utf-8', errors='replace').strip()
            raise RuntimeError(f"FFmpeg error on clone {index}: {error_msg[-500:]}")

    def _build_ffmpeg_command(self, index, output_path):
        method = self.options.get('method', 'fast')
        unique_id = uuid.uuid4().hex[:8]
        now = datetime.now() + timedelta(seconds=index)
        creation_time = now.strftime('%Y-%m-%dT%H:%M:%S')
        seed = random.randint(0, 999999)

        # Randomize parameters per clone for unique file sizes
        audio_bitrates = [96, 112, 128, 144, 160, 176, 192]
        audio_br = random.choice(audio_bitrates)
        noise_volume = random.uniform(0.00005, 0.0003)
        # Random padding metadata to vary file size slightly
        pad_length = random.randint(50, 500)
        pad_data = uuid.uuid4().hex * ((pad_length // 32) + 1)
        pad_data = pad_data[:pad_length]

        # Audio uniqueness: multiple imperceptible variations per clone
        seed2 = random.randint(0, 999999)
        # Tiny pitch shift (0.01-0.05% — inaudible)
        pitch_shift = random.uniform(0.9995, 1.0005)
        # Micro tempo change (0.01-0.03% — inaudible)
        tempo_shift = round(random.uniform(0.9997, 1.0003), 6)
        # Random lowpass cutoff high enough to be inaudible (18k-20k Hz)
        lowpass_freq = random.randint(18000, 20000)
        # Random highpass very low (5-20 Hz, sub-audible)
        highpass_freq = random.randint(5, 20)
        # Tiny volume variation (±0.1 dB — inaudible)
        vol_db = round(random.uniform(-0.1, 0.1), 3)
        # Build audio filter chain
        source_audio = self.options.get('source_audio', {'mode': 'keep', 'volume': 100})
        src_audio_mode = source_audio.get('mode', 'keep')
        src_audio_vol = source_audio.get('volume', 100)

        af_parts = [
            f"aeval='val(0)+random({seed})*{noise_volume}+random({seed2})*{noise_volume*0.5}':c=same",
            f"asetrate=44100*{pitch_shift}",
            f"atempo={tempo_shift}",
            f"lowpass=f={lowpass_freq}",
            f"highpass=f={highpass_freq}",
            f"volume={vol_db}dB",
        ]

        if src_audio_mode == 'mute':
            af_parts = ["volume=0"]
        elif src_audio_mode == 'custom' and src_audio_vol != 100:
            vol_factor = src_audio_vol / 100.0
            af_parts.append(f"volume={vol_factor}")

        af_chain = ','.join(af_parts)

        # Background music setup
        bgm = self.options.get('bgm', None)
        bgm_path = bgm['filepath'] if bgm and os.path.exists(bgm.get('filepath', '')) else None

        cmd = [self.ffmpeg_path, '-i', self.source]
        if bgm_path:
            if bgm.get('loop', True):
                cmd += ['-stream_loop', '-1']
            cmd += ['-i', bgm_path]

        # Build video filter chain from user-selected effects
        effects = self.options.get('effects', [])
        vf_parts = []

        if 'brightness' in effects:
            vf_parts.append(f"eq=brightness={round(random.uniform(-0.05, 0.05), 4)}")
        if 'contrast' in effects:
            vf_parts.append(f"eq=contrast={round(random.uniform(0.95, 1.05), 4)}")
        if 'saturation' in effects:
            vf_parts.append(f"eq=saturation={round(random.uniform(0.90, 1.10), 4)}")
        if 'hue' in effects:
            vf_parts.append(f"hue=h={round(random.uniform(-5, 5), 2)}")
        if 'sharpen' in effects:
            amt = round(random.uniform(0.3, 1.0), 2)
            vf_parts.append(f"unsharp=3:3:{amt}:3:3:0")
        if 'blur' in effects:
            sigma = round(random.uniform(0.3, 0.8), 2)
            vf_parts.append(f"gblur=sigma={sigma}")
        if 'noise' in effects:
            ns = random.randint(2, 6)
            vf_parts.append(f"noise=c0s={ns}:c0f=t+u")
        if 'vignette' in effects:
            vf_parts.append("vignette=PI/5")
        if 'flip' in effects:
            vf_parts.append("hflip")
        if 'zoom' in effects:
            crop_pct = round(random.uniform(0.01, 0.03), 4)
            vf_parts.append(f"crop=iw*{1-crop_pct}:ih*{1-crop_pct},scale=iw/{1-crop_pct}:ih/{1-crop_pct}")

        # Text overlays — multiple overlays, each with one drawtext per line
        text_overlays = self.options.get('text_overlays', None) or []
        for text_overlay in text_overlays:
            if not text_overlay or not text_overlay.get('text'):
                continue
            raw_text = text_overlay['text']
            # Split lines, strip \r (Windows carriage return renders as box glyph)
            lines = [l for l in raw_text.replace('\r', '').split('\n') if l.strip()]
            if not lines:
                continue
            font_file = text_overlay.get('font', 'arial.ttf')
            # Copy font to temp dir to avoid colon in C:\ paths
            tmp_dir = tempfile.gettempdir()
            font_src = os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts', font_file)
            font_dst = os.path.join(tmp_dir, font_file)
            if not os.path.exists(font_dst):
                shutil.copy2(font_src, font_dst)
            self._text_overlay_cwd = tmp_dir
            font_size = text_overlay.get('font_size', 24)
            color = text_overlay.get('color', '#ffffff').replace('#', '')
            position = text_overlay.get('position', 'bottom-left')
            line_gap = int(font_size * 1.3)
            total_h = line_gap * len(lines)

            # X expression per alignment (each line centers based on its own text_w)
            if 'left' in position:
                x_expr = '20'
            elif 'right' in position:
                x_expr = 'w-text_w-20'
            else:
                x_expr = '(w-text_w)/2'

            # Base Y expression. Handle:
            # top-*           -> top
            # center, center-*-> vertical center
            # bottom-* (else) -> bottom
            if position.startswith('top'):
                base_y = '20'
            elif position == 'center' or position.startswith('center'):
                base_y = f'(h-{total_h})/2'
            else:
                base_y = f'h-{total_h}-20'

            for idx, line in enumerate(lines):
                # Escape special chars for FFmpeg drawtext text= value
                escaped = line.replace('\\', '\\\\').replace(':', '\\:').replace("'", "\\'").replace(';', '\\;')
                y_expr = base_y if idx == 0 else f'{base_y}+{idx * line_gap}'
                vf_parts.append(
                    f"drawtext=text='{escaped}':fontfile={font_file}:fontsize={font_size}:fontcolor=0x{color}:x={x_expr}:y={y_expr}:shadowx=2:shadowy=2:shadowcolor=black"
                )

        has_video_effects = len(vf_parts) > 0
        # Ensure even dimensions for libx264 (required: width & height divisible by 2)
        if has_video_effects:
            vf_parts.append("pad=ceil(iw/2)*2:ceil(ih/2)*2")
        vf_chain = ','.join(vf_parts) if has_video_effects else ''

        # Video + Image overlays setup — multiple overlays of either kind
        video_overlays = self.options.get('video_overlays', None) or []
        image_overlays = self.options.get('image_overlays', None) or []
        all_overlays = []  # list of (input_index, overlay_config, kind) where kind in {'video','image'}
        next_input_idx = 1 if not bgm_path else 2  # 0=source, 1=bgm(if any)
        for vo in video_overlays:
            if vo and os.path.exists(vo.get('filepath', '')):
                if vo.get('loop', True):
                    cmd += ['-stream_loop', '-1']
                cmd += ['-i', vo['filepath']]
                all_overlays.append((next_input_idx, vo, 'video'))
                next_input_idx += 1
        for io in image_overlays:
            if io and os.path.exists(io.get('filepath', '')):
                # Loop static image so it lasts as long as the main video.
                cmd += ['-loop', '1', '-i', io['filepath']]
                all_overlays.append((next_input_idx, io, 'image'))
                next_input_idx += 1

        has_overlays = len(all_overlays) > 0

        # Build audio filter with optional BGM mixing
        bgm_idx = 1 if bgm_path else None
        if bgm_path:
            bgm_vol = bgm.get('volume', 20) / 100.0
            audio_fc = (
                f"[0:a]{af_chain}[a_main];"
                f"[{bgm_idx}:a]volume={bgm_vol}[a_bgm];"
                f"[a_main][a_bgm]amix=inputs=2:duration=first:dropout_transition=2[a_out]"
            )
        else:
            audio_fc = f"[0:a]{af_chain}[a_out]"

        # Decide encoding mode
        quality = self.options.get('quality', 'auto')
        use_reencode = method != 'fast' or has_video_effects or has_overlays or quality != 'auto'

        # Scale filter for HD quality
        if quality == '720p':
            vf_parts.insert(0, "scale=-2:720")
        elif quality == '1080p':
            vf_parts.insert(0, "scale=-2:1080")

        if use_reencode:
            # Lower CRF for HD to preserve quality
            if quality == '1080p':
                crf_value = random.randint(17, 20)
            elif quality == '720p':
                crf_value = random.randint(18, 22)
            else:
                crf_value = random.randint(17, 23)
            if method == 'standard' and 'noise' not in effects:
                noise_strength = random.randint(1, 4)
                vf_parts.insert(0, f"noise=c0s={noise_strength}:c0f=t+u")
            if "pad=ceil(iw/2)*2:ceil(ih/2)*2" not in vf_parts:
                vf_parts.append("pad=ceil(iw/2)*2:ceil(ih/2)*2")
            vf_chain = ','.join(vf_parts)
            cmd += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', str(crf_value), '-preset', 'fast']
        else:
            cmd += ['-c:v', 'copy']

        # Build and attach filters. Position map covers the 9 named positions
        # (top/center/bottom × left/center/right) plus the legacy 'center'
        # alias which maps to center-center for backward compatibility.
        ov_pos_map = {
            'top-left':      'x=10:y=10',
            'top-center':    'x=(main_w-overlay_w)/2:y=10',
            'top-right':     'x=main_w-overlay_w-10:y=10',
            'center-left':   'x=10:y=(main_h-overlay_h)/2',
            'center-center': 'x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2',
            'center-right':  'x=main_w-overlay_w-10:y=(main_h-overlay_h)/2',
            'bottom-left':   'x=10:y=main_h-overlay_h-10',
            'bottom-center': 'x=(main_w-overlay_w)/2:y=main_h-overlay_h-10',
            'bottom-right':  'x=main_w-overlay_w-10:y=main_h-overlay_h-10',
            'center':        'x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2',
        }

        if has_overlays:
            # Get main video dimensions for proportional overlay sizing
            main_info = get_video_info(self.ffmpeg_path, self.source)
            main_w = main_info.get('width', 1080) if main_info else 1080
            main_h = main_info.get('height', 1920) if main_info else 1920

            # Multiple overlays (video + image) require filter_complex with chained overlay filters.
            main_vf = f"[0:v]{vf_chain}[v_main]" if vf_chain else "[0:v]null[v_main]"
            fc_parts = [main_vf]
            prev_label = "v_main"

            for i, (ov_idx, ov, kind) in enumerate(all_overlays):
                size_pct = ov.get('size_pct', 25) / 100.0
                opacity = ov.get('opacity', 100) / 100.0
                ov_position = ov.get('position', 'bottom-left')
                ov_xy = ov_pos_map.get(ov_position, ov_pos_map['bottom-left'])
                chromakey = ov.get('chromakey', None) if kind == 'video' else None

                # Get overlay native dimensions to preserve aspect ratio.
                # ffprobe handles both video and image inputs.
                ov_info = get_video_info(self.ffmpeg_path, ov.get('filepath', ''))
                if kind == 'image':
                    ov_w = ov_info.get('width', 500) if ov_info else 500
                    ov_h = ov_info.get('height', 500) if ov_info else 500
                else:
                    ov_w = ov_info.get('width', 1920) if ov_info else 1920
                    ov_h = ov_info.get('height', 1080) if ov_info else 1080

                # Compute target dimensions: size_pct of main video width, preserve overlay aspect ratio
                target_w = int(main_w * size_pct)
                target_h = int(target_w * ov_h / ov_w)
                # Ensure even dimensions (required by libx264)
                target_w = (target_w // 2) * 2
                target_h = (target_h // 2) * 2
                target_w = max(target_w, 2)
                target_h = max(target_h, 2)

                # Scale overlay to exact computed dimensions
                pip_raw = f"ov_raw{i}"
                fc_parts.append(f"[{ov_idx}:v]scale={target_w}:{target_h}[{pip_raw}]")

                # Apply chroma key and/or opacity. For images we always coerce
                # to yuva420p so PNG transparency is preserved through the chain.
                pip_label = f"ov_pip{i}"
                pip_filters = ""
                if chromakey or opacity < 1.0 or kind == 'image':
                    pip_filters += "format=yuva420p,"
                if chromakey:
                    ck_color = chromakey.get('color', '0x00ff00').replace('#', '0x')
                    ck_similarity = chromakey.get('similarity', 0.3)
                    ck_blend = chromakey.get('blend', 0.1)
                    pip_filters += f"chromakey={ck_color}:{ck_similarity}:{ck_blend},"
                if opacity < 1.0:
                    pip_filters += f"colorchannelmixer=aa={opacity},"
                if pip_filters:
                    pip_filters = pip_filters.rstrip(',')
                    fc_parts.append(f"[{pip_raw}]{pip_filters}[{pip_label}]")
                else:
                    pip_label = pip_raw  # no extra filters needed

                is_last = (i == len(all_overlays) - 1)
                out_label = "v_out" if is_last else f"v_tmp{i}"
                fc_parts.append(f"[{prev_label}][{pip_label}]overlay={ov_xy}:shortest=1:format=auto[{out_label}]")
                prev_label = out_label

            fc = ';'.join(fc_parts) + ';' + audio_fc
            cmd += ['-filter_complex', fc, '-map', '[v_out]', '-map', '[a_out]']
        elif bgm_path:
            # BGM only — video via -vf, audio via filter_complex
            if vf_chain:
                cmd += ['-vf', vf_chain]
            cmd += ['-filter_complex', audio_fc, '-map', '0:v', '-map', '[a_out]']
        else:
            # No overlay, no BGM — simple -vf and -af
            if vf_chain and use_reencode:
                cmd += ['-vf', vf_chain]
            cmd += ['-af', af_chain]

        cmd += ['-c:a', 'aac', '-b:a', f'{audio_br}k']

        # Ensure MP4 compatibility with all players
        fmt = self.options.get('format', 'mp4')
        if fmt == 'mp4':
            cmd += ['-movflags', '+faststart']

        cmd += [
            '-metadata', f'comment=clone_{index:02d}_{unique_id}_{pad_data}',
            '-metadata', f'title=Clone {index:02d}',
            '-metadata', f'creation_time={creation_time}',
            '-metadata', f'encoder=studio_{unique_id}_{seed}',
            '-shortest',
            '-y', output_path,
        ]

        return cmd

    def _resolve_filename(self, index):
        template = self.options.get('template', '{title}_clone{index}_{date}')
        fmt = self.options.get('format', 'mp4')
        # Prefer the original source's title (pre watermark-pre-pass) so that
        # {title} in the user's template doesn't surface internal temp names
        # like "wmrem_a1b2c3d4" when auto-Shopee watermark removal is on.
        source_name = self._source_titles.get(
            self.source,
            os.path.splitext(os.path.basename(self.source))[0],
        )
        now = datetime.now()

        def build_filename(index_value):
            name = template.format(
                title=source_name,
                index=str(index_value).zfill(2),
                date=now.strftime('%Y-%m-%d'),
                time=now.strftime('%H-%M-%S'),
                rand=uuid.uuid4().hex[:6],
            )
            return f"{name}.{fmt}"

        filename = build_filename(index)

        # Auto-rename if file exists
        output_folder = self.options.get('output_folder', '')
        full_path = os.path.join(output_folder, filename)
        if os.path.exists(full_path):
            # If template has {index}, continue numbering from existing files
            # (e.g. 01,02,03 -> next becomes 04) instead of using suffix "(2)".
            if '{index}' in template:
                next_index = index
                while True:
                    candidate = build_filename(next_index)
                    if not os.path.exists(os.path.join(output_folder, candidate)):
                        filename = candidate
                        break
                    next_index += 1
            else:
                base, ext = os.path.splitext(filename)
                counter = 2
                while os.path.exists(os.path.join(output_folder, f"{base} ({counter}){ext}")):
                    counter += 1
                filename = f"{base} ({counter}){ext}"

        return filename


def get_video_info(ffmpeg_path, filepath):
    """Get video info via ffprobe (bundled with ffmpeg)."""
    ffprobe_path = ffmpeg_path.replace('ffmpeg.exe', 'ffprobe.exe').replace('ffmpeg', 'ffprobe')

    cmd = [
        ffprobe_path,
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        filepath,
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        if result.returncode != 0:
            return None

        import json
        data = json.loads(result.stdout)
        fmt = data.get('format', {})
        streams = data.get('streams', [])

        video_stream = next((s for s in streams if s.get('codec_type') == 'video'), None)
        audio_stream = next((s for s in streams if s.get('codec_type') == 'audio'), None)

        duration_sec = float(fmt.get('duration', 0))
        minutes = int(duration_sec // 60)
        seconds = int(duration_sec % 60)

        info = {
            'filename': os.path.basename(filepath),
            'filepath': filepath,
            'size': int(fmt.get('size', 0)),
            'size_mb': round(int(fmt.get('size', 0)) / (1024 * 1024), 2),
            'duration': f"{minutes}:{seconds:02d}",
            'duration_sec': round(duration_sec, 2),
            'format': fmt.get('format_name', ''),
            'bitrate': int(fmt.get('bit_rate', 0)),
            'bitrate_kbps': round(int(fmt.get('bit_rate', 0)) / 1000, 0),
        }

        if video_stream:
            info['video_codec'] = video_stream.get('codec_name', '')
            info['width'] = video_stream.get('width', 0)
            info['height'] = video_stream.get('height', 0)
            info['resolution'] = f"{video_stream.get('width', 0)}x{video_stream.get('height', 0)}"
            r_frame_rate = video_stream.get('r_frame_rate', '0/1')
            try:
                num, den = r_frame_rate.split('/')
                info['fps'] = round(int(num) / int(den), 2)
            except (ValueError, ZeroDivisionError):
                info['fps'] = 0

        if audio_stream:
            info['audio_codec'] = audio_stream.get('codec_name', '')
            info['audio_bitrate'] = int(audio_stream.get('bit_rate', 0))
            info['sample_rate'] = int(audio_stream.get('sample_rate', 0))

        return info

    except Exception:
        return None


def check_ffmpeg(ffmpeg_path):
    """Check if FFmpeg is available and return version string."""
    try:
        result = subprocess.run(
            [ffmpeg_path, '-version'],
            capture_output=True,
            text=True,
            timeout=10,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
        )
        if result.returncode == 0:
            first_line = result.stdout.split('\n')[0]
            return first_line
        return None
    except Exception:
        return None
