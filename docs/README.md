# Clone Studio

**Clone Studio** adalah aplikasi desktop untuk mengkloning video singkat. Dari 1 video input, aplikasi menghasilkan N video output yang secara visual identik, namun secara binary/hash berbeda.

---

## Informasi Proyek

| Item             | Detail                        |
| ---------------- | ----------------------------- |
| Nama Aplikasi    | Clone Studio                  |
| Versi            | v0.6.3                        |
| Platform         | Desktop (Windows)             |
| Tech Stack       | Python 3.13, pywebview, FFmpeg (portable) |
| UI Theme         | Black (#000000) + Orange (#ff5c00) |
| Target Pengguna  | Personal use                  |

---

## Fitur

### Core
- [x] Upload video via drag & drop atau browse
- [x] Generate N clone dari 1 video sumber
- [x] Clone visual identik, binary/hash berbeda
- [x] Progress bar & task queue real-time
- [x] Notifikasi selesai (pop-up + suara)

### Konfigurasi
- [x] Jumlah clone (default: 10, range: 1–100)
- [x] Format output (default: MP4, opsi: MKV, AVI, MOV, WebM)
- [x] Template penamaan file (`{title}`, `{index}`, `{date}`, `{time}`, `{rand}`)
- [x] Folder output (default: sama dengan sumber video)
- [x] Clone method: Fast (metadata + filter) / Standard (light re-encode)
- [x] Auto-rename jika file sudah ada

### UI / UX
- [x] FFmpeg portable (user sediakan di folder app)
- [x] FFmpeg status indicator
- [x] History / riwayat clone sebelumnya
- [x] Guide & Settings dalam modal popup
- [x] Estimasi ukuran & waktu proses

---

## Format Input yang Didukung

| Format | Ekstensi |
| ------ | -------- |
| MP4    | .mp4     |
| MKV    | .mkv     |
| AVI    | .avi     |
| MOV    | .mov     |
| WebM   | .webm    |

---

## Template Penamaan

| Variabel  | Deskripsi                          | Contoh Output             |
| --------- | ---------------------------------- | ------------------------- |
| `{title}` | Nama file asli (tanpa ekstensi)    | my_video                  |
| `{index}` | Nomor urut clone (01, 02, ...)     | 01                        |
| `{date}`  | Tanggal proses (YYYY-MM-DD)        | 2026-03-10                |
| `{time}`  | Waktu proses (HHmmss)              | 143022                    |
| `{rand}`  | 6 karakter random                  | a3f8b1                    |

**Default template:** `{title}_clone{index}_{date}`
**Contoh hasil:** `my_video_clone01_2026-03-10.mp4`

---

## Clone Method

| Method   | Teknik                                  | Kecepatan        | Kualitas              |
| -------- | --------------------------------------- | ----------------- | --------------------- |
| Fast     | Metadata change + imperceptible filter  | ~3-5 detik/clone  | Identik               |
| Standard | Light re-encode dengan variasi bitrate  | ~10-20 detik/clone| Minimal penurunan     |

---

## Struktur Layout UI

```
┌─────────────────────────────────────────────────────────┐
│  [Logo] Clone Studio  v0.4.0     [History] [Guide] [─□✕]│  ← Top Bar
├──────────────┬──────────────────────────────────────────┤
│              │                                          │
│  TASK QUEUE  │  Upload Source Video                     │
│              │  (drag/drop atau browse)                 │
│  Progress    │                                          │
│  ██████░░ 60%│  ┌─ File Info ────────────────────┐     │
│              │  │ nama.mp4 | 24.8MB | 01:12      │     │
│  ✓ clone01   │  │ 1920×1080 | H.264 | 2.8Mbps   │     │
│  ✓ clone02   │  └────────────────────────────────┘     │
│  ✓ clone03   │                                          │
│  ● clone04   │  ┌─ File Config ──┬─ Clone Engine ─┐    │
│  ○ clone05   │  │ Naming Template│ Total: 10      │    │
│  ○ clone06   │  │ Output Format  │ Method: Fast   │    │
│  ...         │  │ Output Folder  │ Est: 248MB ~30s│    │
│              │  │                │ [START CLONING]│    │
│              │  └────────────────┴────────────────┘    │
│              │                                          │
│ FFmpeg: Ready│                                          │
└──────────────┴──────────────────────────────────────────┘
```

---

## Struktur Folder Proyek (Rencana)

```
VideoClone/
├── docs/
│   ├── README.md              ← Dokumentasi ini
│   └── CHANGELOG.md           ← Versioning & changelog
├── ffmpeg/
│   └── ffmpeg.exe             ← FFmpeg portable (user sediakan)
├── src/
│   ├── main.py                ← Entry point, pywebview window
│   ├── cloner.py              ← Logic cloning video via FFmpeg
│   ├── config.py              ← Settings & konfigurasi
│   ├── history.py             ← History/log management
│   └── web/
│       ├── index.html         ← UI utama
│       ├── style.css          ← Styling (jika dipisah)
│       └── app.js             ← Frontend logic & API bridge
├── output/                    ← Default output folder (opsional)
├── ui_preview.html            ← Preview UI v1
├── ui_preview_v2.html         ← Preview UI v2 (approved)
├── stitch_reference.html      ← Referensi desain dari Stitch
└── requirements.txt           ← Python dependencies
```

---

## Tech Stack Detail

| Komponen       | Teknologi       | Fungsi                              |
| -------------- | --------------- | ----------------------------------- |
| Backend        | Python 3.13     | Logic utama, orkestrasi FFmpeg      |
| Desktop Window | pywebview       | Menampilkan UI web di desktop       |
| Video Engine   | FFmpeg (portable)| Manipulasi & clone video           |
| UI Framework   | Tailwind CSS    | Styling UI                          |
| Font           | Work Sans       | Tipografi utama                     |
| Icons          | Material Symbols| Ikon UI                             |

---

## Konflik Penamaan

Jika file output sudah ada di folder tujuan:
- **Auto-rename**: Menambahkan suffix angka, contoh: `my_video_clone01_2026-03-10 (2).mp4`

---

## Notifikasi

| Tipe     | Deskripsi                                | Default |
| -------- | ---------------------------------------- | ------- |
| Pop-up   | Dialog notifikasi saat proses selesai    | ON      |
| Suara    | Alert sound saat proses selesai          | ON      |

---

## Status Pengerjaan

| Tahap                     | Status       |
| ------------------------- | ------------ |
| Diskusi & spesifikasi     | ✅ Selesai    |
| UI Preview v1             | ✅ Selesai    |
| UI Preview v2 (approved)  | ✅ Selesai    |
| Dokumentasi (README + CHANGELOG) | ✅ Selesai |
| Implementasi Backend      | ⬜ Belum      |
| Implementasi Frontend     | ⬜ Belum      |
| Integrasi & Testing       | ⬜ Belum      |
