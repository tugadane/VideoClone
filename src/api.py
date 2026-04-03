import os
import re
import json
import tempfile
import urllib.request
import urllib.parse
import http.cookiejar
import winsound
import webview
from config import Config
from history import History
from cloner import VideoCloner, get_video_info, check_ffmpeg


class Api:
    def __init__(self):
        self._window = None
        self._config = Config()
        self._history = History()
        self._cloner = None

    def set_window(self, window):
        self._window = window

    # ---------- File Dialog ----------
    def select_video_file(self):
        file_types = ('Video Files (*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv)',)
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=file_types,
        )
        if result and len(result) > 0:
            filepath = result[0]
            info = self.get_video_info(filepath)
            return info
        return None

    def get_full_path(self, relative_path):
        """Resolve a relative path to absolute path based on project root."""
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        full = os.path.join(base, relative_path)
        full = os.path.normpath(full)
        os.makedirs(full, exist_ok=True)
        return full

    def select_output_folder(self):
        result = self._window.create_file_dialog(webview.FOLDER_DIALOG)
        if result and len(result) > 0:
            return result[0]
        return None

    def select_audio_file(self):
        file_types = ('Audio Files (*.mp3;*.wav;*.aac;*.ogg;*.flac;*.m4a;*.wma)',)
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=file_types,
        )
        if result and len(result) > 0:
            filepath = result[0]
            return {'filepath': filepath, 'filename': os.path.basename(filepath)}
        return None

    def select_overlay_video(self):
        file_types = ('Video Files (*.mp4;*.mkv;*.avi;*.mov;*.webm;*.flv;*.wmv)',)
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=file_types,
        )
        if result and len(result) > 0:
            filepath = result[0]
            return {'filepath': filepath, 'filename': os.path.basename(filepath)}
        return None

    def select_ffmpeg_path(self):
        file_types = ('Executable Files (*.exe)',)
        result = self._window.create_file_dialog(
            webview.OPEN_DIALOG,
            file_types=file_types,
        )
        if result and len(result) > 0:
            path = result[0]
            self._config.set('ffmpeg_path', path)
            return path
        return None

    # ---------- Google Drive ----------
    def download_from_gdrive(self, url):
        """Download video from Google Drive public link."""
        try:
            file_id = self._extract_gdrive_id(url)
            if not file_id:
                return {'error': 'Invalid Google Drive URL'}

            download_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_gdrive')
            os.makedirs(download_dir, exist_ok=True)

            filepath, filename = self._gdrive_download(file_id, download_dir)
            if not filepath:
                return {'error': 'Failed to download file from Google Drive'}

            info = self.get_video_info(filepath)
            if info:
                return info
            return {'error': 'Downloaded file is not a valid video'}
        except Exception as e:
            return {'error': f'Google Drive download failed: {str(e)}'}

    def get_gdrive_download_progress(self):
        return getattr(self, '_gdrive_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _extract_gdrive_id(self, url):
        url = url.strip()
        patterns = [
            r'/file/d/([a-zA-Z0-9_-]+)',
            r'[?&]id=([a-zA-Z0-9_-]+)',
            r'^([a-zA-Z0-9_-]{20,})$',
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    def _gdrive_download(self, file_id, download_dir):
        self._gdrive_progress = {'status': 'downloading', 'percent': 0, 'downloaded_mb': 0}

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

        # First request - may get confirmation page for large files
        url = f'https://drive.google.com/uc?export=download&id={file_id}'
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        response = opener.open(req)

        # Check for virus scan warning (large files)
        content_type = response.headers.get('Content-Type', '')
        if 'text/html' in content_type:
            html = response.read().decode('utf-8', errors='ignore')
            confirm_match = re.search(r'confirm=([0-9A-Za-z_-]+)', html)
            # Also try the new format with uuid
            uuid_match = re.search(r'uuid=([0-9A-Za-z_-]+)', html)

            if confirm_match:
                confirm_url = f'https://drive.google.com/uc?export=download&confirm={confirm_match.group(1)}&id={file_id}'
            elif uuid_match:
                confirm_url = f'https://drive.google.com/uc?export=download&id={file_id}&confirm=t&uuid={uuid_match.group(1)}'
            else:
                confirm_url = f'https://drive.google.com/uc?export=download&id={file_id}&confirm=t'

            req = urllib.request.Request(confirm_url, headers={'User-Agent': 'Mozilla/5.0'})
            response = opener.open(req)

        # Extract filename from Content-Disposition
        cd = response.headers.get('Content-Disposition', '')
        fname_match = re.search(r"filename\*?=['\"]?(?:UTF-8'')?([^;'\"\n]+)", cd)
        if fname_match:
            filename = urllib.request.url2pathname(fname_match.group(1)).strip()
        else:
            filename = f'gdrive_{file_id}.mp4'

        filepath = os.path.join(download_dir, filename)
        total_size = response.headers.get('Content-Length')
        total_size = int(total_size) if total_size else 0
        downloaded = 0
        block_size = 1024 * 256  # 256 KB

        with open(filepath, 'wb') as f:
            while True:
                chunk = response.read(block_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    self._gdrive_progress = {
                        'status': 'downloading',
                        'percent': int(downloaded / total_size * 100),
                        'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                        'total_mb': round(total_size / (1024 * 1024), 1),
                    }
                else:
                    self._gdrive_progress = {
                        'status': 'downloading',
                        'percent': 0,
                        'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                    }

        self._gdrive_progress = {'status': 'done', 'percent': 100, 'downloaded_mb': round(downloaded / (1024 * 1024), 1)}

        if os.path.getsize(filepath) < 1024:
            os.remove(filepath)
            return None, None

        return filepath, filename

    # ---------- TikTok ----------
    def download_from_tiktok(self, url):
        """Download video from TikTok link (no watermark)."""
        try:
            url = url.strip()
            if not re.search(r'tiktok\.com/', url):
                return {'error': 'Invalid TikTok URL'}

            download_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_tiktok')
            os.makedirs(download_dir, exist_ok=True)

            self._tiktok_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

            filepath = self._tiktok_download(url, download_dir)
            if not filepath:
                return {'error': 'Failed to download TikTok video. Make sure the link is valid and the video is public.'}

            info = self.get_video_info(filepath)
            if info:
                return info
            return {'error': 'Downloaded file is not a valid video'}
        except Exception as e:
            self._tiktok_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return {'error': f'TikTok download failed: {str(e)}'}

    def get_tiktok_download_progress(self):
        return getattr(self, '_tiktok_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _tiktok_download(self, url, download_dir):
        self._tiktok_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

        # Resolve short URL to full URL and get video ID
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cj),
            urllib.request.HTTPRedirectHandler(),
        )
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Referer': 'https://www.tiktok.com/',
        }

        # Use tikwm.com API (free, no auth needed)
        # Extract clean URL
        clean_url = url.split('?')[0]
        api_url = f'https://www.tikwm.com/api/?url={urllib.request.quote(clean_url, safe="")}'

        req = urllib.request.Request(api_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json',
        })

        self._tiktok_progress = {'status': 'fetching_info', 'percent': 10, 'downloaded_mb': 0}
        response = opener.open(req, timeout=30)
        data = json.loads(response.read().decode('utf-8'))

        if data.get('code') != 0 or not data.get('data'):
            return None

        video_data = data['data']
        # Prefer HD / no-watermark URL
        video_url = video_data.get('hdplay') or video_data.get('play')
        if not video_url:
            return None

        # Build filename from title or ID
        video_id = video_data.get('id', 'tiktok_video')
        title = video_data.get('title', '')[:50].strip()
        # Sanitize title for filename
        safe_title = re.sub(r'[<>:"/\\|?*]', '', title).strip() or video_id
        filename = f'tiktok_{safe_title}.mp4'

        filepath = os.path.join(download_dir, filename)

        # Download the video file
        self._tiktok_progress = {'status': 'downloading', 'percent': 20, 'downloaded_mb': 0}

        vid_req = urllib.request.Request(video_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tikwm.com/',
        })
        vid_response = opener.open(vid_req, timeout=60)

        total_size = vid_response.headers.get('Content-Length')
        total_size = int(total_size) if total_size else 0
        downloaded = 0
        block_size = 1024 * 256

        with open(filepath, 'wb') as f:
            while True:
                chunk = vid_response.read(block_size)
                if not chunk:
                    break
                f.write(chunk)
                downloaded += len(chunk)
                if total_size > 0:
                    pct = 20 + int(downloaded / total_size * 80)
                    self._tiktok_progress = {
                        'status': 'downloading',
                        'percent': pct,
                        'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                        'total_mb': round(total_size / (1024 * 1024), 1),
                    }
                else:
                    self._tiktok_progress = {
                        'status': 'downloading',
                        'percent': 50,
                        'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                    }

        self._tiktok_progress = {'status': 'done', 'percent': 100, 'downloaded_mb': round(downloaded / (1024 * 1024), 1)}

        if os.path.getsize(filepath) < 1024:
            os.remove(filepath)
            return None

        return filepath

    # ---------- Instagram Reels ----------
    def download_from_reels(self, url):
        """Download video from Instagram Reels link."""
        try:
            url = url.strip()
            if not re.search(r'instagram\.com/', url):
                return {'error': 'Invalid Instagram URL'}

            download_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_reels')
            os.makedirs(download_dir, exist_ok=True)

            self._reels_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

            filepath = self._reels_download(url, download_dir)
            if not filepath:
                return {'error': 'Failed to download Instagram Reels. Make sure the link is valid and the video is public.'}

            info = self.get_video_info(filepath)
            if info:
                return info
            return {'error': 'Downloaded file is not a valid video'}
        except Exception as e:
            self._reels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return {'error': f'Instagram Reels download failed: {str(e)}'}

    def get_reels_download_progress(self):
        return getattr(self, '_reels_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _reels_download(self, url, download_dir):
        self._reels_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

        clean_url = url.split('?')[0].rstrip('/')

        try:
            import yt_dlp
        except ImportError:
            self._reels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None

        # Extract shortcode for filename
        sc_match = re.search(r'/(?:reel|reels|p)/([A-Za-z0-9_-]+)', clean_url)
        shortcode = sc_match.group(1) if sc_match else 'reel'

        self._reels_progress = {'status': 'fetching_info', 'percent': 10, 'downloaded_mb': 0}

        def progress_hook(d):
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes', 0)
                pct = 20 + int(downloaded / total * 80) if total > 0 else 50
                self._reels_progress = {
                    'status': 'downloading',
                    'percent': min(pct, 99),
                    'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                    'total_mb': round(total / (1024 * 1024), 1) if total else 0,
                }
            elif d['status'] == 'finished':
                self._reels_progress = {'status': 'finalizing', 'percent': 95, 'downloaded_mb': 0}

        filepath = os.path.join(download_dir, f'reels_{shortcode}.mp4')

        ydl_opts = {
            'format': 'best[ext=mp4]/best',
            'outtmpl': filepath.replace('.mp4', '.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [progress_hook],
            'merge_output_format': 'mp4',
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(clean_url, download=True)
                result_path = ydl.prepare_filename(info)
                if not os.path.exists(result_path):
                    base, _ = os.path.splitext(result_path)
                    result_path = base + '.mp4'
                filepath = result_path
        except Exception:
            self._reels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None

        if not filepath or not os.path.exists(filepath) or os.path.getsize(filepath) < 1024:
            return None

        size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 1)
        self._reels_progress = {'status': 'done', 'percent': 100, 'downloaded_mb': size_mb}
        return filepath

        return filepath

    # ---------- YouTube Shorts ----------
    def download_from_ytshorts(self, url):
        """Download video from YouTube Shorts link."""
        try:
            url = url.strip()
            if not re.search(r'(youtube\.com/|youtu\.be/)', url):
                return {'error': 'Invalid YouTube URL'}

            download_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_ytshorts')
            os.makedirs(download_dir, exist_ok=True)

            self._ytshorts_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

            filepath = self._ytshorts_download(url, download_dir)
            if not filepath:
                return {'error': 'Failed to download YouTube Shorts. Make sure the link is valid and the video is public.'}

            info = self.get_video_info(filepath)
            if info:
                return info
            return {'error': 'Downloaded file is not a valid video'}
        except Exception as e:
            self._ytshorts_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return {'error': f'YouTube Shorts download failed: {str(e)}'}

    def get_ytshorts_download_progress(self):
        return getattr(self, '_ytshorts_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _extract_yt_video_id(self, url):
        patterns = [
            r'shorts/([a-zA-Z0-9_-]{11})',
            r'(?:v=|youtu\.be/)([a-zA-Z0-9_-]{11})',
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1)
        return None

    def _ytshorts_download(self, url, download_dir):
        self._ytshorts_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

        video_id = self._extract_yt_video_id(url)
        if not video_id:
            return None

        self._ytshorts_progress = {'status': 'fetching_info', 'percent': 10, 'downloaded_mb': 0}

        try:
            import yt_dlp
        except ImportError:
            return None

        yt_url = f'https://www.youtube.com/watch?v={video_id}'
        filepath = None

        def progress_hook(d):
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes', 0)
                pct = 20 + int(downloaded / total * 80) if total > 0 else 50
                self._ytshorts_progress = {
                    'status': 'downloading',
                    'percent': min(pct, 99),
                    'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                    'total_mb': round(total / (1024 * 1024), 1) if total else 0,
                }
            elif d['status'] == 'finished':
                self._ytshorts_progress = {'status': 'finalizing', 'percent': 95, 'downloaded_mb': 0}

        ydl_opts = {
            'format': 'best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best',
            'outtmpl': os.path.join(download_dir, 'ytshorts_%(title).60s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [progress_hook],
            'merge_output_format': 'mp4',
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(yt_url, download=True)
                filepath = ydl.prepare_filename(info)
                # If merged, extension may differ
                if not os.path.exists(filepath):
                    base, _ = os.path.splitext(filepath)
                    filepath = base + '.mp4'
        except Exception:
            self._ytshorts_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None

        if not filepath or not os.path.exists(filepath) or os.path.getsize(filepath) < 1024:
            return None

        size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 1)
        self._ytshorts_progress = {'status': 'done', 'percent': 100, 'downloaded_mb': size_mb}
        return filepath

    # ---------- Facebook Reels ----------
    def download_from_fbreels(self, url):
        """Download video from Facebook Reels/video link."""
        try:
            url = url.strip()
            if not re.search(r'(facebook\.com/|fb\.watch/|fb\.com/)', url):
                return {'error': 'Invalid Facebook URL'}

            download_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_fbreels')
            os.makedirs(download_dir, exist_ok=True)

            self._fbreels_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

            filepath = self._fbreels_download(url, download_dir)
            if not filepath:
                return {'error': 'Failed to download Facebook Reels. Make sure the link is valid and the video is public.'}

            info = self.get_video_info(filepath)
            if info:
                return info
            return {'error': 'Downloaded file is not a valid video'}
        except Exception as e:
            self._fbreels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return {'error': f'Facebook Reels download failed: {str(e)}'}

    def get_fbreels_download_progress(self):
        return getattr(self, '_fbreels_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _fbreels_download(self, url, download_dir):
        self._fbreels_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

        try:
            import yt_dlp
        except ImportError:
            self._fbreels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None

        self._fbreels_progress = {'status': 'fetching_info', 'percent': 10, 'downloaded_mb': 0}

        def progress_hook(d):
            if d['status'] == 'downloading':
                total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
                downloaded = d.get('downloaded_bytes', 0)
                pct = 20 + int(downloaded / total * 80) if total > 0 else 50
                self._fbreels_progress = {
                    'status': 'downloading',
                    'percent': min(pct, 99),
                    'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                    'total_mb': round(total / (1024 * 1024), 1) if total else 0,
                }
            elif d['status'] == 'finished':
                self._fbreels_progress = {'status': 'finalizing', 'percent': 95, 'downloaded_mb': 0}

        ydl_opts = {
            'format': 'best[ext=mp4]/best',
            'outtmpl': os.path.join(download_dir, 'fbreels_%(id)s.%(ext)s'),
            'quiet': True,
            'no_warnings': True,
            'progress_hooks': [progress_hook],
            'merge_output_format': 'mp4',
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        }

        filepath = None
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filepath = ydl.prepare_filename(info)
                if not os.path.exists(filepath):
                    base, _ = os.path.splitext(filepath)
                    filepath = base + '.mp4'
        except Exception:
            self._fbreels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None

        if not filepath or not os.path.exists(filepath) or os.path.getsize(filepath) < 1024:
            return None

        size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 1)
        self._fbreels_progress = {'status': 'done', 'percent': 100, 'downloaded_mb': size_mb}
        return filepath

    # ---------- Video Info ----------
    def get_video_info(self, filepath):
        ffmpeg_path = self._config.get('ffmpeg_path')
        return get_video_info(ffmpeg_path, filepath)

    # ---------- Cloning ----------
    def start_cloning(self, options):
        if self._cloner and self._cloner.progress.get('status') == 'running':
            return {'error': 'Cloning already in progress'}

        ffmpeg_path = self._config.get('ffmpeg_path')
        if not check_ffmpeg(ffmpeg_path):
            return {'error': 'FFmpeg not found'}

        source = options.get('source', '')
        if not source or not os.path.exists(source):
            return {'error': 'Source file not found'}

        output_folder = options.get('output_folder', '')
        if not output_folder:
            output_folder = os.path.dirname(source)
            options['output_folder'] = output_folder

        os.makedirs(output_folder, exist_ok=True)

        def on_complete(results, elapsed):
            info = get_video_info(ffmpeg_path, source)
            duration = info['duration'] if info else '0:00'
            self._history.add(
                source_file=os.path.basename(source),
                duration=duration,
                clone_count=options['count'],
                method=options.get('method', 'fast'),
                fmt=options.get('format', 'mp4'),
                elapsed_total=elapsed,
            )
            if self._config.get('notify_sound'):
                try:
                    winsound.MessageBeep(winsound.MB_OK)
                except Exception:
                    pass

        def on_error(error_msg):
            pass

        self._cloner = VideoCloner(
            ffmpeg_path=ffmpeg_path,
            source=source,
            options=options,
            on_complete=on_complete,
            on_error=on_error,
        )
        self._cloner.start()
        return {'status': 'started'}

    def cancel_cloning(self):
        if self._cloner:
            self._cloner.cancel()
            return {'status': 'cancelled'}
        return {'status': 'no_active_clone'}

    def get_clone_progress(self):
        if self._cloner:
            return dict(self._cloner.progress)
        return {'status': 'idle'}

    # ---------- Config ----------
    def get_config(self):
        return self._config.to_dict()

    def save_config(self, config):
        self._config.update(config)
        return {'status': 'saved'}

    # ---------- History ----------
    def get_history(self):
        return self._history.get_all()

    def clear_history(self):
        self._history.clear()
        return {'status': 'cleared'}

    # ---------- FFmpeg ----------
    def check_ffmpeg(self):
        ffmpeg_path = self._config.get('ffmpeg_path')
        version = check_ffmpeg(ffmpeg_path)
        return {'available': version is not None, 'version': version, 'path': ffmpeg_path}

    # ---------- Window Controls ----------
    def minimize_window(self):
        self._window.minimize()

    def toggle_maximize(self):
        self._window.toggle_fullscreen()

    def close_window(self):
        self._window.destroy()

    # ---------- Utility ----------
    def open_folder(self, path):
        if os.path.isdir(path):
            os.startfile(path)
            return True
        return False

    def play_notification_sound(self):
        try:
            winsound.MessageBeep(winsound.MB_OK)
            return True
        except Exception:
            return False
