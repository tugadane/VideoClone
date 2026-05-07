# Changelog — Clone Studio

Semua perubahan penting pada proyek ini akan didokumentasikan di file ini.

Format berdasarkan [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [v0.7.1] — 2026-05-06

### Fixed
- **Clone History tidak punya tombol kembali yang jelas.** Saat user buka History via tombol clock di top bar, satu-satunya cara kembali ke menu utama adalah klik ulang tombol clock itu — tidak intuitif. Tambah tombol **Back** di pojok kiri atas halaman Clone History untuk kembali ke main view langsung.

---

## [v0.7.0] — 2026-05-06

### Added
- **Image Overlay (multiple).** Panel baru sejajar Text Overlay & Video Overlay. Tiap card: file picker (PNG / JPG / JPEG / WebP / BMP / GIF), Position dropdown (9 posisi), Size %, Opacity. Mendukung PNG transparan (alpha dipertahankan via `format=yuva420p`). Bisa tambah lebih dari satu image overlay sekaligus dan dikombinasikan bebas dengan Text dan Video Overlay.
- **3 posisi baru di seluruh overlay (Text + Video + Image): Center Left, Center Center, Center Right.** Dropdown posisi sekarang punya 9 opsi penuh: top-left/center/right, center-left/center/right, bottom-left/center/right. Kompatibilitas mundur dijaga: nilai lama `center` tetap dipetakan ke center-center.
- API method baru `select_overlay_image()` di Python bridge untuk file picker gambar.

### Changed
- `cloner.py` filter chain di-refactor: video overlay dan image overlay sekarang melewati pipeline overlay yang sama (`all_overlays` list), sehingga urutan kompose dapat diprediksi dan kode lebih ringkas. Tidak ada perubahan perilaku untuk job lama yang hanya pakai video overlay.

---

## [v0.6.3] — 2026-05-06

### Performance
- **Watermark pre-pass jauh lebih cepat.** Encoder pre-pass diturunkan dari `libx264 -preset fast -crf 20` ke `libx264 -preset ultrafast -crf 23`. File hasil pre-pass lebih besar tapi cuma intermediate (di-re-encode lagi oleh clone step), jadi tidak berpengaruh ke kualitas akhir. Speedup ~3.9× per source pada uji 480×854 / 52 detik (26.4 dt → 6.7 dt).
- **Pre-pass dijalankan paralel.** Hingga 3 ffmpeg jobs paralel (skala dengan jumlah core CPU, dibatasi ~setengah core dengan max 3) sehingga batch 100 source jauh lebih cepat sebelum cloning dimulai.
- `cancel()` sekarang juga membunuh ffmpeg pre-pass yang sedang berjalan, bukan hanya proses clone aktif.

### Fixed
- Naming template `{title}` sekarang tetap memakai nama source asli kamu (mis. `shopee_xxxx`), bukan nama temp file `wmrem_xxxxxxxx` yang muncul setelah pre-pass watermark di v0.6.0–v0.6.2.

### Changed
- UI progress sekarang menampilkan tahap pre-pass: label "Preprocessing watermark... X/Y" + progress bar dan counter ikut maju selama pre-pass, jadi tidak terlihat seperti aplikasi hang di "Processing clone #0... 0%" saat batch besar (mis. 100 video Shopee).

---

## [v0.6.2] — 2026-05-05

### Fixed
- Batch download Shopee gagal dengan pesan "Downloaded file is not a valid video" pada video yang punya **emoji** di caption (mis. `😍`). Root cause: caption dipakai untuk nama file, dan ffprobe.exe tidak bisa membuka path dengan karakter di luar Windows system codepage. Fix: helper `_safe_filename()` baru yang strip non-ASCII; diterapkan ke Shopee, TikTok, plus opsi `restrictfilenames=True` untuk yt-dlp (Reels/YT Shorts/FB Reels).
- Error message untuk URL Shopee non-video (mis. `s.shopee.co.id/...` yang resolve ke halaman produk) sekarang spesifik: "Shopee URL bukan halaman video..." daripada pesan generic.

---

## [v0.6.1] — 2026-05-05

### Changed
- Placeholder Batch Links diperbarui untuk menyebutkan dukungan **YouTube Shorts** dan **Shopee** secara eksplisit, plus dua contoh URL tambahan. Batch Shopee sebenarnya sudah berfungsi sejak v0.6.0 — patch ini hanya UX clarity.

---

## [v0.6.0] — 2026-05-05

### Added
- **Hide Watermark Region** — panel baru untuk menutup/menghilangkan watermark statis pada video sumber sebelum cloning.
  - 4 metode: `delogo`, `delogo_blur` (rekomendasi), `blur` (sensor), `cover` (drawbox solid).
  - Region didefinisikan dalam persentase (X/Y/W/H) sehingga konsisten lintas resolusi.
  - Tombol preset cepat: Shopee (kiri-tengah), TikTok atas, TikTok bawah, IG atas, YT Shorts bawah.
  - Auto-hide Shopee saat source `source_platform == 'shopee'` (default ON).
  - Pre-pass FFmpeg dijalankan satu kali per source (bukan per clone) → efisien.
- Setiap method `download_from_*` di `src/api.py` mengembalikan `source_platform` sehingga frontend tahu platform asal file dan dapat menampilkan badge di source list.
- Badge platform asal di kartu source list (Shopee / TikTok / IG Reels / FB Reels / YT Shorts / GDrive).

### Changed
- `src/cloner.py` — refactor minor: `_run()` kini melakukan `_preprocess_watermark_all()` sebelum loop clone. `__init__` menyimpan `_source_platforms` dan `_preprocessed_files` untuk pengelolaan temp file.

---

## [v0.5.0] — 2026-05-05

### Added
- **Dukungan download video Shopee** — opsi platform baru `Shopee` di Single Link, Batch Links (auto-detect), Background Music link, dan Video Overlay link.
  - Mendukung short link `id.shp.ee/...` / `shp.ee/...` (dan regional lain) serta link share `sv.shopee.<region>/share-video/...`.
  - Resolusi otomatis melalui rantai redirect Shopee (universal-link → share-video).
  - Ekstraksi MP4 dari blok `__NEXT_DATA__` Next.js pada halaman share.
  - Reuse oleh modul BGM extractor — Shopee bisa dijadikan sumber audio.

### Changed
- `src/api.py` — registrasi `'shopee'` di `download_methods` `extract_bgm_from_link`.
- `src/web/index.html` — opsi `Shopee` di `#selectSource` dan `#selectBgmSource`.
- `src/web/app.js` — `SOURCE_CONFIG.shopee`, label di BGM dialog, deteksi URL Shopee di `detectSourceFromUrl()`, dan opsi di template Video Overlay.

---

## [v0.4.0] — 2026-04-08

### Added
- **Green Screen (Chroma Key)** pada Video Overlay — checkbox, color picker, slider similarity & blend, preview ikon khusus.
- Deteksi video Facebook privat/friends-only dengan pesan error deskriptif.

### Changed
- Pemisahan mode Single Source (File Info + slider "Clone Count") vs Multi Source (Source Videos list + slider "Default Clones per Source").
- Overlay Size slider diperluas dari max 50% → max 100%.
- Proporsi video overlay dihitung eksak via ffprobe (menjaga aspect ratio asli).
- HTML unescape diterapkan pada seluruh teks sebelum regex pencarian URL Facebook.
- Membersihkan elemen HTML duplikat di UI.

### Fixed
- Video overlay gepeng — dimensi sekarang dihitung di Python, bukan expression FFmpeg.
- Green screen tidak transparan — `format=yuva420p` diterapkan sebelum `chromakey`.

---

## [v0.3.1] — 2026-04-02

### Changed
- Menetapkan aturan wajib rilis: setiap perubahan harus punya catatan Markdown dan bump versi.
- Menyinkronkan versi aplikasi ke `v0.3.1` pada file berikut:
  - `installer.iss`
  - `src/main.py`
  - `src/web/index.html`
  - `docs/README.md`

### Added
- `docs/RELEASE_PROCESS.md` sebagai SOP versioning + changelog.
- `docs/changes/2026-04-02-v0.3.1.md` sebagai catatan perubahan per update.

---

## [v0.1.0] — 2026-03-10

### Phase: Diskusi & UI Preview

#### Added
- Diskusi spesifikasi proyek lengkap
  - Nama: Clone Studio
  - Stack: Python 3.13 + pywebview + FFmpeg (portable)
  - Theme: Black (#000000) + Orange (#ff5c00)
  - Fitur: clone video, naming template, output config, progress, history, notifikasi
- UI Preview v1 (`ui_preview.html`)
  - Layout sidebar kiri (icon-only) + konten kanan
  - Tab: Clone, History, Settings
  - Custom CSS styling
- Referensi desain dari Google Stitch (`stitch_reference.html`)
  - Mengadopsi gaya: Tailwind CSS, Work Sans font, Material Symbols, gradient glow
- UI Preview v2 (`ui_preview_v2.html`) — **APPROVED**
  - Sidebar menu dihapus
  - Task Queue dipindah ke panel kiri (permanen)
  - History sebagai icon toggle di top bar
  - Guide & Settings digabung dalam modal popup
  - Layout: Top Bar → [Task Queue | Main Content]
- Dokumentasi proyek
  - `docs/README.md` — spesifikasi lengkap
  - `docs/CHANGELOG.md` — file ini
  - `docs/DEVELOPMENT.md` — panduan teknis implementasi

#### Keputusan Desain
- Sidebar menu tidak diperlukan karena fitur tidak banyak
- Task Queue selalu visible di kiri agar user bisa monitor progress
- Settings & Guide digabung dalam 1 modal popup
- History cukup sebagai icon toggle di top bar
- Clone method: Fast (metadata + filter) dan Standard (light re-encode)
- Konflik nama file: auto-rename dengan suffix angka
- Notifikasi: pop-up + suara (keduanya default ON)

---

## [v0.2.0] — 2026-03-10

### Phase: Backend Implementation

#### Added
- `src/config.py` — Config class, load/save JSON, default values
- `src/history.py` — History class, add/get_all/clear, UUID entries
- `src/cloner.py` — VideoCloner class with threading
  - Fast method: video copy + audio re-encode with imperceptible noise
  - Standard method: full re-encode CRF 18 + noise filters
  - Progress tracking with per-clone timing and ETA
  - Auto-rename on filename collision
  - `get_video_info()` via ffprobe
  - `check_ffmpeg()` version detection
- `src/api.py` — API class exposed to pywebview JS
  - File dialogs (video, folder, FFmpeg path)
  - Cloning control (start, cancel, progress polling)
  - Config & History management
  - Window controls (minimize, maximize, close)
  - Notification sound via winsound
- `src/main.py` — pywebview entry point (1280x800, frameless)
- `requirements.txt` — pywebview>=5.0

---

## [v0.3.0] — 2026-03-10

### Phase: Frontend Implementation

#### Added
- `src/web/index.html` — Functional UI converted from ui_preview_v2.html
  - Custom title bar with drag region
  - Left panel: Task Queue with real-time progress
  - Right panel: Clone view + History view (tab toggle)
  - Guide & Settings modal with all config options
  - Completion modal with "Open Folder" action
  - Drag & drop zone for video files
- `src/web/app.js` — Frontend logic
  - pywebview API bridge (all method calls)
  - Progress polling every 500ms
  - Dynamic task queue rendering (done/processing/waiting)
  - Template preview with live variable substitution
  - Estimate calculator (size & time)
  - History list rendering
  - Settings load/save with toggle switches
  - FFmpeg status indicator

---

## Rencana Versi Berikutnya

### [v0.4.0] — TBD
- Integrasi frontend ↔ backend
- Testing end-to-end
- Bug fixes

### [v1.0.0] — TBD
- Release pertama yang fully functional
