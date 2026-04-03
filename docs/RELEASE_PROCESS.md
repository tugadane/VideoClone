# Release Process — Clone Studio

Dokumen ini menetapkan aturan rilis agar setiap perubahan terdokumentasi dan versi selalu konsisten.

## Aturan Wajib

Setiap perubahan aplikasi wajib memenuhi dua poin ini:

1. Ada catatan perubahan dalam Markdown.
2. Ada bump versi aplikasi.

Perubahan dianggap belum selesai jika salah satu poin di atas belum dilakukan.

## Alur Singkat Setiap Perubahan

1. Tentukan jenis bump versi:
   - Patch (`X.Y.Z` -> `X.Y.Z+1`) untuk perbaikan kecil, dokumentasi teknis, sinkronisasi, dan minor update.
   - Minor (`X.Y.Z` -> `X.(Y+1).0`) untuk fitur baru yang kompatibel.
   - Major (`X.Y.Z` -> `(X+1).0.0`) untuk perubahan besar yang berpotensi breaking.
2. Buat file catatan perubahan per-update:
   - Format nama: `docs/changes/YYYY-MM-DD-vX.Y.Z.md`
3. Update `docs/CHANGELOG.md` pada versi yang sama.
4. Sinkronkan versi di file aplikasi:
   - `installer.iss` -> `MyAppVersion`
   - `src/main.py` -> judul window
   - `src/web/index.html` -> `<title>` dan badge versi
   - `docs/README.md` -> tabel Informasi Proyek
5. Verifikasi tidak ada mismatch versi.

## Template Catatan Perubahan Per-Update

Gunakan struktur ini di `docs/changes/YYYY-MM-DD-vX.Y.Z.md`:

```md
# Perubahan vX.Y.Z - YYYY-MM-DD

## Ringkasan
- Tuliskan tujuan utama perubahan.

## Perubahan
- Daftar perubahan file/kode yang dilakukan.

## Dampak
- Jelaskan dampak ke user atau developer.

## Sinkronisasi Versi
- installer.iss: X.Y.Z
- src/main.py: vX.Y.Z
- src/web/index.html: vX.Y.Z
- docs/README.md: vX.Y.Z
```

## Catatan

Jika ada perubahan kecil sekalipun, tetap buat catatan `docs/changes/` agar histori teknis lengkap dan mudah ditelusuri.
