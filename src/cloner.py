import os
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import random
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

        self.progress = {
            'status': 'idle',
            'current_index': 0,
            'total': options.get('count', 10),
            'percent': 0,
            'current_file': '',
            'elapsed': 0,
            'estimated_remaining': 0,
            'items': [],
            'error': None,
        }

    def start(self):
        self.cancelled = False
        self.progress['status'] = 'running'
        self.progress['items'] = [
            {'index': i + 1, 'filename': '', 'status': 'waiting', 'time': None}
            for i in range(self.options['count'])
        ]
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def cancel(self):
        self.cancelled = True
        if self._process and self._process.poll() is None:
            self._process.kill()

    def _run(self):
        start_time = time.time()
        results = []
        times = []

        try:
            for i in range(self.options['count']):
                if self.cancelled:
                    self.progress['status'] = 'cancelled'
                    return

                self.progress['current_index'] = i + 1
                self.progress['percent'] = int(i / self.options['count'] * 100)
                filename = self._resolve_filename(i + 1)
                self.progress['current_file'] = filename
                self.progress['items'][i]['filename'] = filename
                self.progress['items'][i]['status'] = 'processing'

                if self.on_progress:
                    self.on_progress(i + 1, filename, 'processing', time.time() - start_time)

                clone_start = time.time()
                output_path = os.path.join(self.options['output_folder'], filename)
                self._generate_clone(i + 1, output_path)
                clone_elapsed = time.time() - clone_start

                if self.cancelled:
                    self.progress['status'] = 'cancelled'
                    return

                times.append(clone_elapsed)
                self.progress['items'][i]['status'] = 'done'
                self.progress['items'][i]['time'] = round(clone_elapsed, 2)
                self.progress['elapsed'] = round(time.time() - start_time, 2)

                remaining_count = self.options['count'] - (i + 1)
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
        af_parts = [
            f"aeval='val(0)+random({seed})*{noise_volume}+random({seed2})*{noise_volume*0.5}':c=same",
            f"asetrate=44100*{pitch_shift}",
            f"atempo={tempo_shift}",
            f"lowpass=f={lowpass_freq}",
            f"highpass=f={highpass_freq}",
            f"volume={vol_db}dB",
        ]
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

        # Text overlay — one drawtext per line for proper per-line centering
        text_overlay = self.options.get('text_overlay', None)
        if text_overlay and text_overlay.get('text'):
            raw_text = text_overlay['text']
            # Split lines, strip \r (Windows carriage return renders as box glyph)
            lines = [l for l in raw_text.replace('\r', '').split('\n') if l.strip()]
            if lines:
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

                # Base Y expression
                if position.startswith('top'):
                    base_y = '20'
                elif position == 'center':
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

        # Video overlay (PiP) setup
        video_overlay = self.options.get('video_overlay', None)
        vo_path = None
        if video_overlay and os.path.exists(video_overlay.get('filepath', '')):
            vo_path = video_overlay['filepath']
            if video_overlay.get('loop', True):
                cmd += ['-stream_loop', '-1']
            cmd += ['-i', vo_path]

        # Determine input indices
        bgm_idx = 1 if bgm_path else None
        vo_idx = (2 if bgm_path else 1) if vo_path else None

        # Build audio filter with optional BGM mixing
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
        use_reencode = method != 'fast' or has_video_effects or vo_path

        if use_reencode:
            crf_value = random.randint(17, 23)
            if method == 'standard' and 'noise' not in effects:
                noise_strength = random.randint(1, 4)
                vf_parts.insert(0, f"noise=c0s={noise_strength}:c0f=t+u")
            if "pad=ceil(iw/2)*2:ceil(ih/2)*2" not in vf_parts:
                vf_parts.append("pad=ceil(iw/2)*2:ceil(ih/2)*2")
            vf_chain = ','.join(vf_parts)
            cmd += ['-c:v', 'libx264', '-crf', str(crf_value), '-preset', 'fast']
        else:
            cmd += ['-c:v', 'copy']

        # Build and attach filters
        if vo_path:
            # Video overlay requires filter_complex for both video and audio
            size_pct = video_overlay.get('size_pct', 25) / 100.0
            opacity = video_overlay.get('opacity', 100) / 100.0
            vo_position = video_overlay.get('position', 'bottom-left')
            vo_pos_map = {
                'top-left':     'x=10:y=10',
                'top-right':    'x=main_w-overlay_w-10:y=10',
                'bottom-left':  'x=10:y=main_h-overlay_h-10',
                'bottom-right': 'x=main_w-overlay_w-10:y=main_h-overlay_h-10',
                'center':       'x=(main_w-overlay_w)/2:y=(main_h-overlay_h)/2',
            }
            vo_xy = vo_pos_map.get(vo_position, 'x=10:y=main_h-overlay_h-10')

            # Video: apply effects → overlay PiP
            main_vf = f"[0:v]{vf_chain}[v_main]" if vf_chain else "[0:v]null[v_main]"
            pip_scale = f"[{vo_idx}:v]scale=iw*{size_pct}:ih*{size_pct}"
            if opacity < 1.0:
                pip_scale += f",format=yuva420p,colorchannelmixer=aa={opacity}"
            pip_scale += "[v_pip]"
            video_fc = f"{main_vf};{pip_scale};[v_main][v_pip]overlay={vo_xy}:shortest=1:format=auto[v_out]"

            fc = f"{video_fc};{audio_fc}"
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
        source_name = os.path.splitext(os.path.basename(self.source))[0]
        now = datetime.now()

        filename = template.format(
            title=source_name,
            index=str(index).zfill(2),
            date=now.strftime('%Y-%m-%d'),
            time=now.strftime('%H-%M-%S'),
            rand=uuid.uuid4().hex[:6],
        )
        filename = f"{filename}.{fmt}"

        # Auto-rename if file exists
        output_folder = self.options.get('output_folder', '')
        full_path = os.path.join(output_folder, filename)
        if os.path.exists(full_path):
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
