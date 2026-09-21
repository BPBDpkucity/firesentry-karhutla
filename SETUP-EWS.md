# FireSentry Karhutla — Setup GitHub Actions + Telegram

Versi ini disiapkan untuk tahap deadline: **UI tidak diubah**, Supabase belum wajib, dan EWS berjalan dari GitHub Actions.

## Mesin risiko

FireSentry tidak lagi memakai ambang buatan untuk suhu/kelembapan/hotspot seperti 35°C, 45%, atau jumlah hotspot tertentu.

Input:
- **NASA FIRMS**: hotspot, confidence, dan persistensi antar-run.
- **BMKG**: suhu, kelembapan, kecepatan/arah angin sebagai konteks meteorologis.
- **BMKG FFMC**: kategori resmi bila data kategori terstruktur tersedia. FireSentry tidak menebak angka FFMC dari warna peta.

Status operasional:
- `NORMAL`: tidak ada hotspot dan tidak ada FFMC Tinggi/Sangat Tinggi yang tersedia.
- `WASPADA`: hotspot terdeteksi, atau FFMC Tinggi/Sangat Tinggi.
- `SIAGA`: hotspot berulang, atau hotspot + FFMC Tinggi/Sangat Tinggi.
- `PERINGATAN`: hotspot berulang + FFMC Sangat Tinggi.

Jika kategori FFMC belum tersedia sebagai data terstruktur, status berbasis FFMC tidak akan dipaksakan. Sistem tetap berjalan menggunakan hotspot dan persistensi. Suhu, kelembapan, dan angin ditampilkan sebagai konteks dan tidak diberi threshold numerik baru.

Label UI lama tetap dipertahankan agar tampilan tidak berubah:
- NORMAL → Rendah
- WASPADA → Sedang
- SIAGA/PERINGATAN → Tinggi

## GitHub Secrets wajib

Repository → **Settings → Secrets and variables → Actions → New repository secret**.

Tambahkan:

- `FIRMS_MAP_KEY` — API key NASA FIRMS.
- `TELEGRAM_BOT_TOKEN` — token dari @BotFather.
- `TELEGRAM_CHAT_ID` — chat ID tujuan Telegram.

GitHub menyediakan repository Actions secrets untuk menyimpan API key/token tanpa menaruhnya di source code.

Supabase dan IQAir **belum wajib** untuk tahap ini.

## Telegram

1. Buka Telegram → `@BotFather`.
2. Jalankan `/newbot`.
3. Salin token ke `TELEGRAM_BOT_TOKEN`.
4. Masukkan bot ke grup/channel tujuan.
5. Isi `TELEGRAM_CHAT_ID`.

## Menjalankan EWS

GitHub → **Actions** → `FireSentry EWS — Cek Risiko & Telegram` → **Run workflow**.

Workflow juga berjalan otomatis setiap 3 jam.

Workflow akan mengambil BMKG, mengambil NASA FIRMS, menentukan status EWS, menyimpan snapshot, dan mengirim Telegram jika status naik.

Contoh:
- `NORMAL → WASPADA` → Telegram
- `WASPADA → SIAGA` → Telegram
- `SIAGA → SIAGA` → tidak spam
- `SIAGA → PERINGATAN` → Telegram

Jika BMKG gagal, sistem tidak menebak status dari data lama dan akan memberi tanda kegagalan di log/Telegram sistem.

## Supabase nanti

Folder `supabase/schema.sql` tetap disertakan. Setelah Supabase bisa dibuka, database dapat diaktifkan tanpa mengubah UI.
