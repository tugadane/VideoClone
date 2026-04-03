# Development Guide — Clone Studio

Panduan teknis implementasi Clone Studio. File ini menjadi acuan agar proses development tidak keluar jalur.

## Aturan Rilis Wajib

Setiap ada perubahan pada aplikasi, lakukan dua hal berikut sebelum dianggap selesai:

1. Buat/update catatan perubahan dalam file Markdown.
2. Naikkan versi aplikasi (minimal patch), lalu sinkronkan di file terkait.

Lokasi catatan perubahan:
- Ringkasan resmi: `docs/CHANGELOG.md`
- Catatan per-perubahan: `docs/changes/YYYY-MM-DD-vX.Y.Z.md`

Checklist sinkronisasi versi minimal:
- `installer.iss` (`MyAppVersion`)
- `src/main.py` (judul window)
- `src/web/index.html` (title + badge)
- `docs/README.md` (bagian informasi proyek)

---

## Arsitektur

```
┌──────────────────────────────────────────────────────┐
│                    pywebview Window                   │
│  ┌────────────────────────────────────────────────┐  │
│  │              Frontend (HTML/JS/CSS)            │  │
│  │                                                │  │
│  │  index.html + app.js + Tailwind CSS            │  │
│  │      │                                         │  │
│  │      │  window.pywebview.api.xxxxx()           │  │
│  │      ▼                                         │  │
│  ├────────────────────────────────────────────────┤  │
│  │              Python Backend (API)              │  │
│  │                                                │  │
│  │  main.py ─── API class exposed to JS          │  │
│  │    ├── cloner.py ─── FFmpeg subprocess         │  │
│  │    ├── config.py ─── JSON read/write           │  │
│  │    └── history.py ── JSON read/write           │  │
│  │            │                                   │  │
│  │            ▼                                   │  │
│  │    ffmpeg/ffmpeg.exe (portable)                │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Alur komunikasi:**
1. User berinteraksi dengan UI (HTML/JS)
2. JS memanggil Python via `window.pywebview.api.method_name(args)`
3. Python menjalankan logic (FFmpeg subprocess, file I/O)
4. Python return hasil ke JS (dict/list → otomatis jadi JSON)
5. JS update UI berdasarkan response

---

## File & Tanggung Jawab

### `src/main.py` — Entry Point

```python
import webview
from api import Api

def main():
    api = Api()
    window = webview.create_window(
        title="Clone Studio v0.3.1",
        url="web/index.html",
        js_api=api,
        width=1280,
        height=800,
        min_size=(1024, 600),
        frameless=True,       # Custom title bar di HTML
        easy_drag=False,
    )
    api.set_window(window)
    webview.start(debug=False)

if __name__ == "__main__":
    main()
```

### `src/api.py` — API Bridge (Python ↔ JS)

Kelas ini di-expose ke JS via `window.pywebview.api`.

```python
class Api:
    def __init__(self):
        self.window = None
        self.config = Config()
        self.history = History()
        self.cloner = None  # active cloner instance

    def set_window(self, window):
        self.window = window

    # ---------- File Dialog ----------
    def select_video_file(self):
        """Buka file dialog, return path video yang dipilih."""

    def select_output_folder(self):
        """Buka folder dialog, return path folder."""

    def select_ffmpeg_path(self):
        """Buka file dialog untuk ffmpeg.exe."""

    # ---------- Video Info ----------
    def get_video_info(self, filepath):
        """Jalankan ffprobe, return dict info video."""

    # ---------- Cloning ----------
    def start_cloning(self, options):
        """Mulai proses clone di thread terpisah.
        options = {
            'source': str,          # path video sumber
            'count': int,           # jumlah clone
            'method': str,          # 'fast' | 'standard'
            'format': str,          # 'mp4' | 'mkv' | ...
            'output_folder': str,   # path folder output
            'template': str,        # naming template
        }
        """

    def cancel_cloning(self):
        """Batalkan proses clone yang sedang berjalan."""

    def get_clone_progress(self):
        """Return status progress saat ini."""

    # ---------- Config ----------
    def get_config(self):
        """Return semua settings sebagai dict."""

    def save_config(self, config):
        """Simpan settings ke config.json."""

    # ---------- History ----------
    def get_history(self):
        """Return list history entries."""

    def clear_history(self):
        """Hapus semua history."""

    # ---------- FFmpeg ----------
    def check_ffmpeg(self):
        """Cek apakah FFmpeg tersedia, return version string atau None."""

    # ---------- Window Controls ----------
    def minimize_window(self):
        self.window.minimize()

    def toggle_maximize(self):
        self.window.toggle_fullscreen()

    def close_window(self):
        self.window.destroy()

    # ---------- Notification ----------
    def play_notification_sound(self):
        """Play sound notification via winsound."""
```

### `src/cloner.py` — FFmpeg Cloning Logic

```python
class VideoCloner:
    def __init__(self, ffmpeg_path, source, options, on_progress, on_complete, on_error):
        self.ffmpeg_path = ffmpeg_path
        self.source = source
        self.options = options
        self.on_progress = on_progress    # callback(index, filename, status, time_elapsed)
        self.on_complete = on_complete    # callback(results)
        self.on_error = on_error          # callback(error_msg)
        self.cancelled = False
        self.thread = None

    def start(self):
        """Mulai cloning di thread terpisah."""

    def cancel(self):
        """Set flag cancelled, kill subprocess aktif."""

    def _run(self):
        """Loop utama: generate clone 1 per 1."""

    def _generate_clone(self, index):
        """Generate 1 clone. Return (filename, elapsed_time)."""

    def _build_ffmpeg_command(self, index, output_path):
        """Build FFmpeg command berdasarkan method."""

    def _resolve_filename(self, index):
        """Resolve template → filename. Handle auto-rename jika file sudah ada."""
```

### `src/config.py` — Settings Management

```python
class Config:
    DEFAULT = {
        'ffmpeg_path': './ffmpeg/ffmpeg.exe',
        'default_clone_count': 10,
        'default_format': 'mp4',
        'default_template': '{title}_clone{index}_{date}',
        'default_output_folder': '',  # kosong = sama dengan sumber
        'default_method': 'fast',
        'notify_popup': True,
        'notify_sound': True,
    }

    def __init__(self, path='config.json'):
        ...

    def load(self): ...
    def save(self): ...
    def get(self, key): ...
    def set(self, key, value): ...
    def to_dict(self): ...
```

**Lokasi file:** `config.json` di root folder aplikasi.

### `src/history.py` — History Management

```python
class History:
    def __init__(self, path='history.json'):
        ...

    def add(self, entry):
        """Tambah entry baru.
        entry = {
            'id': str (uuid),
            'source_file': str,
            'source_size': int,
            'duration': str,
            'clone_count': int,
            'method': str,
            'format': str,
            'output_folder': str,
            'template': str,
            'timestamp': str (ISO),
            'elapsed_total': float,
        }
        """

    def get_all(self): ...
    def clear(self): ...
```

**Lokasi file:** `history.json` di root folder aplikasi.

### `src/web/index.html` — UI Utama

Berdasarkan `ui_preview_v2.html` (approved). Akan dikonversi menjadi UI fungsional dengan:
- Tailwind CSS via CDN (atau bundled)
- Material Symbols via CDN
- Work Sans font via Google Fonts

### `src/web/app.js` — Frontend Logic

```javascript
// Tunggu pywebview ready
window.addEventListener('pywebviewready', () => {
    init();
});

async function init() {
    // Load config
    // Check FFmpeg status
    // Load history
    // Setup drag & drop
    // Setup event listeners
}

// --- File Selection ---
async function selectVideoFile() { ... }
async function onFileSelected(filepath) { ... }

// --- Cloning ---
async function startCloning() { ... }
async function cancelCloning() { ... }
function pollProgress() { ... }    // setInterval polling progress

// --- UI Updates ---
function updateProgress(data) { ... }
function showComplete(results) { ... }
function updateTaskQueue(items) { ... }

// --- History ---
async function loadHistory() { ... }
async function clearHistory() { ... }

// --- Settings ---
async function loadConfig() { ... }
async function saveConfig(config) { ... }

// --- Utility ---
function updateTemplatePreview() { ... }
function showGuideModal() { ... }
```

---

## FFmpeg Commands

### Mendapatkan Info Video (ffprobe)

```bash
ffprobe -v quiet -print_format json -show_format -show_streams "input.mp4"
```

Output diparse → extract: duration, resolution, codec, bitrate, file size.

### Method: Fast (metadata + invisible filter)

Setiap clone menggunakan kombinasi unik dari:

1. **Metadata unik** — comment, title, creation_time berbeda per clone
2. **Invisible audio/video filter** — noise imperceptible

```bash
ffmpeg -i "input.mp4" \
    -c:v copy \
    -c:a aac -b:a 128k -af "aeval='val(0)+random(0)*0.0001':c=same" \
    -metadata comment="clone_01_a3f8b1" \
    -metadata title="Clone 01" \
    -metadata creation_time="2026-03-10T14:30:01" \
    -y "output_clone01.mp4"
```

**Catatan:**
- Video stream di-copy (tanpa re-encode) → cepat & kualitas identik
- Audio di re-encode ringan dengan noise sangat kecil → binary berbeda
- Metadata unik per clone → hash file pasti berbeda
- Waktu: ~3-5 detik per clone (video 1 menit)

### Method: Standard (light re-encode)

```bash
ffmpeg -i "input.mp4" \
    -c:v libx264 -crf 18 -preset fast \
    -c:a aac -b:a 128k \
    -metadata comment="clone_01_a3f8b1" \
    -metadata creation_time="2026-03-10T14:30:01" \
    -vf "noise=c0s=1:c0f=t+u" \
    -y "output_clone01.mp4"
```

**Catatan:**
- Video di re-encode dengan CRF 18 (visually lossless)
- Noise filter sangat kecil (imperceptible)
- Setiap clone akan menghasilkan binary yang sangat berbeda
- Waktu: ~10-20 detik per clone (video 1 menit)

### Variasi Antar Clone

Untuk memastikan setiap clone unik:

| Parameter         | Variasi per clone                               |
| ----------------- | ----------------------------------------------- |
| `metadata comment`| UUID atau random string unik                    |
| `creation_time`   | Timestamp + offset (detik) per clone            |
| `audio noise seed`| Random seed berbeda per clone                   |
| `video noise` (standard) | Random seed berbeda per clone            |

---

## Progress & Threading

```
Main Thread (pywebview)
    │
    ├── UI Thread (webview/JS)
    │       │
    │       └── setInterval → api.get_clone_progress() setiap 500ms
    │
    └── Clone Thread (threading.Thread)
            │
            ├── Loop: for i in range(clone_count)
            │       ├── _generate_clone(i)
            │       │       ├── subprocess.run(ffmpeg...)
            │       │       └── update progress state
            │       └── check cancelled flag
            │
            └── on_complete() / on_error()
```

**Mekanisme progress:**
1. `start_cloning()` → jalankan `VideoCloner` di thread terpisah
2. `VideoCloner._run()` loop setiap clone, update `self.progress` dict
3. JS polling `get_clone_progress()` setiap 500ms via setInterval
4. JS update UI (progress bar, task queue list)
5. Saat selesai, `on_complete()` dipanggil → JS show notification

**Progress data structure:**
```python
{
    'status': 'running',          # 'idle' | 'running' | 'completed' | 'error' | 'cancelled'
    'current_index': 7,           # clone ke berapa saat ini (1-based)
    'total': 10,
    'percent': 60,
    'current_file': 'my_video_clone07_2026-03-10.mp4',
    'elapsed': 18.5,              # detik total
    'estimated_remaining': 12.3,  # detik
    'items': [
        {'index': 1, 'filename': '...', 'status': 'done', 'time': 3.2},
        {'index': 2, 'filename': '...', 'status': 'done', 'time': 2.8},
        ...
        {'index': 7, 'filename': '...', 'status': 'processing', 'time': None},
        {'index': 8, 'filename': '...', 'status': 'waiting', 'time': None},
        ...
    ],
    'error': None
}
```

---

## Urutan Implementasi

### Phase 1 — Backend Core (v0.2.0)
1. `src/config.py` — load/save config.json
2. `src/history.py` — load/save history.json
3. `src/cloner.py` — FFmpeg cloning logic + threading
4. `src/api.py` — API class (semua method)
5. `src/main.py` — pywebview entry point
6. Testing manual via pywebview debug mode

### Phase 2 — Frontend (v0.3.0)
1. `src/web/index.html` — konversi dari ui_preview_v2.html
2. `src/web/app.js` — semua frontend logic
3. Pastikan drag & drop, file dialog, progress polling bekerja

### Phase 3 — Integrasi (v0.4.0)
1. Hubungkan semua API call JS ↔ Python
2. Testing end-to-end dengan video asli
3. Bug fixes & polish

### Phase 4 — Release (v1.0.0)
1. Final testing
2. Cleanup file preview/referensi
3. Update dokumentasi

---

## Dependencies

### requirements.txt

```
pywebview>=5.0
```

### External
- **FFmpeg** — portable, disediakan user di `ffmpeg/ffmpeg.exe`
- **Python 3.13** — sudah terinstall di sistem

### Frontend (CDN)
- Tailwind CSS — `https://cdn.tailwindcss.com`
- Google Fonts (Work Sans) — `https://fonts.googleapis.com`
- Material Symbols — `https://fonts.googleapis.com`

---

## Konvensi

| Item                  | Konvensi                                      |
| --------------------- | --------------------------------------------- |
| Nama file Python      | snake_case (`video_cloner.py`)                |
| Nama class            | PascalCase (`VideoCloner`)                    |
| Nama method/function  | snake_case (`start_cloning`)                  |
| Config/History format | JSON                                          |
| Path separator        | `os.path` atau `pathlib.Path` (cross-compat)  |
| FFmpeg execution      | `subprocess.run()` atau `subprocess.Popen()`  |
| Error handling        | Try/except di API layer, return error dict     |
| Threading             | `threading.Thread` untuk cloning              |

---

## Catatan Penting

1. **FFmpeg path** harus valid sebelum cloning bisa dimulai. UI harus disable tombol START jika FFmpeg belum terdeteksi.
2. **Frameless window** — title bar dikontrol via HTML. Window drag via pywebview `easy_drag` atau custom drag region.
3. **File dialog** — gunakan `window.create_file_dialog()` dari pywebview, bukan HTML input file.
4. **Notification sound** — gunakan `winsound.PlaySound()` (Windows) atau fallback.
5. **Auto-rename** — cek `os.path.exists()` sebelum write. Jika ada, tambah ` (2)`, ` (3)`, dst.
