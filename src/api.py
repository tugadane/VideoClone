import os
import re
import json
import subprocess
import tempfile
import urllib.request
import urllib.parse
import http.cookiejar
import winsound
import webview
from config import Config
from history import History
from cloner import VideoCloner, get_video_info, check_ffmpeg


def _safe_filename(text, fallback='video', max_len=60):
    """Sanitize text for use as a filename component.

    Strips non-ASCII chars (emojis especially), Windows-reserved chars,
    control chars, and trailing dots/spaces. Falls back to ``fallback``
    if the result is empty.

    Why ASCII-only: ffprobe.exe / ffmpeg.exe on Windows convert command-line
    args from UTF-16 to the system codepage (e.g. CP1252) before opening
    the file. Emoji and other supplementary-plane chars become '?' and the
    open fails, so the downloaded video is rejected as "not a valid video".
    """
    text = text or ''
    cleaned = re.sub(r'[^\x20-\x7E]', '', text)
    cleaned = re.sub(r'[<>:"/\\|?*\n\r\t]', '', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip().strip('.').strip()
    if max_len > 0:
        cleaned = cleaned[:max_len].rstrip().rstrip('.').rstrip()
    return cleaned or fallback


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

    def select_overlay_image(self):
        file_types = ('Image Files (*.png;*.jpg;*.jpeg;*.webp;*.bmp;*.gif)',)
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
                info['source_platform'] = 'gdrive'
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
                info['source_platform'] = 'tiktok'
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
        title = video_data.get('title', '')
        safe_title = _safe_filename(title, fallback=str(video_id), max_len=60)
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
                info['source_platform'] = 'reels'
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
            'source_address': '0.0.0.0',
            'restrictfilenames': True,
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
                info['source_platform'] = 'ytshorts'
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
            'source_address': '0.0.0.0',
            'restrictfilenames': True,
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

    # ---------- Shopee Video ----------
    def download_from_shopee(self, url):
        """Download video from Shopee Video share link."""
        try:
            url = url.strip()
            if not re.search(r'(shp\.ee/|shopee\.[a-z.]+/|sv\.shopee\.[a-z.]+/)', url, flags=re.IGNORECASE):
                return {'error': 'Invalid Shopee URL'}

            download_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_shopee')
            os.makedirs(download_dir, exist_ok=True)

            self._shopee_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

            filepath, err = self._shopee_download(url, download_dir)
            if not filepath:
                return {'error': err or 'Failed to download Shopee video. Make sure the link is valid and the video is public.'}

            info = self.get_video_info(filepath)
            if info:
                info['source_platform'] = 'shopee'
                return info
            return {'error': 'Downloaded file is not a valid video (ffprobe failed to read it).'}
        except Exception as e:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return {'error': f'Shopee download failed: {str(e)}'}

    def get_shopee_download_progress(self):
        return getattr(self, '_shopee_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _shopee_download(self, url, download_dir):
        self._shopee_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(cj),
            urllib.request.HTTPRedirectHandler(),
        )
        ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        headers = {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        }

        self._shopee_progress = {'status': 'fetching_info', 'percent': 10, 'downloaded_mb': 0}

        # Resolve & fetch the share page (urllib auto-follows redirects)
        try:
            req = urllib.request.Request(url, headers=headers)
            response = opener.open(req, timeout=30)
            final_url = response.geturl()
            html_content = response.read().decode('utf-8', errors='ignore')
        except Exception as e:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, f'Failed to fetch Shopee share page: {e}'

        # If we landed on the desktop "universal-link" page, manually follow the
        # embedded ?redir= URL to reach sv.shopee.<region>/share-video/...
        if 'universal-link' in final_url and 'sv.shopee' not in final_url:
            redir_match = re.search(r'[?&]redir=([^&]+)', final_url)
            if redir_match:
                target = urllib.parse.unquote(redir_match.group(1))
                try:
                    req = urllib.request.Request(target, headers=headers)
                    response = opener.open(req, timeout=30)
                    final_url = response.geturl()
                    html_content = response.read().decode('utf-8', errors='ignore')
                except Exception as e:
                    self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
                    return None, f'Failed to follow Shopee universal-link redirect: {e}'

        # Detect if the URL resolved to a non-video Shopee page
        # (e.g. a product page like shopee.co.id/{shop}/{shopid}/{itemid}).
        # The video share page lives under sv.shopee.<region>/share-video/...
        if 'sv.shopee' not in final_url and '/share-video/' not in final_url:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, 'Shopee URL bukan halaman video (kemungkinan link produk/etalase, bukan Shopee Video).'

        # Extract __NEXT_DATA__ JSON injected by Shopee's Next.js page
        m = re.search(
            r'<script id="__NEXT_DATA__" type="application/json">(\{.*?\})</script>',
            html_content,
        )
        if not m:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, 'Halaman Shopee tidak berisi data video (struktur halaman berubah atau video sudah tidak tersedia).'

        try:
            data = json.loads(m.group(1))
        except Exception as e:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, f'Gagal parse data video Shopee: {e}'

        media_video = (
            data.get('props', {})
            .get('pageProps', {})
            .get('mediaInfo', {})
            .get('video', {})
        )
        # Shopee's public share page only exposes the watermarked URL.
        # If neither field exists, the URL likely wasn't a video share page
        # (e.g. it resolved to a product/shop page).
        video_url = media_video.get('watermarkVideoUrl') or media_video.get('videoUrl')
        if not video_url:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, 'Halaman Shopee tidak punya URL video (mungkin video private atau sudah dihapus).'

        # Build a filename from caption or postId. Use _safe_filename so emojis
        # and other non-ASCII chars don't break ffprobe.exe on Windows.
        post_id = (
            data.get('props', {}).get('pageProps', {}).get('query', {}).get('postId')
            or 'video'
        )
        post_id_safe = _safe_filename(str(post_id), fallback='video', max_len=24)
        caption = media_video.get('caption') or ''
        base_name = _safe_filename(caption, fallback=post_id_safe, max_len=60)
        filename = f'shopee_{base_name}.mp4'
        filepath = os.path.join(download_dir, filename)

        self._shopee_progress = {'status': 'downloading', 'percent': 20, 'downloaded_mb': 0}

        try:
            vid_req = urllib.request.Request(video_url, headers={
                'User-Agent': ua,
                'Accept': '*/*',
                'Referer': 'https://sv.shopee.co.id/',
            })
            vid_response = opener.open(vid_req, timeout=60)
        except Exception as e:
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, f'Failed to download video file from CDN: {e}'

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
                    self._shopee_progress = {
                        'status': 'downloading',
                        'percent': min(pct, 99),
                        'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                        'total_mb': round(total_size / (1024 * 1024), 1),
                    }
                else:
                    self._shopee_progress = {
                        'status': 'downloading',
                        'percent': 50,
                        'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                    }

        self._shopee_progress = {
            'status': 'done',
            'percent': 100,
            'downloaded_mb': round(downloaded / (1024 * 1024), 1),
        }

        if os.path.getsize(filepath) < 1024:
            os.remove(filepath)
            self._shopee_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return None, 'Downloaded video file is too small (likely an error page from Shopee CDN).'

        return filepath, None

    # ---------- Facebook Reels Scraper ----------
    _FB_PROFILE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.fb_profile')

    def fb_check_login(self):
        """Check if Facebook login profile exists."""
        marker = os.path.join(self._FB_PROFILE_DIR, '.logged_in')
        return {'logged_in': os.path.exists(marker)}

    def fb_logout(self):
        """Clear saved Facebook session."""
        import shutil
        try:
            if os.path.exists(self._FB_PROFILE_DIR):
                shutil.rmtree(self._FB_PROFILE_DIR, ignore_errors=True)
            return {'status': 'ok'}
        except Exception as e:
            return {'error': str(e)}

    def fb_login(self):
        """Open Chrome for user to login to Facebook. Profile is saved for future scraping."""
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
        except ImportError:
            return {'error': 'Selenium not installed'}

        import time as _time
        import threading

        marker = os.path.join(self._FB_PROFILE_DIR, '.logged_in')
        if os.path.exists(marker):
            os.remove(marker)

        os.makedirs(self._FB_PROFILE_DIR, exist_ok=True)
        opts = Options()
        opts.add_argument(f'--user-data-dir={self._FB_PROFILE_DIR}')
        opts.add_argument('--no-sandbox')
        opts.add_argument('--disable-notifications')
        opts.add_argument('--window-size=500,700')

        def _run():
            driver = None
            try:
                driver = webdriver.Chrome(options=opts)
                driver.get('https://www.facebook.com/login')
                for _ in range(300):
                    try:
                        current = driver.current_url
                        if 'login' not in current and 'checkpoint' not in current:
                            cookies = driver.get_cookies()
                            if any(c['name'] == 'c_user' for c in cookies):
                                with open(marker, 'w') as f:
                                    f.write('1')
                            _time.sleep(2)
                            break
                    except Exception:
                        break
                    _time.sleep(1)
            except Exception:
                pass
            finally:
                if driver:
                    try:
                        driver.quit()
                    except Exception:
                        pass

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return {'status': 'ok'}

    def _normalize_fb_reels_page_url(self, url):
        """Normalize supported Facebook page/profile URLs to a reels endpoint."""
        raw_url = (url or '').strip()
        if not raw_url:
            return None

        if not re.search(r'facebook\.com/.+', raw_url):
            return None

        if not re.match(r'^https?://', raw_url, flags=re.IGNORECASE):
            raw_url = f'https://{raw_url.lstrip('/')}'

        parsed = urllib.parse.urlsplit(raw_url)
        host = (parsed.hostname or '').lower()
        if not (host == 'facebook.com' or host.endswith('.facebook.com') or host == 'fb.com' or host.endswith('.fb.com')):
            return None

        # Unwrap Facebook redirect links like l.facebook.com/l.php?u=<actual_url>
        if host.startswith('l.facebook.com'):
            target_url = (urllib.parse.parse_qs(parsed.query).get('u') or [''])[0].strip()
            if target_url:
                return self._normalize_fb_reels_page_url(target_url)
            return None

        path = (parsed.path or '').rstrip('/')
        path_lower = path.lower()
        query = urllib.parse.parse_qs(parsed.query, keep_blank_values=False)

        # Support profile-style URL, e.g. /profile.php?id=...&sk=reels_tab
        if path_lower == '/profile.php':
            profile_id = (query.get('id') or [''])[0].strip()
            if not profile_id:
                return None
            quoted_id = urllib.parse.quote(profile_id, safe='')
            return f'https://www.facebook.com/profile.php?id={quoted_id}&sk=reels_tab'

        if path_lower.endswith('/reels'):
            return urllib.parse.urlunsplit(('https', 'www.facebook.com', path, '', ''))

        segments = [seg for seg in path.split('/') if seg]
        if segments:
            return f'https://www.facebook.com/{segments[0]}/reels'

        return None

    def scrape_fb_reels(self, url, limit=0, scroll_count=3, order='desc'):
        """Scrape reel video links from a Facebook page/profile reels URL."""
        url = self._normalize_fb_reels_page_url(url)
        if not url:
            return {'error': 'Invalid Facebook page URL. Use /PageName/reels or /profile.php?id=...&sk=reels_tab'}

        limit = int(limit) if limit else 0
        scroll_count = int(scroll_count) if scroll_count else 3
        order = str(order).lower() if order else 'desc'
        if order not in ('asc', 'desc'):
            order = 'desc'
        is_logged_in = os.path.exists(os.path.join(self._FB_PROFILE_DIR, '.logged_in'))

        # Use visible Chrome with profile (logged in) for full scraping
        if is_logged_in and scroll_count > 0:
            unique_ids = self._scrape_fb_reels_browser(url, scroll_count)
        else:
            unique_ids = []

        # Fallback to requests (fast, ~10 reels, no login needed)
        if not unique_ids:
            unique_ids = self._scrape_fb_reels_requests(url)

        if not unique_ids:
            return {'error': 'No reels found. Make sure the page has public reels.'}

        # Apply limit first, then optional reverse order.
        # Example: total 15, limit 10, desc => use items 1..10 then return 10..1.
        selected_ids = unique_ids[:limit] if limit > 0 else list(unique_ids)
        if order == 'desc':
            selected_ids = list(reversed(selected_ids))

        links = [f'https://www.facebook.com/reel/{rid}' for rid in selected_ids]
        return {'links': links, 'count': len(links)}

    def _scrape_fb_reels_requests(self, url):
        """Scrape via HTTP request (fast, ~10 reels max without login)."""
        try:
            import requests as req_lib
        except ImportError:
            return []
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate',
        }
        try:
            r = req_lib.get(url, headers=headers, timeout=30, allow_redirects=True)
            if r.status_code != 200:
                return []
        except Exception:
            return []
        seen = set()
        unique = []
        for vid in re.findall(r'"video_id":"(\d+)"', r.text):
            if vid not in seen:
                seen.add(vid)
                unique.append(vid)
        return unique

    def _scrape_fb_reels_browser(self, url, scroll_count=3):
        """Open Chrome, force-scroll reels feed, then scrape all reel IDs."""
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.options import Options
        except ImportError:
            return []

        import time as _time

        opts = Options()
        opts.add_argument(f'--user-data-dir={self._FB_PROFILE_DIR}')
        opts.add_argument('--no-sandbox')
        opts.add_argument('--disable-notifications')
        opts.add_argument('--disable-popup-blocking')
        opts.add_argument('--window-size=1200,900')
        opts.add_argument('--window-position=50,50')

        try:
            driver = webdriver.Chrome(options=opts)
        except Exception:
            return []

        driver.set_page_load_timeout(30)
        unique_ids = []

        try:
            # Step 1: Load the page
            driver.get(url)
            _time.sleep(5)

            # Remove login popups/overlays
            driver.execute_script("""
                document.querySelectorAll('[role="dialog"]').forEach(e => e.remove());
                document.body.style.overflow = 'auto';
                document.documentElement.style.overflow = 'auto';
            """)

            # Step 2: Scroll N times first (let Facebook load more content)
            rounds = max(1, int(scroll_count))
            for _ in range(rounds):
                before_h = driver.execute_script(
                    "return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);"
                )

                # Scroll window and all scrollable containers to force lazy loading.
                driver.execute_script("""
                    const rootH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                    window.scrollTo(0, rootH);
                    window.scrollBy(0, window.innerHeight * 0.9);

                    const nodes = Array.from(document.querySelectorAll('*'));
                    for (const el of nodes) {
                        const s = window.getComputedStyle(el);
                        const canY = /auto|scroll/.test(s.overflowY || '') && el.scrollHeight > el.clientHeight + 20;
                        if (canY) {
                            el.scrollTop = el.scrollHeight;
                        }
                    }
                """)

                # Remove popups that appear during scroll
                driver.execute_script("""
                    document.querySelectorAll('[role="dialog"]').forEach(e => e.remove());
                    document.body.style.overflow = 'auto';
                    document.documentElement.style.overflow = 'auto';
                """)
                _time.sleep(2.3)

                after_h = driver.execute_script(
                    "return Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);"
                )
                if after_h <= before_h:
                    driver.execute_script('window.scrollBy(0, window.innerHeight * 1.2)')
                    _time.sleep(1.2)

            # Step 3: After scrolling, take links by visual position (top->bottom, left->right).
            _time.sleep(1)
            seen = set()

            ordered_ids = driver.execute_script("""
                const pickId = (href) => {
                    if (!href) return null;
                    const m = href.match(/\/reel\/(\d+)|[?&]v=(\d+)|\/videos\/(\d+)/);
                    return m ? (m[1] || m[2] || m[3]) : null;
                };

                const nodes = Array.from(document.querySelectorAll('a[href*="/reel/"], a[href*="/watch/?v="], a[href*="/videos/"]'));
                const items = [];

                nodes.forEach((a, idx) => {
                    const href = a.href || a.getAttribute('href') || '';
                    const vid = pickId(href);
                    if (!vid) return;
                    const rect = a.getBoundingClientRect();
                    items.push({
                        vid,
                        top: rect.top + window.scrollY,
                        left: rect.left + window.scrollX,
                        idx,
                    });
                });

                items.sort((a, b) => {
                    if (Math.abs(a.top - b.top) > 3) return a.top - b.top;
                    if (Math.abs(a.left - b.left) > 3) return a.left - b.left;
                    return a.idx - b.idx;
                });

                return items.map(x => x.vid);
            """) or []

            for vid in ordered_ids:
                if vid not in seen:
                    seen.add(vid)
                    unique_ids.append(vid)

            # Fallback: append extra IDs found in source that were not present in visual links.
            src = driver.page_source
            for vid in re.findall(r'"video_id":"(\d+)"', src):
                if vid not in seen:
                    seen.add(vid)
                    unique_ids.append(vid)
        except Exception:
            pass
        finally:
            try:
                driver.quit()
            except Exception:
                pass

        return unique_ids

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
                info['source_platform'] = 'fbreels'
                return info
            return {'error': 'Downloaded file is not a valid video'}
        except Exception as e:
            self._fbreels_progress = {'status': 'error', 'percent': 0, 'downloaded_mb': 0}
            return {'error': f'Facebook Reels download failed: {str(e)}'}

    def get_fbreels_download_progress(self):
        return getattr(self, '_fbreels_progress', {'status': 'idle', 'percent': 0, 'downloaded_mb': 0})

    def _fbreels_download(self, url, download_dir):
        self._fbreels_progress = {'status': 'resolving', 'percent': 0, 'downloaded_mb': 0}

        # Extract video ID from URL
        vid_match = re.search(r'(?:/reel/|/watch/?\?v=|/videos/|/video\.php\?v=)(\d+)', url)
        video_id = vid_match.group(1) if vid_match else None

        # Try direct scraping first (works on mobile ISPs where www.facebook.com is blocked)
        if video_id:
            filepath = self._fbreels_direct_download(video_id, download_dir)
            if filepath:
                return filepath

        # Fallback to yt_dlp
        return self._fbreels_ytdlp_download(url, download_dir)

    def _fbreels_direct_download(self, video_id, download_dir):
        """Download Facebook video by scraping m.facebook.com directly."""
        import html as html_mod
        try:
            import requests as req_lib
        except ImportError:
            return None

        self._fbreels_progress = {'status': 'fetching_info', 'percent': 10, 'downloaded_mb': 0}

        session = req_lib.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-site': 'none',
            'sec-fetch-dest': 'document',
            'sec-fetch-user': '?1',
            'upgrade-insecure-requests': '1',
            'Cache-Control': 'max-age=0',
        }

        try:
            r = session.get(f'https://m.facebook.com/reel/{video_id}', headers=headers, timeout=15)
            if r.status_code != 200 or len(r.text) < 10000:
                return None
        except Exception:
            return None

        # Detect private/restricted reels: Facebook returns a small JS-only shell
        # with generic "Facebook" title when the reel is not publicly accessible
        page_title = re.findall(r'<title>([^<]+)</title>', r.text)
        if page_title and page_title[0].strip() == 'Facebook' and len(r.text) < 60000:
            raise Exception('Video ini tidak dapat diakses. Kemungkinan video bersifat privat atau hanya untuk teman (friends-only).')

        # Find video CDN URL (mp4) in the HTML (try with html-unescaped text too)
        decoded_text = html_mod.unescape(r.text)
        video_urls = re.findall(
            r'(https?://video[a-z0-9.-]*\.fbcdn\.net/[^\s"\'<>]+\.mp4[^\s"\'<>]*)',
            decoded_text
        )
        if not video_urls:
            return None

        video_url = video_urls[0]

        self._fbreels_progress = {'status': 'downloading', 'percent': 20, 'downloaded_mb': 0}

        # Download the video file
        try:
            vid_r = session.get(video_url, headers={'User-Agent': headers['User-Agent']}, stream=True, timeout=30)
            filepath = os.path.join(download_dir, f'fbreels_{video_id}.mp4')
            total_bytes = int(vid_r.headers.get('content-length', 0))
            downloaded = 0
            with open(filepath, 'wb') as f:
                for chunk in vid_r.iter_content(8192):
                    f.write(chunk)
                    downloaded += len(chunk)
                    if total_bytes > 0:
                        pct = 20 + int(downloaded / total_bytes * 75)
                        self._fbreels_progress = {
                            'status': 'downloading',
                            'percent': min(pct, 95),
                            'downloaded_mb': round(downloaded / (1024 * 1024), 1),
                            'total_mb': round(total_bytes / (1024 * 1024), 1),
                        }
        except Exception:
            return None

        if not os.path.exists(filepath) or os.path.getsize(filepath) < 10000:
            return None

        size_mb = round(os.path.getsize(filepath) / (1024 * 1024), 1)
        self._fbreels_progress = {'status': 'done', 'percent': 100, 'downloaded_mb': size_mb}
        return filepath

    def _fbreels_ytdlp_download(self, url, download_dir):
        """Download Facebook video via yt_dlp (fallback)."""
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
            'source_address': '0.0.0.0',
            'restrictfilenames': True,
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

        # Support multi-source
        sources = options.get('sources', [])
        if sources:
            for src in sources:
                fp = src.get('filepath', '')
                if not fp or not os.path.exists(fp):
                    return {'error': f'Source file not found: {os.path.basename(fp)}'}
            first_source = sources[0]['filepath']
            total_count = sum(s.get('count', 1) for s in sources)
        else:
            # Legacy single-source fallback
            source = options.get('source', '')
            if not source or not os.path.exists(source):
                return {'error': 'Source file not found'}
            first_source = source
            sources = [{'filepath': source, 'count': options.get('count', 10)}]
            options['sources'] = sources
            total_count = options.get('count', 10)

        output_folder = options.get('output_folder', '')
        if not output_folder:
            output_folder = os.path.dirname(first_source)
            options['output_folder'] = output_folder

        os.makedirs(output_folder, exist_ok=True)

        def on_complete(results, elapsed):
            info = get_video_info(ffmpeg_path, first_source)
            duration = info['duration'] if info else '0:00'
            source_names = ', '.join(os.path.basename(s['filepath']) for s in sources)
            self._history.add(
                source_file=source_names,
                duration=duration,
                clone_count=total_count,
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
            source=first_source,
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

    # ---------- Extract BGM from Link ----------
    def extract_bgm_from_link(self, source, url):
        """Download video from link and extract audio as BGM."""
        try:
            self._bgm_extract_progress = {'percent': 0, 'label': 'Downloading video...'}

            # Reuse existing download methods to get the video file
            download_methods = {
                'tiktok': self.download_from_tiktok,
                'reels': self.download_from_reels,
                'fbreels': self.download_from_fbreels,
                'ytshorts': self.download_from_ytshorts,
                'shopee': self.download_from_shopee,
            }

            method = download_methods.get(source)
            if not method:
                return {'error': f'Unsupported source: {source}'}

            self._bgm_extract_progress = {'percent': 10, 'label': 'Downloading video...'}
            result = method(url)

            if not result or result.get('error'):
                return {'error': result.get('error', 'Download failed')}

            video_path = result.get('filepath')
            if not video_path or not os.path.isfile(video_path):
                return {'error': 'Downloaded video file not found'}

            # Extract audio using FFmpeg
            self._bgm_extract_progress = {'percent': 70, 'label': 'Extracting audio...'}

            ffmpeg_path = self._config.get('ffmpeg_path') or 'ffmpeg'
            audio_dir = os.path.join(tempfile.gettempdir(), 'clone_studio_bgm')
            os.makedirs(audio_dir, exist_ok=True)

            base_name = os.path.splitext(os.path.basename(video_path))[0]
            audio_filename = f'{base_name}_audio.m4a'
            audio_path = os.path.join(audio_dir, audio_filename)

            cmd = [
                ffmpeg_path, '-y', '-i', video_path,
                '-vn', '-acodec', 'aac', '-b:a', '192k',
                audio_path,
            ]

            proc = subprocess.run(
                cmd, capture_output=True, text=True,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )

            if proc.returncode != 0 or not os.path.isfile(audio_path):
                return {'error': 'Failed to extract audio from video'}

            self._bgm_extract_progress = {'percent': 100, 'label': 'Done!'}
            return {'filepath': audio_path, 'filename': audio_filename}

        except Exception as e:
            self._bgm_extract_progress = {'percent': 0, 'label': 'Error'}
            return {'error': f'BGM extraction failed: {str(e)}'}

    def get_bgm_extract_progress(self):
        return getattr(self, '_bgm_extract_progress', {'percent': 0, 'label': ''})

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
