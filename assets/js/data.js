/* =========================================================
   FIRESENTRY KARHUTLA - Data layer
   Berisi data contoh (fallback) yang disusun mengikuti struktur
   data resmi:
   - Cuaca   : BMKG "Data Prakiraan Cuaca Terbuka" (api.bmkg.go.id/publik/prakiraan-cuaca)
   - Hotspot : Pantau Titik Panas (Hotspot) Mandiri — BMKG Stasiun Meteorologi
               SSK II Pekanbaru (stamet-riau.bmkg.go.id) — sumber resmi & real-time
   - PM2.5/AQI : World Air Quality Index — WAQI/aqicn.org (api.waqi.info),
               jaringan monitoring gabungan yang menyediakan konsentrasi PM2.5 dan AQI.
               FireSentry memakai konsentrasi PM2.5 untuk menghitung US AQI
               dengan breakpoint EPA yang juga menjadi dasar kategori AQI+ US
               pada IQAir. Nilai stasiun dapat berbeda karena sumber/stasiun berbeda.
               bukan lagi angka contoh — lihat WAQI_CONFIG & fetchWaqiPekanbaru()
               di api.js.

   Saat sumber resmi tidak dapat diakses langsung dari browser
   (CORS / tanpa API terbuka), sistem otomatis memakai data contoh
   di bawah ini agar tampilan tetap berjalan.
   ========================================================= */

const EWS_CONFIG = {
  wilayah: "Kota Pekanbaru, Provinsi Riau",
  // Kode wilayah tingkat kelurahan (adm4) sesuai Permendagri No. 58 Tahun 2021.
  // Cari kode kelurahan yang ingin dipantau (mis. Tenayan Raya/Rumbai) di:
  // https://kodewilayah.id  atau  https://disdukcapil.pekanbaru.go.id
  // Contoh kode valid Kec. Pekanbaru Kota: 14.71.02.1004 (ganti sesuai kebutuhan)
  bmkgAdm4: "14.71.02.1004", // TODO: ganti dengan kode adm4 kelurahan yang dipantau
  // Dokumentasi resmi: https://data.bmkg.go.id/prakiraan-cuaca/
  // Contoh panggilan API resmi: https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=31.71.03.1001
  bmkgEndpoint: "https://api.bmkg.go.id/publik/prakiraan-cuaca",
  // Pantau Titik Panas (Hotspot) Mandiri — BMKG Stamet SSK II Pekanbaru (real-time, resmi).
  // Situs ini berbasis PHP/JS dinamis tanpa endpoint JSON terbuka, sehingga tidak bisa
  // ditarik otomatis (fetch) dari browser. FireSentry Karhutla menampilkannya sebagai sumber
  // rujukan resmi (tautan langsung + info panduan) pada halaman Data Hotspot.
  bmkgHotspotUrl: "https://stamet-riau.bmkg.go.id/index.php?menu=cuaca&submenu=hotspot",
  firmsInfoUrl: "https://firms.modaps.eosdis.nasa.gov/api/",
  sipongiUrl: "https://sipongi.gakkum.kehutanan.go.id/sebaran-titik-panas",
  koordinatPekanbaru: { lat: 0.5071, lng: 101.4478 }
};

/* =========================================================
   Kualitas udara (PM2.5 / AQI) — World Air Quality Index (WAQI)
   ---------------------------------------------------------
   Sumber: api.waqi.info (proyek World Air Quality Index / aqicn.org).
   WAQI bukan sumber data IQAir. Untuk menjaga transparansi, FireSentry
   membedakan sumbernya: PM2.5 berasal dari WAQI, sedangkan kategori/AQI
   dihitung menggunakan breakpoint US EPA. Jika `IQAIR_API_KEY` tersedia
   di GitHub Actions, AQI utama dapat berasal langsung dari IQAir AirVisual API
   tanpa mengekspos API key ke browser. Nilai antar sumber dapat berbeda karena
   jumlah dan lokasi stasiun yang diagregasikan berbeda.

   CARA MENGAKTIFKAN DATA REAL-TIME:
   1. Daftar token GRATIS (cukup email, langsung aktif) di:
      https://aqicn.org/data-platform/token/
   2. Tempel token itu ke WAQI_CONFIG.token di bawah ini.
   3. Tanpa token diisi, sistem otomatis memakai DASHBOARD_SUMMARY.pm25
      (data contoh) di bawah, sama seperti fallback BMKG/FIRMS.

   PENTING SEBELUM PUSH KE GITHUB PUBLIK: kosongkan lagi WAQI_CONFIG.token
   (jadi token: "") supaya token tidak ikut ter-commit — sama seperti
   catatan FIRMS_MAP_KEY di api.js. Kalau sampai kepush publik dengan
   token terisi, anggap token itu bocor dan generate token BARU di
   halaman registrasi di atas. */
const WAQI_CONFIG = {
  token: "", // token pribadi dari aqicn.org/data-platform/token/ — KOSONGKAN sebelum push ke GitHub publik
  // "pekanbaru" mengarah ke stasiun kota Pekanbaru di jaringan WAQI
  // (aqicn.org/city/indonesia/pekanbaru/) — stasiun yang sama yang jadi
  // basis perbandingan IQAir untuk kota ini.
  kota: "pekanbaru"
};

/* Kategori AQI (skala EPA / AQI+ US 0–500) — dipakai supaya label &
   warna kartu PM2.5 di Dashboard konsisten dengan kategori yang dipakai
   IQAir ("Baik", "Sedang", "Tidak Sehat", dst.), bukan cuma warna tetap. */
const EWS_KATEGORI_AQI = [
  { maks: 50,  label: "Baik",                                   kelas: "up",   panah: "▼" },
  { maks: 100, label: "Sedang",                                  kelas: "warn", panah: "▲" },
  { maks: 150, label: "Tidak sehat bagi kelompok sensitif",       kelas: "warn", panah: "▲" },
  { maks: 200, label: "Tidak sehat",                              kelas: "down", panah: "▲" },
  { maks: 300, label: "Sangat tidak sehat",                       kelas: "down", panah: "▲" },
  { maks: Infinity, label: "Berbahaya",                           kelas: "down", panah: "▲" }
];

function ewsKategoriAqi(aqi){
  if(typeof aqi !== "number" || isNaN(aqi)){
    return { label: "Data tidak tersedia", kelas: "info", panah: "" };
  }
  return EWS_KATEGORI_AQI.find(k => aqi <= k.maks) || EWS_KATEGORI_AQI[EWS_KATEGORI_AQI.length - 1];
}

/* EPA US AQI untuk PM2.5 — konsentrasi 24-jam, breakpoint resmi EPA.
   Konsentrasi dipotong 1 desimal sebelum interpolasi, lalu indeks dibulatkan
   ke bilangan bulat terdekat. Ini membuat contoh 43.3 µg/m³ menghasilkan
   sekitar AQI 120, sama dengan hubungan yang terlihat pada kartu IQAir. */
function ewsAqiDariPm25(pm25){
  const c = Number(pm25);
  if(!Number.isFinite(c) || c < 0) return null;
  const x = Math.floor(c * 10) / 10;
  const bp = [
    [0.0, 9.0, 0, 50],
    [9.1, 35.4, 51, 100],
    [35.5, 55.4, 101, 150],
    [55.5, 125.4, 151, 200],
    [125.5, 225.4, 201, 300],
    [225.5, 325.4, 301, 500]
  ];
  const r = bp.find(([lo, hi]) => x >= lo && x <= hi);
  if(!r) return x > 325.4 ? 500 : null;
  const [blo,bhi,ilo,ihi] = r;
  return Math.round(((ihi-ilo)/(bhi-blo))*(x-blo)+ilo);
}

/* =========================================================
   Kode wilayah kelurahan (adm4) REPRESENTATIF per kecamatan,
   dipakai untuk menarik data cuaca BMKG per kecamatan secara
   real-time (lihat ewsSinkronMonitoringRealtime() di api.js).

   BMKG hanya menyediakan data sampai level KELURAHAN (adm4) —
   tidak ada endpoint "per kecamatan". Jadi tiap kecamatan diwakili
   oleh satu kelurahan di dalamnya sebagai titik pantau.

   STATUS SAAT INI: baru 1 kode yang terverifikasi manual (Pekanbaru
   Kota). Kecamatan lain masih memakai kode kota (EWS_CONFIG.bmkgAdm4)
   sebagai representasi sementara — supaya sistem tetap menampilkan
   data BMKG yang ASLI (bukan data contoh), hanya belum presisi per
   kecamatan. Lengkapi baris di bawah dengan kode kelurahan dari
   kecamatan terkait untuk akurasi penuh. Cara mencari kodenya:
   1. Buka https://kodewilayah.id lalu cari nama kelurahan yang ada
      di kecamatan tersebut (lihat daftar kelurahan per kecamatan di
      https://id.wikipedia.org/wiki/Daftar_kecamatan_dan_kelurahan_di_Kota_Pekanbaru)
   2. Salin kode berformat "14.71.xx.xxxx" ke bawah ini.
   ========================================================= */
// Kode adm4 (kelurahan representatif) untuk SELURUH 15 kecamatan resmi
// Kota Pekanbaru per Perda Kota Pekanbaru No. 2 Tahun 2020 & Kepmendagri
// 050-145 Tahun 2022. Nama kecamatan di bawah sudah disamakan dengan nama
// resmi TERKINI (bukan lagi nama pra-pemekaran seperti "Rumbai Pesisir",
// "Tampan", atau "Marpoyan") dan dicocokkan dengan field `kecamatan` yang
// dipakai di WILAYAH_RISIKO, batas-kecamatan.js, dan TABEL_RISIKO_KECAMATAN
// supaya semua modul merujuk ke wilayah yang sama. Kode divalidasi silang
// pada 2 sumber independen: (1) kodewilayah.id — basis data resmi Kemendagri
// tingkat kelurahan, (2) daftar kelurahan per-kecamatan hasil Perda (portal
// berita resmi Pemko Pekanbaru).
const KECAMATAN_ADM4 = {
  "Pekanbaru Kota": "14.71.02.1004",   // Kel. Kota Baru
  "Tenayan Raya": "14.71.10.1004",     // Kel. Rejosari
  "Rumbai": "14.71.12.1009",           // Kel. Sri Meranti (dahulu bernama kec. "Rumbai Pesisir")
  "Rumbai Barat": "14.71.06.1003",     // Kel. Rumbai Bukit (dahulu bernama kec. "Rumbai")
  "Rumbai Timur": "14.71.15.1005",     // Kel. Limbungan (kecamatan baru hasil pemekaran)
  "Kulim": "14.71.14.1001",            // Kel. Kulim (kecamatan baru, dimekarkan dari Tenayan Raya)
  "Bukit Raya": "14.71.07.1005",       // Kel. Simpang Tiga
  "Marpoyan Damai": "14.71.09.1003",   // Kel. Sidomulyo Timur
  "Payung Sekaki": "14.71.11.1002",    // Kel. Labuh Baru Timur
  "Tuah Madani": "14.71.13.1004",      // Kel. Tuah Madani
  "Binawidya": "14.71.08.1010",        // Kel. Binawidya
  "Sukajadi": "14.71.01.1007",         // Kel. Sukajadi
  "Sail": "14.71.03.1001",             // Kel. Cinta Raja
  "Lima Puluh": "14.71.04.1001",       // Kel. Rintis
  "Senapelan": "14.71.05.1005",        // Kel. Kampung Bandar
};

function ewsAdm4UntukKecamatan(kecamatan){
  return KECAMATAN_ADM4[kecamatan] || EWS_CONFIG.bmkgAdm4;
}

/* --- Ringkasan kondisi terkini (dipakai di Dashboard) ---
   Catatan: statusRisiko & jam update TIDAK lagi disimpan di sini sebagai
   nilai tetap — keduanya sekarang dihitung otomatis saat Dashboard dibuka
   (lihat ewsHitungStatusMayoritas() di bawah, dan ewsWaktuSyncTerakhir() di
   api.js) supaya selalu sesuai kondisi wilayah & waktu yang sebenarnya.

   REVISI: sebelumnya suhu/kelembapan/hotspot di 4 kartu ringkasan Dashboard
   memakai ANGKA TETAP di objek ini (tidak pernah berubah walau data
   Monitoring sudah disinkron ke BMKG/FIRMS) — itu sebabnya kartu "Hotspot
   Terdeteksi" bisa menunjukkan 18 titik / 6 titik hari ini padahal Status
   Risiko Wilayah di sebelahnya sudah menghitung mayoritas wilayah "Rendah"
   dari data ASLI. Sekarang suhu/kelembapan/hotspot dihitung otomatis oleh
   ewsHitungRingkasanDashboard() (lihat di bawah) dari SUMBER YANG SAMA
   dengan Status Risiko Wilayah (ewsGetWilayahRisikoGabungan()), supaya
   keduanya selalu konsisten. Objek di bawah ini sekarang HANYA dipakai
   sebagai FALLBACK CONTOH untuk kartu PM2.5/AQI — dipakai HANYA kalau
   WAQI_CONFIG.token (lihat di atas) belum diisi atau permintaan ke WAQI
   gagal (offline, dsb). Kalau token sudah diisi, Dashboard menampilkan
   angka AQI real-time dari WAQI (lihat ewsGetKualitasUdaraTerkini() &
   ewsSinkronKualitasUdara() di api.js) — BUKAN angka contoh di bawah ini. */
const DASHBOARD_SUMMARY = {
  pm25: 45, pm25Status: "Sedang" // contoh netral, dipakai hanya saat WAQI tidak dapat diakses
};

/* Menghitung ringkasan suhu/kelembapan/hotspot untuk 4 kartu teratas
   Dashboard, LANGSUNG dari data Monitoring gabungan (dasar + hasil sinkron
   BMKG/FIRMS + update petugas) — sumber yang sama dipakai Status Risiko
   Wilayah — supaya kartu ringkasan tidak pernah kontradiksi dengan status
   risiko yang ditampilkan di sebelahnya:
   - suhu & kelembapan: RATA-RATA dari seluruh wilayah yang dipantau
   - hotspot: TOTAL titik panas seluruh wilayah (angka yang sama yang
     dipakai ewsHitungRisiko() per kecamatan untuk menentukan status
     Tinggi/Sedang/Rendah) — jadi kalau status risiko Rendah, totalnya
     otomatis ikut rendah/0, tidak lagi terasa kontradiktif
   - hotspotHariIni: jumlah titik dari arsip FIRMS (ewsGetArsipHotspot())
     dengan tanggal deteksi = hari ini, BUKAN angka tetap seperti
     sebelumnya. Kalau FIRMS belum pernah berhasil disinkron sama sekali,
     dikembalikan null supaya tampilan bisa menandainya "belum ada data
     sinkronisasi" alih-alih 0 yang seolah-olah sudah dicek dan aman. */
function ewsHitungRingkasanDashboard(){
  const wilayah = ewsGetWilayahRisikoGabungan();
  const n = wilayah.length || 1;
  const totalSuhu = wilayah.reduce((s, w) => s + (w.suhu || 0), 0);
  const totalKelembapan = wilayah.reduce((s, w) => s + (w.kelembapan || 0), 0);
  const totalHotspot = wilayah.reduce((s, w) => s + (w.hotspot || 0), 0);

  const arsip = ewsGetArsipHotspot(); // null = FIRMS belum pernah sync sama sekali
  const hariIni = new Date().toISOString().slice(0, 10); // format sama dengan acq_date FIRMS
  const hotspotHariIni = arsip === null ? null : arsip.filter(r => r.tanggal === hariIni).length;

  return {
    suhu: Math.round((totalSuhu / n) * 10) / 10,
    kelembapan: Math.round(totalKelembapan / n),
    hotspot: totalHotspot,
    hotspotHariIni,
    jumlahWilayah: wilayah.length
  };
}

/* =========================================================
   Tren cuaca & indeks potensi karhutla (grafik Dashboard)
   ---------------------------------------------------------
   Sumber data ASLI: prakiraan BMKG per-3-jam (lihat
   ewsAmbilTrenCuacaBmkg() di api.js), ditarik saat halaman
   Dashboard dibuka. Karena BMKG hanya menyediakan PRAKIRAAN ke
   depan (bukan histori observasi jam-jaman), grafik ini bersifat
   "prakiraan beberapa jam/hari ke depan" — bukan "24 jam yang
   sudah lewat" seperti versi contoh sebelumnya.

   NASA FIRMS (titik panas) adalah data SATELIT untuk kejadian yang
   SUDAH terjadi, sehingga tidak bisa diprakirakan ke depan seperti
   cuaca. Karena itu garis ketiga BUKAN "jumlah titik panas hasil
   ramalan" (itu akan jadi angka fiktif), melainkan INDEKS POTENSI
   KARHUTLA (0-100) yang dihitung dari kombinasi suhu & kelembapan
   tiap titik prakiraan, memakai komponen yang sama dengan
   ewsHitungRisiko() di atas supaya konsisten dengan logika risiko
   yang sudah dipakai di Monitoring/Peringatan.

   Fungsi di bawah HANYA dipakai sebagai DATA CONTOH/FALLBACK —
   dipakai dashboard.html hanya jika ewsAmbilTrenCuacaBmkg() gagal
   (BMKG tidak dapat dihubungi / adm4 belum valid). Labelnya sengaja
   dibuat relatif terhadap jam sekarang (bukan hardcode) supaya
   tampilan contoh pun tidak terlihat "macet" di satu jam tertentu.
   ========================================================= */

// Skor 0-4 dari komponen suhu+kelembapan pada ewsHitungRisiko(), diskalakan
// ke 0-100 supaya sebanding secara visual dengan sumbu grafik.
function ewsIndeksPotensiDariCuaca(suhu, kelembapan){
  let skor = 0;
  if (suhu >= 35) skor += 2; else if (suhu >= 33) skor += 1;
  if (kelembapan <= 45) skor += 2; else if (kelembapan <= 55) skor += 1;
  return Math.round((skor / 4) * 100);
}

// Menghasilkan dataset CONTOH dengan label jam relatif terhadap waktu saat
// ini (kelipatan 3 jam ke depan), dipakai HANYA saat BMKG gagal dihubungi.
function ewsBuatTrenContohFallback(jumlahTitik){
  const n = jumlahTitik || 8;
  const suhuContoh = [26,25,27,30,33,35,34,31,28,26,25,24,25,27,30,33,35,34,31,28,26,25,24,25];
  const kelembapanContoh = [78,80,74,62,50,44,47,58,70,76,80,82,80,74,62,50,44,47,58,70,76,80,82,80];
  const label = [], suhu = [], kelembapan = [], indeksPotensi = [];
  const sekarang = new Date();
  for(let i=0;i<n;i++){
    const t = new Date(sekarang.getTime() + i*3*60*60*1000);
    label.push(t.toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"}));
    const s = suhuContoh[i % suhuContoh.length];
    const k = kelembapanContoh[i % kelembapanContoh.length];
    suhu.push(s); kelembapan.push(k);
    indeksPotensi.push(ewsIndeksPotensiDariCuaca(s,k));
  }
  return { sumber:"contoh", label, suhu, kelembapan, indeksPotensi, waktuAmbil: sekarang.toISOString() };
}

/* --- Daftar wilayah kecamatan & status risiko (untuk Monitoring & Peta) --- */
const WILAYAH_RISIKO = [
  { nama: "Rejosari", kecamatan: "Tenayan Raya", risiko: "Tinggi", hotspot: 6, suhu: 36.1, kelembapan: 40, lat: 0.5486, lng: 101.5192,
    // "Rejosari" adalah kelurahan resmi di Kecamatan Tenayan Raya (bukan nama kecamatan itu sendiri).
    jenisLahan: "Lahan Gambut", tujuanMonitoring: "Memantau perkembangan titik panas di area gambut yang berdekatan dengan kebun warga.",
    catatanLokal: "Kondisi tanah gambut kering akibat kemarau panjang; akses menuju sebagian titik cukup sulit dilalui kendaraan roda empat.",
    ancamanDampak: "Api berpotensi menjalar cepat di lahan gambut kering dan menimbulkan kabut asap ke permukiman terdekat.",
    jumlahTerdampakKK: 12, tindakanPencegahan: "Patroli udara & darat rutin, pembasahan lahan gambut, dan sosialisasi larangan membakar kepada warga.",
    tindakanPenanganan: "Kesiagaan regu pemadam Sektor 3 dengan pompa portable dan mobil tangki air siaga di lokasi.",
    hasilPeninjauan: "Titik panas masih aktif, tim tetap berjaga dan memantau perkembangan setiap 3 jam." },
  { nama: "Sri Meranti", kecamatan: "Rumbai", risiko: "Tinggi", hotspot: 5, suhu: 35.8, kelembapan: 42, lat: 0.5637, lng: 101.4111,
    // Kecamatan "Rumbai Pesisir" sudah tidak ada sejak Perda Kota Pekanbaru No. 2 Th. 2020 — nama
    // resminya sekarang "Rumbai", dan "Sri Meranti" adalah salah satu kelurahan resminya.
    jenisLahan: "Lahan Gambut", tujuanMonitoring: "Verifikasi lapangan atas titik panas hasil deteksi satelit di area gambut pesisir.",
    catatanLokal: "Lokasi berdekatan dengan permukiman nelayan; sumber air terbatas sehingga suplai dibantu dari sungai terdekat.",
    ancamanDampak: "Risiko penjalaran api ke arah permukiman nelayan serta gangguan aktivitas warga akibat kabut asap.",
    jumlahTerdampakKK: 9, tindakanPencegahan: "Pemasangan papan larangan membakar lahan dan patroli gabungan bersama warga setempat.",
    tindakanPenanganan: "Pemadaman manual dibantu suplai air dari sungai terdekat, disiagakan regu Sektor 1.",
    hasilPeninjauan: "Sebagian titik berhasil dilokalisasi, pemantauan lanjutan masih diperlukan pada sore hari." },
  { nama: "Rumbai Bukit", kecamatan: "Rumbai Barat", risiko: "Tinggi", hotspot: 4, suhu: 35.4, kelembapan: 43, lat: 0.5350, lng: 101.4390,
    // Kecamatan "Rumbai" (versi lama) resmi berganti nama menjadi "Rumbai Barat" sejak Perda No. 2
    // Th. 2020; "Rumbai Bukit" adalah salah satu kelurahan resminya.
    jenisLahan: "Perkebunan Sawit", tujuanMonitoring: "Memantau titik panas di area perkebunan sawit warga akibat cuaca kering dan angin kencang.",
    catatanLokal: "Angin kencang di siang hari menyulitkan pemadaman karena bara api mudah terbawa ke kebun sebelah.",
    ancamanDampak: "Berpotensi merusak tanaman sawit produktif milik warga di sekitar titik panas.",
    jumlahTerdampakKK: 6, tindakanPencegahan: "Pemantauan cuaca berkala dan kesiapsiagaan regu saat kondisi angin kencang.",
    tindakanPenanganan: "Pemadaman manual dengan dukungan mobil tangki air BPBD.",
    hasilPeninjauan: "Perkembangan api masih dipantau, belum ada perluasan area terdampak." },
  { nama: "Simpang Baru", kecamatan: "Binawidya", risiko: "Tinggi", hotspot: 3, suhu: 34.9, kelembapan: 45, lat: 0.4802, lng: 101.3986,
    // "Simpang Baru" adalah kelurahan resmi Kecamatan Binawidya (dahulu titik ini memakai nama
    // pra-pemekaran "Tampan", yang sekarang hanya nama kelurahan di Kecamatan Payung Sekaki).
    jenisLahan: "Semak Belukar", tujuanMonitoring: "Menindaklanjuti laporan warga terkait titik panas di lahan semak belukar kosong.",
    catatanLokal: "Lahan merupakan tanah kosong tak bertuan yang sering ditumbuhi semak kering saat kemarau.",
    ancamanDampak: "Kabut asap tipis mulai tercium di beberapa RW terdekat, berpotensi meluas bila tidak segera ditangani.",
    jumlahTerdampakKK: 4, tindakanPencegahan: "Pembersihan semak kering secara berkala dan patroli rutin Sektor 2.",
    tindakanPenanganan: "Pemadaman manual oleh regu setempat menggunakan peralatan ringan.",
    hasilPeninjauan: "Api berhasil dipadamkan sebagian, tim masih memantau kemungkinan titik bara baru." },
  { nama: "Tangkerang Selatan", kecamatan: "Bukit Raya", risiko: "Sedang", hotspot: 2, suhu: 34.2, kelembapan: 49, lat: 0.5083, lng: 101.4767,
    jenisLahan: "Lahan Kosong & Semak", tujuanMonitoring: "Memantau perkembangan cuaca dan potensi titik panas baru di lahan kosong pinggir jalan.",
    catatanLokal: "Beberapa warga masih terpantau membakar sampah di lahan kosong, berisiko memicu titik panas baru.",
    ancamanDampak: "Risiko masih tergolong sedang, namun berpotensi meningkat bila cuaca kering berlanjut.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Sosialisasi larangan membakar sampah/lahan dan pemantauan berkala petugas.",
    tindakanPenanganan: "Belum ada tindakan pemadaman aktif, status masih pemantauan.",
    hasilPeninjauan: "Kondisi terkendali, tidak ditemukan titik api aktif saat peninjauan terakhir." },
  { nama: "Wonorejo", kecamatan: "Marpoyan Damai", risiko: "Sedang", hotspot: 2, suhu: 33.8, kelembapan: 50, lat: 0.5069, lng: 101.4364,
    jenisLahan: "Lahan Kosong & Permukiman", tujuanMonitoring: "Memantau kondisi kelembapan udara dan potensi titik panas di sela permukiman padat.",
    catatanLokal: "Kepadatan permukiman cukup tinggi sehingga potensi dampak asap lebih terasa meski luas area kecil.",
    ancamanDampak: "Gangguan kualitas udara ringan pada permukiman padat penduduk di sekitar lahan kosong.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Edukasi warga RT/RW dan pemasangan imbauan larangan membakar sampah.",
    tindakanPenanganan: "Belum diperlukan tindakan pemadaman, status pemantauan rutin.",
    hasilPeninjauan: "Tidak ditemukan indikasi titik panas baru pada peninjauan terakhir." },
  { nama: "Tampan", kecamatan: "Payung Sekaki", risiko: "Sedang", hotspot: 1, suhu: 33.5, kelembapan: 51, lat: 0.5147, lng: 101.4058,
    // "Tampan" saat ini adalah nama kelurahan resmi di Kecamatan Payung Sekaki, bukan nama kecamatan.
    jenisLahan: "Perkebunan Campuran", tujuanMonitoring: "Verifikasi satu titik panas hasil deteksi satelit di area kebun campuran warga.",
    catatanLokal: "Titik panas berada di area kebun campuran yang jarang dikunjungi, sehingga verifikasi memakan waktu lebih lama.",
    ancamanDampak: "Dampak masih terbatas pada tanaman kebun milik warga di sekitar titik panas.",
    jumlahTerdampakKK: 2, tindakanPencegahan: "Koordinasi dengan pemilik kebun untuk pembersihan gulma kering.",
    tindakanPenanganan: "Pemantauan lanjutan, pemadaman belum diperlukan.",
    hasilPeninjauan: "Titik panas terverifikasi kecil dan tidak berkembang." },
  { nama: "Airputih", kecamatan: "Tuah Madani", risiko: "Sedang", hotspot: 1, suhu: 33.3, kelembapan: 52, lat: 0.5215, lng: 101.3980,
    jenisLahan: "Lahan Kosong Kampus & Permukiman", tujuanMonitoring: "Memantau lahan kosong di sekitar kawasan kampus dan permukiman baru.",
    catatanLokal: "Kawasan pemekaran baru dengan banyak lahan kosong yang belum termanfaatkan, rawan dibakar untuk pembersihan.",
    ancamanDampak: "Potensi gangguan aktivitas kampus dan permukiman bila asap meluas.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Koordinasi dengan pengelola kawasan untuk pengawasan lahan kosong.",
    tindakanPenanganan: "Belum ada tindakan aktif, status pemantauan.",
    hasilPeninjauan: "Kondisi aman, tidak ada titik api aktif saat peninjauan." },
  { nama: "Delima", kecamatan: "Binawidya", risiko: "Sedang", hotspot: 1, suhu: 33.0, kelembapan: 53, lat: 0.4890, lng: 101.3700,
    jenisLahan: "Lahan Kosong & Hutan Kota", tujuanMonitoring: "Memantau kondisi vegetasi hutan kota dan lahan kosong di pinggiran kawasan.",
    catatanLokal: "Sebagian area berbatasan dengan hutan kota yang menjadi ruang terbuka hijau kelurahan.",
    ancamanDampak: "Risiko rendah-sedang terhadap ruang terbuka hijau bila titik panas tidak segera diverifikasi.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Patroli rutin petugas kelurahan dan pemantauan citra satelit harian.",
    tindakanPenanganan: "Belum diperlukan tindakan pemadaman.",
    hasilPeninjauan: "Kondisi vegetasi masih terjaga, tidak ada titik api aktif." },
  { nama: "Perhentian Marpoyan", kecamatan: "Marpoyan Damai", risiko: "Sedang", hotspot: 0, suhu: 32.6, kelembapan: 55, lat: 0.5000, lng: 101.4500,
    // "Perhentian Marpoyan" adalah kelurahan resmi Kecamatan Marpoyan Damai — "Marpoyan" saja
    // tidak pernah menjadi nama kecamatan maupun kelurahan tersendiri.
    jenisLahan: "Permukiman & Lahan Kosong", tujuanMonitoring: "Pemantauan rutin kondisi cuaca dan potensi titik panas di kelurahan padat penduduk.",
    catatanLokal: "Tidak ada laporan titik panas terbaru dari warga maupun satelit dalam sepekan terakhir.",
    ancamanDampak: "Tidak ada ancaman aktif saat ini, risiko bersifat antisipatif mengikuti tren cuaca kering.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Sosialisasi kesiapsiagaan karhutla kepada RT/RW setempat.",
    tindakanPenanganan: "Tidak diperlukan, tidak ada kejadian aktif.",
    hasilPeninjauan: "Wilayah terpantau aman pada peninjauan terakhir." },
  { nama: "Sukajadi", kecamatan: "Sukajadi", risiko: "Rendah", hotspot: 0, suhu: 32.1, kelembapan: 58, lat: 0.5261, lng: 101.4342,
    jenisLahan: "Permukiman & Perkotaan", tujuanMonitoring: "Pemantauan rutin sebagai kawasan perkotaan padat, minim lahan vegetasi rawan terbakar.",
    catatanLokal: "Wilayah didominasi bangunan dan jalan beraspal, minim lahan terbuka bervegetasi.",
    ancamanDampak: "Ancaman karhutla sangat rendah karena minimnya tutupan lahan rawan terbakar.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Pemantauan berkala tanpa tindakan khusus.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Tidak ada indikasi risiko karhutla pada peninjauan terakhir." },
  { nama: "Kota Tinggi", kecamatan: "Pekanbaru Kota", risiko: "Rendah", hotspot: 0, suhu: 31.8, kelembapan: 60, lat: 0.5333, lng: 101.4500,
    jenisLahan: "Permukiman & Perkantoran", tujuanMonitoring: "Pemantauan rutin kawasan pusat kota yang minim lahan vegetasi.",
    catatanLokal: "Kawasan pusat pemerintahan dan perkantoran, hampir tidak memiliki lahan terbuka bervegetasi.",
    ancamanDampak: "Ancaman karhutla praktis tidak ada di wilayah ini.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Tidak ada tindakan khusus, cukup pemantauan rutin.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Kondisi selalu aman pada setiap peninjauan." },
  { nama: "Cinta Raja", kecamatan: "Sail", risiko: "Rendah", hotspot: 0, suhu: 31.9, kelembapan: 59, lat: 0.5280, lng: 101.4600,
    jenisLahan: "Permukiman & Perkotaan", tujuanMonitoring: "Pemantauan rutin sebagai bagian dari kawasan inti kota.",
    catatanLokal: "Tidak ditemukan lahan gambut maupun vegetasi rawan terbakar di wilayah ini.",
    ancamanDampak: "Ancaman karhutla sangat rendah.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Pemantauan berkala tanpa tindakan khusus.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Wilayah terpantau aman." },
  { nama: "Rintis", kecamatan: "Lima Puluh", risiko: "Rendah", hotspot: 0, suhu: 32.0, kelembapan: 58, lat: 0.5410, lng: 101.4530,
    jenisLahan: "Permukiman & Tepi Sungai", tujuanMonitoring: "Pemantauan rutin kawasan tepi sungai yang padat permukiman.",
    catatanLokal: "Wilayah tepi sungai dengan kepadatan bangunan tinggi, minim lahan kosong bervegetasi.",
    ancamanDampak: "Ancaman karhutla rendah, namun tetap perlu diwaspadai pembakaran sampah rumah tangga.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Imbauan larangan membakar sampah di bantaran sungai.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Tidak ada indikasi risiko pada peninjauan terakhir." },
  { nama: "Kampung Bandar", kecamatan: "Senapelan", risiko: "Rendah", hotspot: 0, suhu: 31.7, kelembapan: 60, lat: 0.5305, lng: 101.4380,
    jenisLahan: "Permukiman & Kawasan Bersejarah", tujuanMonitoring: "Pemantauan rutin kawasan permukiman padat dan cagar budaya kota lama.",
    catatanLokal: "Kawasan padat penduduk dengan bangunan bersejarah, tidak memiliki lahan vegetasi luas.",
    ancamanDampak: "Ancaman karhutla praktis tidak ada di wilayah ini.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Tidak ada tindakan khusus, cukup pemantauan rutin.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Kondisi selalu aman pada setiap peninjauan." },
  { nama: "Sukamaju", kecamatan: "Sail", risiko: "Rendah", hotspot: 0, suhu: 31.6, kelembapan: 61, lat: 0.5250, lng: 101.4470,
    // "Sail Kecil" bukan nama kelurahan resmi; kelurahan resmi di Kecamatan Sail adalah
    // Cinta Raja, Sukamaju, dan Sukamulya.
    jenisLahan: "Permukiman & Perkotaan", tujuanMonitoring: "Pemantauan rutin sebagai kelurahan padat di kawasan inti kota.",
    catatanLokal: "Tidak ditemukan lahan terbuka signifikan yang berpotensi menjadi sumber karhutla.",
    ancamanDampak: "Ancaman karhutla sangat rendah.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Pemantauan berkala tanpa tindakan khusus.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Wilayah terpantau aman." },
  { nama: "Rejosari", kecamatan: "Tenayan Raya", risiko: "Rendah", hotspot: 0, suhu: 31.9, kelembapan: 59, lat: 0.5460, lng: 101.4890,
    jenisLahan: "Perkebunan & Lahan Kosong", tujuanMonitoring: "Pemantauan pencegahan dini di area perkebunan yang berdekatan dengan zona rawan Tenayan Raya.",
    catatanLokal: "Wilayah berbatasan langsung dengan zona berisiko tinggi Tenayan Raya, perlu kewaspadaan penjalaran api.",
    ancamanDampak: "Berpotensi terdampak bila titik panas di Tenayan Raya meluas ke arah kelurahan ini.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Koordinasi lintas kelurahan dengan tim Sektor 3 dan pemantauan batas wilayah.",
    tindakanPenanganan: "Belum diperlukan, status siaga pemantauan.",
    hasilPeninjauan: "Belum ada titik api yang menjalar ke wilayah ini." },
  { nama: "Simpang Tiga", kecamatan: "Bukit Raya", risiko: "Rendah", hotspot: 0, suhu: 32.2, kelembapan: 57, lat: 0.4950, lng: 101.4650,
    jenisLahan: "Permukiman & Lahan Kosong", tujuanMonitoring: "Pemantauan rutin lahan kosong di kawasan permukiman berkembang.",
    catatanLokal: "Beberapa lahan kosong mulai dibangun perumahan baru, mengurangi luas area rawan terbakar.",
    ancamanDampak: "Ancaman karhutla rendah dan cenderung menurun seiring pembangunan permukiman.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Pemantauan berkala tanpa tindakan khusus.",
    tindakanPenanganan: "Tidak diperlukan.",
    hasilPeninjauan: "Tidak ada indikasi risiko pada peninjauan terakhir." },
  { nama: "Kulim", kecamatan: "Kulim", risiko: "Sedang", hotspot: 1, suhu: 34.0, kelembapan: 47, lat: 0.4890, lng: 101.5330,
    // Kecamatan Kulim (dimekarkan dari Tenayan Raya sejak Perda No. 2 Th. 2020) sebelumnya tidak
    // ada dalam data Monitoring sama sekali. Koordinat titik masih perkiraan karena GeoJSON batas
    // resmi kecamatan ini belum tersedia bebas (lihat catatan pada batas-kecamatan.js).
    jenisLahan: "Kawasan Industri & Lahan Gambut", tujuanMonitoring: "Memantau titik panas di sekitar kawasan industri yang berbatasan dengan lahan gambut.",
    catatanLokal: "Wilayah pemekaran baru dari Tenayan Raya dengan campuran kawasan industri dan lahan gambut di pinggirannya.",
    ancamanDampak: "Berpotensi mengganggu aktivitas industri dan menimbulkan kabut asap ke permukiman pekerja terdekat.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Koordinasi dengan pengelola kawasan industri dan patroli rutin lahan gambut sekitar.",
    tindakanPenanganan: "Belum diperlukan tindakan pemadaman, status pemantauan rutin.",
    hasilPeninjauan: "Tidak ditemukan titik api aktif pada peninjauan terakhir." },
  { nama: "Limbungan", kecamatan: "Rumbai Timur", risiko: "Sedang", hotspot: 1, suhu: 34.3, kelembapan: 46, lat: 0.5750, lng: 101.4650,
    // Kecamatan Rumbai Timur (hasil pemekaran sebagian wilayah Rumbai Pesisir/Rumbai, sejak Perda
    // No. 2 Th. 2020) sebelumnya tidak ada dalam data Monitoring sama sekali. Koordinat titik masih
    // perkiraan karena GeoJSON batas resmi kecamatan ini belum tersedia bebas.
    jenisLahan: "Lahan Gambut & Perkebunan", tujuanMonitoring: "Memantau titik panas di area gambut dan kebun warga di wilayah pemekaran baru.",
    catatanLokal: "Wilayah pemekaran baru dengan akses jalan yang masih terbatas di beberapa titik.",
    ancamanDampak: "Berpotensi menimbulkan kabut asap ke permukiman terdekat bila titik panas tidak segera ditangani.",
    jumlahTerdampakKK: 0, tindakanPencegahan: "Sosialisasi larangan membakar lahan dan pemantauan citra satelit berkala.",
    tindakanPenanganan: "Belum diperlukan tindakan pemadaman, status pemantauan rutin.",
    hasilPeninjauan: "Tidak ditemukan titik api aktif pada peninjauan terakhir." }
];

/* ---------------------------------------------------------------
   Titik fasilitas pendidikan (TK/SD/SMP Negeri) & kesehatan
   (Puskesmas/Klinik) untuk lapisan tambahan di Peta Wilayah.
   Nama & koordinat diambil dari data lokasi publik (Google Maps)
   per kecamatan Kota Pekanbaru — representatif, BUKAN basis data
   lengkap seluruh sekolah/faskes yang ada (jumlahnya ratusan).
   --------------------------------------------------------------- */
const TITIK_PENDIDIKAN = [
  { nama:"TK Negeri Pembina I", jenjang:"TK Negeri", kecamatan:"Sail", lat:0.5230788, lng:101.4553619 },
  { nama:"TK Negeri Pembina 2 Pekanbaru", jenjang:"TK Negeri", kecamatan:"Tuah Madani", lat:0.4511302, lng:101.4147463 },
  { nama:"SD Negeri 178 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Tenayan Raya", lat:0.5398389, lng:101.4947841 },
  { nama:"SD Negeri 46 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Tenayan Raya", lat:0.4742577, lng:101.5157568 },
  { nama:"SD Negeri 106 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Rumbai Barat", lat:0.5632686, lng:101.4416656 },
  { nama:"SD Negeri 102 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Rumbai", lat:0.5738081, lng:101.4490095 },
  // PERLU DICEK: koordinat titik ini (lat 0.5413798) jatuh di wilayah Payung Sekaki menurut uji
  // poligon, cukup jauh dari lokasi SD Negeri Tampan 011 yang sebenarnya (area Binawidya/Tuah
  // Madani). Kemungkinan koordinat sumber sebelumnya salah input — mohon diverifikasi ulang.
  { nama:"SD Negeri Tampan 011", jenjang:"SD Negeri", kecamatan:"Payung Sekaki", lat:0.5413798, lng:101.4147132 },
  { nama:"SMP Negeri 45 Pekanbaru", jenjang:"SMP Negeri", kecamatan:"Binawidya", lat:0.4979651, lng:101.3587389 },
  { nama:"SMP Bukit Raya", jenjang:"SMP Negeri", kecamatan:"Bukit Raya", lat:0.5063856, lng:101.4957224 },
  { nama:"SD Negeri 141 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Bukit Raya", lat:0.4616179, lng:101.4584019 },
  { nama:"SD Negeri 169 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Marpoyan Damai", lat:0.4350131, lng:101.4323606 },
  { nama:"SMP Negeri 25 Pekanbaru", jenjang:"SMP Negeri", kecamatan:"Marpoyan Damai", lat:0.4426996, lng:101.4376152 },
  { nama:"SD Negeri 160 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Marpoyan Damai", lat:0.4593336, lng:101.4506573 },
  { nama:"SD Negeri 124 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Payung Sekaki", lat:0.5154020, lng:101.4164355 },
  { nama:"SMP Negeri 36 Pekanbaru", jenjang:"SMP Negeri", kecamatan:"Payung Sekaki", lat:0.5453995, lng:101.4184330 },
  { nama:"SD Negeri 68 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Sukajadi", lat:0.5087804, lng:101.4354226 },
  { nama:"SMP Negeri 32 Pekanbaru", jenjang:"SMP Negeri", kecamatan:"Sukajadi", lat:0.5089428, lng:101.4358281 },
  { nama:"SD Negeri 88 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Sail", lat:0.5205511, lng:101.4561482 },
  { nama:"SD Negeri 125 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Pekanbaru Kota", lat:0.5224261, lng:101.4453943 },
  { nama:"SMP Negeri 1 Pekanbaru", jenjang:"SMP Negeri", kecamatan:"Lima Puluh", lat:0.5263500, lng:101.4537630 },
  { nama:"SD Negeri 7 Senapelan", jenjang:"SD Negeri", kecamatan:"Senapelan", lat:0.5382286, lng:101.4282471 },
  { nama:"SMP Negeri 2 Pekanbaru", jenjang:"SMP Negeri", kecamatan:"Senapelan", lat:0.5321723, lng:101.4419946 },
  { nama:"SD Negeri 183 Pekanbaru", jenjang:"SD Negeri", kecamatan:"Binawidya", lat:0.4524734, lng:101.3760409 }
];

const TITIK_KESEHATAN = [
  { nama:"Puskesmas Tenayan Raya", jenis:"Puskesmas", kecamatan:"Tenayan Raya", lat:0.4837822, lng:101.5271909 },
  { nama:"Puskesmas Rumbai", jenis:"Puskesmas", kecamatan:"Rumbai Barat", lat:0.5601634, lng:101.4410839 },
  { nama:"Puskesmas Rumbai Bukit", jenis:"Puskesmas", kecamatan:"Rumbai Barat", lat:0.6090589, lng:101.4007013 },
  { nama:"Klinik Utama Mutiara Hati", jenis:"Klinik", kecamatan:"Rumbai", lat:0.5610263, lng:101.4498900 },
  { nama:"Puskesmas Tampan", jenis:"Puskesmas", kecamatan:"Binawidya", lat:0.4694665, lng:101.4058524 },
  { nama:"Klinik Utama GASA", jenis:"Klinik", kecamatan:"Binawidya", lat:0.4859591, lng:101.3592893 },
  { nama:"Klinik Uwa Medica", jenis:"Klinik", kecamatan:"Binawidya", lat:0.4645425, lng:101.3951919 },
  { nama:"Puskesmas Harapan Raya", jenis:"Puskesmas", kecamatan:"Bukit Raya", lat:0.4993201, lng:101.4561237 },
  { nama:"Puskesmas Sapta Taruna", jenis:"Puskesmas", kecamatan:"Bukit Raya", lat:0.5042022, lng:101.4744647 },
  { nama:"Puskesmas Simpang Tiga", jenis:"Puskesmas", kecamatan:"Marpoyan Damai", lat:0.4635637, lng:101.4529472 },
  { nama:"Puskesmas Garuda", jenis:"Puskesmas", kecamatan:"Marpoyan Damai", lat:0.4917505, lng:101.4447731 },
  { nama:"Puskesmas Payung Sekaki", jenis:"Puskesmas", kecamatan:"Payung Sekaki", lat:0.5123958, lng:101.4157594 },
  { nama:"Puskesmas Sukajadi", jenis:"Puskesmas", kecamatan:"Sukajadi", lat:0.5132928, lng:101.4450998 },
  { nama:"Puskesmas Pekanbaru Kota", jenis:"Puskesmas", kecamatan:"Pekanbaru Kota", lat:0.5319698, lng:101.4530048 },
  { nama:"Puskesmas Lima Puluh", jenis:"Puskesmas", kecamatan:"Lima Puluh", lat:0.5403719, lng:101.4644081 },
  { nama:"Puskesmas Senapelan", jenis:"Puskesmas", kecamatan:"Senapelan", lat:0.5375380, lng:101.4357920 },
  { nama:"Puskesmas Sail", jenis:"Puskesmas", kecamatan:"Sail", lat:0.5226683, lng:101.4602698 },
  { nama:"Klinik Dr. Idha", jenis:"Klinik", kecamatan:"Tuah Madani", lat:0.4344397, lng:101.3997366 }
];

/* ---------------------------------------------------------------
   Titik rumah sakit di Kota Pekanbaru — data representatif dari
   rumah sakit besar/rujukan yang benar-benar beroperasi (RSUD,
   RS Polri, RS swasta). Koordinat diperkirakan dari alamat resmi
   per kecamatan — BUKAN basis data lengkap seluruh 20+ rumah sakit
   yang terdaftar di Kota Pekanbaru, mohon diverifikasi ulang bila
   dipakai untuk keperluan resmi/presisi tinggi.
   --------------------------------------------------------------- */
const TITIK_RUMAH_SAKIT = [
  { nama:"RSUD Arifin Achmad Provinsi Riau", jenis:"Rumah Sakit Umum Daerah (Tipe B Pendidikan)", kecamatan:"Pekanbaru Kota", alamat:"Jl. Diponegoro No.2, Sumahilang", lat:0.5299, lng:101.4419 },
  { nama:"RSUD Petala Bumi", jenis:"Rumah Sakit Umum Daerah", kecamatan:"Sukajadi", alamat:"Jl. Dr. Sutomo No.65, Sekip", lat:0.5388, lng:101.4363 },
  { nama:"Eka Hospital Pekanbaru", jenis:"Rumah Sakit Swasta", kecamatan:"Marpoyan Damai", alamat:"Jl. Soekarno-Hatta Km 6,5, Tangkerang Barat", lat:0.4658, lng:101.4453 },
  { nama:"RSI Ibnu Sina Pekanbaru", jenis:"Rumah Sakit Swasta", kecamatan:"Sukajadi", alamat:"Jl. Melati No.60, Harjosari", lat:0.5183, lng:101.4315 },
  { nama:"RS Santa Maria", jenis:"Rumah Sakit Swasta", kecamatan:"Sukajadi", alamat:"Jl. Jend. A. Yani No.68, Pulau Karam", lat:0.5241, lng:101.4341 },
  { nama:"Primaya Hospital Pekanbaru", jenis:"Rumah Sakit Swasta", kecamatan:"Bukit Raya", alamat:"Jl. Jend. Sudirman No.117, Tangkerang Selatan", lat:0.5027, lng:101.4526 },
  { nama:"RS Bhayangkara Polda Riau", jenis:"Rumah Sakit Polri", kecamatan:"Pekanbaru Kota", alamat:"Jl. RA Kartini No.14, Simpang Empat", lat:0.5305, lng:101.4406 },
  { nama:"RS Prima Pekanbaru", jenis:"Rumah Sakit Swasta", kecamatan:"Tampan", alamat:"Jl. Bima No.1, Delima", lat:0.4972, lng:101.4034 },
  { nama:"RS Awal Bros Panam", jenis:"Rumah Sakit Swasta", kecamatan:"Tampan", alamat:"Jl. HR Soebrantas Km 12", lat:0.4838, lng:101.3813 },
  { nama:"RS Syafira", jenis:"Rumah Sakit Swasta", kecamatan:"Sukajadi", alamat:"Jl. Durian No.109", lat:0.5137, lng:101.4368 }
];

/* --- Data hotspot (titik panas) mengikuti struktur SIPONGI/FIRMS --- */
// CATATAN PENTING: array ini SENGAJA dikosongkan (bukan lagi diisi contoh
// karangan sendiri seperti versi sebelumnya). Tabel "Arsip Data Titik Panas"
// di Monitoring Karhutla HANYA boleh menampilkan titik yang benar-benar
// terdeteksi satelit dari NASA FIRMS (lihat assets/js/api.js:
// ewsSimpanArsipHotspot() untuk sinkron harian & ewsMuatRiwayatHistorisFirms()
// untuk memuat kejadian yang sudah terjadi sebelumnya dari arsip resmi
// VIIRS_SNPP_SP). Ini dipertahankan sebagai variabel (bukan dihapus) hanya
// supaya halaman lain yang mereferensikannya (monitoring.html, laporan.html)
// tidak error saat arsip FIRMS betul-betul belum pernah disinkronkan sama
// sekali; dalam kondisi itu tabel akan menampilkan "0 titik" yang jujur,
// BUKAN data rekaan.
const DATA_HOTSPOT = [];

/* --- Riwayat kejadian karhutla --- */
const RIWAYAT_KEJADIAN = [
  { id:"KRH-2026-041", tanggal:"01 Sep 2026", tanggalISO:"2026-09-01", lokasi:"Kel. Rejosari, Tenayan Raya", luas:"2.4 Ha", status:"Ditangani", penyebab:"Pembukaan lahan", petugas:"Tim Damkarhutla Sektor 3",
    namaPetugas:"Andi Saputra", jenisLahan:"Lahan Gambut", tujuanMonitoring:"Memastikan sekat kanal menahan penjalaran api ke area gambut sekitar",
    catatanLokal:"Warga setempat melaporkan asap tebal sejak pagi hari; akses jalan menuju lokasi cukup sulit karena tanah gambut basah.",
    ancamanDampak:"Api berpotensi menjalar ke kebun warga dan menimbulkan kabut asap yang mengganggu aktivitas pemukiman terdekat.",
    jumlahTerdampak:"8 KK, 2.4 Ha lahan", tindakanPencegahan:"Pembuatan sekat bakar dan pembasahan lahan gambut di sekitar titik api.",
    tindakanPenanganan:"Pemadaman manual menggunakan pompa portable dan dibantu water bombing ringan.",
    hasilPeninjauan:"Api berhasil dilokalisasi, namun tim masih berjaga untuk memantau titik bara sisa." },
  { id:"KRH-2026-040", tanggal:"29 Agu 2026", tanggalISO:"2026-08-29", lokasi:"Kel. Limbungan, Rumbai Timur", luas:"1.1 Ha", status:"Selesai", penyebab:"Diduga faktor manusia", petugas:"Tim Damkarhutla Sektor 1",
    namaPetugas:"Budi Hartono", jenisLahan:"Lahan Gambut", tujuanMonitoring:"Verifikasi titik panas hasil deteksi satelit dan memastikan tidak ada perluasan area terbakar",
    catatanLokal:"Lokasi berdekatan dengan permukiman nelayan; sumber air terbatas sehingga suplai air dibantu dari sungai terdekat.",
    ancamanDampak:"Risiko penjalaran api ke arah permukiman nelayan cukup rendah karena vegetasi sekitar tidak terlalu rapat.",
    jumlahTerdampak:"1.1 Ha lahan kosong", tindakanPencegahan:"Patroli rutin dan sosialisasi larangan membakar lahan kepada warga sekitar.",
    tindakanPenanganan:"Pemadaman langsung oleh tim dalam waktu kurang dari 3 jam.",
    hasilPeninjauan:"Kejadian selesai ditangani tanpa korban jiwa maupun kerugian material yang signifikan." },
  { id:"KRH-2026-039", tanggal:"27 Agu 2026", tanggalISO:"2026-08-27", lokasi:"Kel. Sri Meranti, Rumbai", luas:"0.8 Ha", status:"Selesai", penyebab:"Cuaca kering & angin kencang", petugas:"Tim Damkarhutla Sektor 1",
    namaPetugas:"Candra Wijaya", jenisLahan:"Perkebunan Sawit", tujuanMonitoring:"Memantau perkembangan titik panas akibat cuaca ekstrem di area perkebunan sawit warga",
    catatanLokal:"Angin kencang menyulitkan proses pemadaman karena bara api mudah terbawa ke arah kebun sebelah.",
    ancamanDampak:"Berpotensi merusak tanaman sawit produktif milik warga di sekitar lokasi kejadian.",
    jumlahTerdampak:"0.8 Ha kebun sawit", tindakanPencegahan:"Pemantauan cuaca berkala dan kesiapsiagaan regu pemadam saat kondisi angin kencang.",
    tindakanPenanganan:"Pemadaman manual dengan dukungan mobil tangki air dari BPBD.",
    hasilPeninjauan:"Api padam total, kerugian terbatas pada tanaman sawit muda di sekitar titik kejadian." },
  { id:"KRH-2026-038", tanggal:"22 Agu 2026", tanggalISO:"2026-08-22", lokasi:"Kel. Simpang Baru, Tampan", luas:"3.6 Ha", status:"Selesai", penyebab:"Pembakaran lahan gambut", petugas:"Tim Damkarhutla Sektor 2",
    namaPetugas:"Dedi Kurniawan", jenisLahan:"Lahan Gambut", tujuanMonitoring:"Menindaklanjuti laporan warga terkait pembakaran lahan gambut secara sengaja",
    catatanLokal:"Ditemukan indikasi pembakaran yang disengaja untuk pembukaan lahan; kasus sudah dikoordinasikan dengan pihak kepolisian setempat.",
    ancamanDampak:"Menimbulkan kabut asap tebal yang menurunkan kualitas udara di beberapa kelurahan sekitar.",
    jumlahTerdampak:"3.6 Ha lahan gambut, sekitar 20 KK terdampak asap", tindakanPencegahan:"Pemasangan papan larangan membakar lahan dan patroli gabungan bersama Polsek setempat.",
    tindakanPenanganan:"Pemadaman selama dua hari menggunakan kombinasi manual dan water bombing.",
    hasilPeninjauan:"Api berhasil dipadamkan tuntas; kasus pembakaran diteruskan ke proses hukum lebih lanjut." },
  { id:"KRH-2026-037", tanggal:"18 Agu 2026", tanggalISO:"2026-08-18", lokasi:"Kel. Airputih, Tuah Madani", luas:"1.7 Ha", status:"Selesai", penyebab:"Puntung rokok", petugas:"Tim Damkarhutla Sektor 3",
    namaPetugas:"Eko Prasetyo", jenisLahan:"Semak Belukar", tujuanMonitoring:"Memastikan api yang berawal dari lahan semak tidak menjalar ke area hutan sekunder terdekat",
    catatanLokal:"Sumber api diduga berasal dari puntung rokok yang dibuang sembarangan di pinggir jalan.",
    ancamanDampak:"Potensi menjalar ke area hutan sekunder di belakang permukiman jika tidak segera ditangani.",
    jumlahTerdampak:"1.7 Ha semak belukar", tindakanPencegahan:"Pemasangan rambu peringatan bahaya kebakaran di area rawan dan edukasi warga sekitar.",
    tindakanPenanganan:"Pemadaman cepat oleh tim dalam waktu kurang dari 2 jam menggunakan alat pemadam ringan.",
    hasilPeninjauan:"Api padam sepenuhnya, tidak ada perluasan area maupun korban jiwa." }
];

/* --- Daftar peringatan aktif --- */
const DAFTAR_PERINGATAN = [
  { id:"PRG-014", tingkat:"Tinggi", wilayah:"Tenayan Raya, Rumbai, Rumbai Barat, Payung Sekaki", pesan:"Suhu tinggi, kelembapan rendah, dan peningkatan titik panas menunjukkan potensi risiko karhutla meningkat.", waktu:"02 Sep 2026, 15:00 WIB", status:"Aktif" },
  { id:"PRG-013", tingkat:"Sedang", wilayah:"Bukit Raya, Marpoyan Damai, Payung Sekaki", pesan:"Kelembapan udara menurun signifikan dalam 6 jam terakhir.", waktu:"02 Sep 2026, 10:00 WIB", status:"Aktif" },
  { id:"PRG-012", tingkat:"Tinggi", wilayah:"Rumbai Barat, Rumbai", pesan:"Terdeteksi klaster titik panas dengan confidence level tinggi.", waktu:"01 Sep 2026, 18:20 WIB", status:"Ditutup" },
  { id:"PRG-011", tingkat:"Rendah", wilayah:"Kota Pekanbaru (seluruh wilayah)", pesan:"Kondisi cuaca dan kualitas udara masih dalam batas normal.", waktu:"30 Agu 2026, 07:00 WIB", status:"Ditutup" }
];

/* --- Prakiraan cuaca 3 hari (fallback jika BMKG API tidak terjangkau dari browser) --- */
const CUACA_3HARI_FALLBACK = [
  { hari:"Hari ini", tanggal:"02 Sep", pagi:"Berawan", siang:"Cerah Berasap", malam:"Berawan", suhuMin:24, suhuMax:35, kelembapanMin:40, kelembapanMax:78, angin:"6 km/j - Timur" },
  { hari:"Besok", tanggal:"03 Sep", pagi:"Cerah", siang:"Cerah Berasap", malam:"Cerah", suhuMin:23, suhuMax:36, kelembapanMin:38, kelembapanMax:75, angin:"8 km/j - Timur Laut" },
  { hari:"Lusa", tanggal:"04 Sep", pagi:"Berawan", siang:"Berawan", malam:"Hujan Ringan", suhuMin:24, suhuMax:33, kelembapanMin:45, kelembapanMax:82, angin:"7 km/j - Utara" }
];

/* =========================================================
   Penyimpanan data yang diinput pengguna (persisten di browser)
   Dipakai supaya kejadian yang ditambahkan di halaman Riwayat
   Kejadian juga bisa ditarik saat menyusun Laporan.
   ========================================================= */
const EWS_STORAGE_RIWAYAT = "ews_karhutla_riwayat_tambahan";

function ewsGetRiwayatTambahan(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_RIWAYAT)) || []; }
  catch(e){ return []; }
}

function ewsSimpanRiwayatTambahan(list){
  localStorage.setItem(EWS_STORAGE_RIWAYAT, JSON.stringify(list));
}

// Pastikan data contoh (RIWAYAT_KEJADIAN) sudah tersimpan di localStorage
// supaya baris tersebut juga bisa diedit/diubah, bukan hanya kejadian baru.
function ewsSeedRiwayatJikaKosong(){
  if(localStorage.getItem(EWS_STORAGE_RIWAYAT) === null){
    ewsSimpanRiwayatTambahan(RIWAYAT_KEJADIAN.slice());
  }
}

function ewsTambahRiwayat(item){
  ewsSeedRiwayatJikaKosong();
  const list = ewsGetRiwayatTambahan();
  list.unshift(item);
  ewsSimpanRiwayatTambahan(list);
}

// Perbarui satu kejadian (berdasarkan id) dengan field-field baru
function ewsUpdateRiwayat(id, perubahan){
  ewsSeedRiwayatJikaKosong();
  const list = ewsGetRiwayatTambahan();
  const idx = list.findIndex(r => r.id === id);
  if(idx > -1){
    list[idx] = { ...list[idx], ...perubahan };
    ewsSimpanRiwayatTambahan(list);
    return list[idx];
  }
  return null;
}

// Hapus satu kejadian berdasarkan id
function ewsHapusRiwayat(id){
  ewsSeedRiwayatJikaKosong();
  const list = ewsGetRiwayatTambahan().filter(r => r.id !== id);
  ewsSimpanRiwayatTambahan(list);
}

// Gabungan data riwayat (contoh + kejadian yang ditambahkan/diubah admin)
function ewsSemuaRiwayat(){
  ewsSeedRiwayatJikaKosong();
  return ewsGetRiwayatTambahan();
}

/* =========================================================
   Laporan Petugas Lapangan (Formulir Laporan — laporan.html)
   ---------------------------------------------------------
   Beda dengan "Update Data Monitoring" (yang cuma mengubah SNAPSHOT
   suhu/kelembapan/titik panas terkini per kecamatan — lihat
   EWS_STORAGE_MONITORING di bawah), bagian ini adalah LOG/RIWAYAT setiap
   kali petugas turun ke lapangan dan mengisi formulir Laporan: satu
   laporan = satu kunjungan, lengkap dengan identitas petugas, tanggal &
   jam peninjauan, titik koordinat (kecamatan, kelurahan, lat/long),
   sampai tindakan yang diambil. Semua laporan yang tersimpan di sini
   OTOMATIS tampil sebagai tabel "Laporan Petugas Lapangan" pada halaman
   Monitoring Karhutla (monitoring.html) — lihat ewsSemuaLaporanPetugas().
   ========================================================= */
const EWS_STORAGE_LAPORAN_PETUGAS = "ews_karhutla_laporan_petugas";

// Data contoh awal (mengikuti format formulir yang sama seperti laporan
// buatan petugas) supaya tabel Laporan Petugas tidak kosong saat pertama
// kali dibuka. Diambil dari kondisi contoh yang sama seperti WILAYAH_RISIKO.
const DAFTAR_LAPORAN_PETUGAS_CONTOH = [
  { id:"RPT-1005", namaPetugas:"Ahmad Fauzi", tanggal:"2025-08-12", waktu:"09:30",
    kecamatan:"Tenayan Raya", kelurahan:"Rejosari", lat:0.5486, lng:101.5192,
    jenisLahan:"Lahan Gambut",
    tujuanMonitoring:"Memantau perkembangan titik panas di area gambut yang berdekatan dengan kebun warga.",
    catatanLokal:"Kondisi tanah gambut kering akibat kemarau panjang; akses menuju sebagian titik cukup sulit dilalui kendaraan roda empat.",
    ancamanDampak:"Api berpotensi menjalar cepat di lahan gambut kering dan menimbulkan kabut asap ke permukiman terdekat.",
    jumlahTerdampakKK:12,
    tindakanPencegahan:"Patroli udara & darat rutin, pembasahan lahan gambut, dan sosialisasi larangan membakar kepada warga.",
    tindakanPenanganan:"Kesiagaan regu pemadam Sektor 3 dengan pompa portable dan mobil tangki air siaga di lokasi.",
    hasilPeninjauan:"Titik panas masih aktif, tim tetap berjaga dan memantau perkembangan setiap 3 jam.",
    dibuatPada:"2025-08-12T09:45:00.000Z", diinputOleh:"Admin 2", diinputOlehRole:"Petugas Lapangan (Akses Laporan)" },
  { id:"RPT-1004", namaPetugas:"Siti Rahma", tanggal:"2025-08-11", waktu:"14:10",
    kecamatan:"Rumbai", kelurahan:"Sri Meranti", lat:0.5637, lng:101.4111,
    jenisLahan:"Lahan Gambut",
    tujuanMonitoring:"Verifikasi lapangan atas titik panas hasil deteksi satelit di area gambut pesisir.",
    catatanLokal:"Lokasi berdekatan dengan permukiman nelayan; sumber air terbatas sehingga suplai dibantu dari sungai terdekat.",
    ancamanDampak:"Risiko penjalaran api ke arah permukiman nelayan serta gangguan aktivitas warga akibat kabut asap.",
    jumlahTerdampakKK:9,
    tindakanPencegahan:"Pemasangan papan larangan membakar lahan dan patroli gabungan bersama warga setempat.",
    tindakanPenanganan:"Pemadaman manual dibantu suplai air dari sungai terdekat, disiagakan regu Sektor 1.",
    hasilPeninjauan:"Sebagian titik berhasil dilokalisasi, pemantauan lanjutan masih diperlukan pada sore hari.",
    dibuatPada:"2025-08-11T14:25:00.000Z", diinputOleh:"Admin 2", diinputOlehRole:"Petugas Lapangan (Akses Laporan)" },
  { id:"RPT-1003", namaPetugas:"Budi Santoso", tanggal:"2025-08-10", waktu:"11:00",
    kecamatan:"Rumbai Barat", kelurahan:"Rumbai Bukit", lat:0.5350, lng:101.4390,
    jenisLahan:"Perkebunan Sawit",
    tujuanMonitoring:"Memantau titik panas di area perkebunan sawit warga akibat cuaca kering dan angin kencang.",
    catatanLokal:"Angin kencang di siang hari menyulitkan pemadaman karena bara api mudah terbawa ke kebun sebelah.",
    ancamanDampak:"Berpotensi merusak tanaman sawit produktif milik warga di sekitar titik panas.",
    jumlahTerdampakKK:6,
    tindakanPencegahan:"Pemantauan cuaca berkala dan kesiapsiagaan regu saat kondisi angin kencang.",
    tindakanPenanganan:"Pemadaman manual dengan dukungan mobil tangki air BPBD.",
    hasilPeninjauan:"Perkembangan api masih dipantau, belum ada perluasan area terdampak.",
    dibuatPada:"2025-08-10T11:20:00.000Z", diinputOleh:"Admin 1", diinputOlehRole:"Administrator Sistem (Akses Penuh)" },
  { id:"RPT-1002", namaPetugas:"Dewi Anggraini", tanggal:"2025-08-09", waktu:"08:45",
    kecamatan:"Binawidya", kelurahan:"Simpang Baru", lat:0.4802, lng:101.3986,
    jenisLahan:"Semak Belukar",
    tujuanMonitoring:"Menindaklanjuti laporan warga terkait titik panas di lahan semak belukar kosong.",
    catatanLokal:"Lahan merupakan tanah kosong tak bertuan yang sering ditumbuhi semak kering saat kemarau.",
    ancamanDampak:"Kabut asap tipis mulai tercium di beberapa RW terdekat, berpotensi meluas bila tidak segera ditangani.",
    jumlahTerdampakKK:4,
    tindakanPencegahan:"Pembersihan semak kering secara berkala dan patroli rutin Sektor 2.",
    tindakanPenanganan:"Pemadaman manual oleh regu setempat menggunakan peralatan ringan.",
    hasilPeninjauan:"Api berhasil dipadamkan sebagian, tim masih memantau kemungkinan titik bara baru.",
    dibuatPada:"2025-08-09T09:05:00.000Z", diinputOleh:"Admin 2", diinputOlehRole:"Petugas Lapangan (Akses Laporan)" },
  { id:"RPT-1001", namaPetugas:"Rian Hidayat", tanggal:"2025-08-08", waktu:"16:20",
    kecamatan:"Bukit Raya", kelurahan:"Tangkerang Selatan", lat:0.5083, lng:101.4767,
    jenisLahan:"Lahan Kosong & Semak",
    tujuanMonitoring:"Memantau perkembangan cuaca dan potensi titik panas baru di lahan kosong pinggir jalan.",
    catatanLokal:"Beberapa warga masih terpantau membakar sampah di lahan kosong, berisiko memicu titik panas baru.",
    ancamanDampak:"Risiko masih tergolong sedang, namun berpotensi meningkat bila cuaca kering berlanjut.",
    jumlahTerdampakKK:0,
    tindakanPencegahan:"Sosialisasi larangan membakar sampah/lahan dan pemantauan berkala petugas.",
    tindakanPenanganan:"Belum ada tindakan pemadaman aktif, status masih pemantauan.",
    hasilPeninjauan:"Kondisi terkendali, tidak ditemukan titik api aktif saat peninjauan terakhir.",
    dibuatPada:"2025-08-08T16:35:00.000Z", diinputOleh:"Admin 1", diinputOlehRole:"Administrator Sistem (Akses Penuh)" }
];

function ewsGetLaporanPetugasTersimpan(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_LAPORAN_PETUGAS)) || []; }
  catch(e){ return []; }
}

function ewsSimpanLaporanPetugasTersimpan(list){
  localStorage.setItem(EWS_STORAGE_LAPORAN_PETUGAS, JSON.stringify(list));
}

function ewsSeedLaporanPetugasJikaKosong(){
  if(localStorage.getItem(EWS_STORAGE_LAPORAN_PETUGAS) === null){
    ewsSimpanLaporanPetugasTersimpan(JSON.parse(JSON.stringify(DAFTAR_LAPORAN_PETUGAS_CONTOH)));
  }
}

// Menyimpan satu laporan baru hasil formulir (dipanggil dari laporan.html)
function ewsTambahLaporanPetugas(item){
  ewsSeedLaporanPetugasJikaKosong();
  const list = ewsGetLaporanPetugasTersimpan();
  list.unshift(item);
  ewsSimpanLaporanPetugasTersimpan(list);
  return item;
}

// Seluruh laporan petugas, terurut dari yang paling baru ditinjau (tanggal +
// waktu peninjauan lapangan, BUKAN waktu klik simpan) — dipakai bersama oleh
// laporan.html (riwayat) dan monitoring.html (tab Laporan Petugas Lapangan).
function ewsSemuaLaporanPetugas(){
  ewsSeedLaporanPetugasJikaKosong();
  return ewsGetLaporanPetugasTersimpan().slice().sort((a, b) => {
    const wa = (a.tanggal || "") + "T" + (a.waktu || "00:00");
    const wb = (b.tanggal || "") + "T" + (b.waktu || "00:00");
    return wb.localeCompare(wa);
  });
}

function ewsHapusLaporanPetugas(id){
  ewsSeedLaporanPetugasJikaKosong();
  const list = ewsGetLaporanPetugasTersimpan().filter(l => l.id !== id);
  ewsSimpanLaporanPetugasTersimpan(list);
}

// Memperbarui SEBAGIAN field laporan yang sudah tersimpan (dipakai untuk
// memperbaiki kesalahan penulisan/kekeliruan data — namaPetugas, lokasi,
// isi laporan, dsb.) tanpa mengubah id maupun jejak audit siapa yang
// PERTAMA KALI menginput (diinputOleh/diinputOlehRole). Dipanggil dari
// modal Edit di laporan.html maupun dari tab "Laporan Petugas Lapangan"
// pada monitoring.html (lihat ewsBukaModalEditLaporan di components.js).
function ewsPerbaruiLaporanPetugas(id, patch){
  ewsSeedLaporanPetugasJikaKosong();
  const list = ewsGetLaporanPetugasTersimpan();
  const idx = list.findIndex(l => l.id === id);
  if(idx === -1) return false;
  list[idx] = Object.assign({}, list[idx], patch);
  ewsSimpanLaporanPetugasTersimpan(list);
  return true;
}

// Laporan lapangan PALING BARU untuk satu kecamatan tertentu — dipakai
// halaman Monitoring supaya modal "Detail" per kecamatan menampilkan info
// naratif dari laporan petugas terakhir (bukan data statis lama), kalau ada.
function ewsLaporanPetugasTerbaruUntukKecamatan(kecamatan){
  return ewsSemuaLaporanPetugas().find(l => l.kecamatan === kecamatan) || null;
}

/* =========================================================
   FORMAT KOLOM RESMI — Laporan Petugas Lapangan
   Mengikuti format tabel laporan yang dipakai BPBD Kota Pekanbaru
   (lihat formulir cetak). SATU definisi ini dipakai bersama oleh:
   - tabel di monitoring.html (tab Laporan Petugas Lapangan)
   - ekspor Excel (.xlsx) & CSV di monitoring.html dan laporan.html
   sehingga urutan/judul kolom dijamin selalu sama di semua keluaran.
   ========================================================= */
function ewsFormatTglLaporan(iso){
  if(!iso) return "-";
  return new Date(iso).toLocaleDateString("id-ID", { day:"2-digit", month:"2-digit", year:"numeric" });
}

const EWS_KOLOM_LAPORAN_PETUGAS = [
  { label:"No.",                   lebar:6,  ambil:(l,i)=> i + 1 },
  { label:"Nama Petugas",          lebar:20, ambil:l=> l.namaPetugas || "-" },
  { label:"Tanggal",               lebar:13, ambil:l=> ewsFormatTglLaporan(l.tanggal) },
  { label:"Waktu",                 lebar:9,  ambil:l=> l.waktu || "-" },
  { label:"Kecamatan",             lebar:18, ambil:l=> l.kecamatan || "-" },
  { label:"Kelurahan",             lebar:18, ambil:l=> l.kelurahan || "-" },
  { label:"Latitude",              lebar:12, ambil:l=> isFinite(l.lat) ? Number(l.lat).toFixed(4) : "-" },
  { label:"Longitude",             lebar:12, ambil:l=> isFinite(l.lng) ? Number(l.lng).toFixed(4) : "-" },
  { label:"Catatan Lokal",         lebar:38, ambil:l=> l.catatanLokal || "-" },
  { label:"Jenis Lahan",           lebar:22, ambil:l=> l.jenisLahan || "-" },
  { label:"Tujuan Monitoring",     lebar:38, ambil:l=> l.tujuanMonitoring || "-" },
  { label:"Ancaman dan Dampak",    lebar:38, ambil:l=> l.ancamanDampak || "-" },
  { label:"Jumlah Terdampak (KK)", lebar:12, ambil:l=> (l.jumlahTerdampakKK ?? 0) },
  { label:"Tindakan Pencegahan",   lebar:38, ambil:l=> l.tindakanPencegahan || "-" },
  { label:"Tindakan Penanganan",   lebar:38, ambil:l=> l.tindakanPenanganan || "-" },
  { label:"Hasil Peninjauan",      lebar:38, ambil:l=> l.hasilPeninjauan || "-" },
  { label:"Diinput Oleh",          lebar:16, ambil:l=> l.diinputOleh || "-" }
];

function ewsJudulKolomLaporanPetugas(){
  return EWS_KOLOM_LAPORAN_PETUGAS.map(k => k.label);
}

function ewsBarisLaporanPetugas(l, i){
  return EWS_KOLOM_LAPORAN_PETUGAS.map(k => k.ambil(l, i));
}

/* Unduh daftar laporan sebagai file Excel (.xlsx) asli memakai SheetJS.
   Dipakai bersama oleh monitoring.html & laporan.html. Kalau pustaka
   SheetJS belum termuat (mis. offline), fungsi mengembalikan false supaya
   pemanggil bisa menawarkan CSV sebagai cadangan. */
function ewsUnduhLaporanPetugasExcel(rows, namaFile){
  if(typeof XLSX === "undefined") return false;

  const judul = ewsJudulKolomLaporanPetugas();
  const isi = rows.map((l, i) => ewsBarisLaporanPetugas(l, i));
  const ws = XLSX.utils.aoa_to_sheet([judul, ...isi]);

  ws["!cols"] = EWS_KOLOM_LAPORAN_PETUGAS.map(k => ({ wch: k.lebar }));

  // Bungkus teks pada sel catatan panjang + beri garis tepi supaya hasil
  // cetaknya mirip formulir resmi.
  const rentang = XLSX.utils.decode_range(ws["!ref"]);
  for(let R = rentang.s.r; R <= rentang.e.r; R++){
    for(let C = rentang.s.c; C <= rentang.e.c; C++){
      const sel = ws[XLSX.utils.encode_cell({ r:R, c:C })];
      if(!sel) continue;
      const tepi = { style:"thin", color:{ rgb:"C7CDD6" } };
      sel.s = {
        alignment:{ wrapText:true, vertical:"top", horizontal: R === 0 ? "center" : "left" },
        border:{ top:tepi, bottom:tepi, left:tepi, right:tepi },
        font: R === 0 ? { bold:true, color:{ rgb:"FFFFFF" } } : {},
        fill: R === 0 ? { fgColor:{ rgb:"1F7A4D" } } : undefined
      };
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Laporan Petugas");
  XLSX.writeFile(wb, namaFile);
  return true;
}

const NOTIF_LIST = [
  { text: "Titik panas baru terdeteksi di Kec. Tenayan Raya", time: "15 menit lalu", level: "high" },
  { text: "Kelembapan udara turun di bawah 50%", time: "1 jam lalu", level: "medium" },
  { text: "Laporan mingguan berhasil dibuat", time: "3 jam lalu", level: "info" }
];

/* =========================================================
   SUMBER DATA TUNGGAL — Monitoring Karhutla
   Ini adalah inti dari keterhubungan otomatis antar halaman:
   Monitoring → Peringatan → Peta → Dashboard.

   1. WILAYAH_RISIKO (di atas) adalah data DASAR (contoh/awal).
   2. Saat petugas meng-klik "Update" pada satu kecamatan di
      halaman Monitoring, nilai suhu/kelembapan/titik panas baru
      disimpan sebagai "override" di localStorage, dan tingkat
      risikonya DIHITUNG ULANG otomatis (bukan dipilih manual)
      lewat ewsHitungRisiko().
   3. ewsGetWilayahRisikoGabungan() menggabungkan data dasar +
      override → inilah yang dipakai SEMUA halaman (Monitoring,
      Peringatan, Peta, Dashboard). Karena satu fungsi ini
      dipakai bersama, begitu Monitoring diperbarui, halaman
      lain otomatis ikut berubah saat dibuka/direfresh — tanpa
      perlu input ulang di masing-masing halaman.
   ========================================================= */
const EWS_STORAGE_MONITORING = "ews_karhutla_monitoring_override";

// Menghitung tingkat risiko otomatis dari 3 indikator (bukan dipilih manual)
function ewsHitungStatusOperasional(suhu, kelembapan, hotspot, ffmcCategory, persistent = false){
  const ffmc = String(ffmcCategory || '').trim().toLowerCase();
  const adaHotspot = Number(hotspot || 0) > 0;
  const ffmcTinggi = ffmc === 'tinggi' || ffmc === 'sangat tinggi';
  const ffmcSangatTinggi = ffmc === 'sangat tinggi';

  // FireSentry tidak membuat ambang suhu/RH baru. Suhu, kelembapan, dan angin
  // tetap ditampilkan sebagai konteks meteorologis dari BMKG. Status utama
  // ditentukan dari bukti hotspot dan kategori FFMC BMKG bila tersedia.
  if (persistent && ffmcSangatTinggi) return 'PERINGATAN';
  if (adaHotspot && ffmcTinggi) return 'SIAGA';
  if (persistent && adaHotspot) return 'SIAGA';
  if (adaHotspot || ffmcTinggi) return 'WASPADA';
  return 'NORMAL';
}

// Kompatibilitas UI lama: halaman yang masih memakai label Rendah/Sedang/Tinggi
// tetap bekerja tanpa perubahan tampilan. Mesin EWS baru memakai statusEws.
function ewsHitungRisiko(suhu, kelembapan, hotspot, ffmcCategory, persistent = false){
  const status = ewsHitungStatusOperasional(suhu, kelembapan, hotspot, ffmcCategory, persistent);
  if(status === 'NORMAL') return 'Rendah';
  if(status === 'WASPADA') return 'Sedang';
  return 'Tinggi';
}

function ewsGetMonitoringOverride(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_MONITORING)) || {}; }
  catch(e){ return {}; }
}

// Field catatan & tindakan lapangan (selain suhu/kelembapan/hotspot) yang
// bisa diperbarui petugas lewat form Update Data di halaman Monitoring.
const EWS_FIELD_CATATAN_MONITORING = [
  "jenisLahan", "tujuanMonitoring", "catatanLokal", "ancamanDampak",
  "jumlahTerdampakKK", "tindakanPencegahan", "tindakanPenanganan", "hasilPeninjauan"
];

function ewsSimpanUpdateMonitoring(kecamatan, suhu, kelembapan, hotspot, catatan){
  const all = ewsGetMonitoringOverride();
  const sebelumnya = all[kecamatan] || {};
  all[kecamatan] = {
    ...sebelumnya,
    suhu, kelembapan, hotspot,
    risiko: ewsHitungRisiko(suhu, kelembapan, hotspot),
    ...(catatan || {}),
    diperbaruiOleh: (typeof ewsCurrentUser === "function" && ewsCurrentUser() && ewsCurrentUser().nama) || "Petugas BPBD",
    diperbaruiPada: new Date().toISOString()
  };
  localStorage.setItem(EWS_STORAGE_MONITORING, JSON.stringify(all));
}

/* =========================================================
   Hasil cek OTOMATIS dari GitHub Actions (lihat
   scripts/cek-status-karhutla.mjs + data/status-notifikasi-terakhir.json).
   Ini berjalan sendiri tiap 3 jam TANPA perlu ada yang membuka browser
   sama sekali — beda dengan "Sinkronkan Sekarang" di halaman Monitoring
   yang hanya jalan kalau ada orang membuka halaman itu di satu browser
   tertentu (hasilnya pun cuma tersimpan di localStorage browser itu saja,
   tidak ikut terlihat dari perangkat/browser lain).

   Sebelumnya, hasil cek otomatis ini HANYA dipakai untuk kirim notifikasi
   Telegram — tidak pernah dibaca balik oleh peringatan.html/dashboard.html,
   makanya halaman Peringatan bisa terlihat "macet" di kondisi lama padahal
   sistem di baliknya sebenarnya sudah mendeteksi perubahan.
   ========================================================= */
const EWS_STATUS_OTOMATIS_URL = "data/status-notifikasi-terakhir.json";
let EWS_STATUS_OTOMATIS_CACHE = null; // diisi async oleh ewsMuatStatusOtomatis()

async function ewsMuatStatusOtomatis(){
  try{
    const res = await fetch(EWS_STATUS_OTOMATIS_URL + "?v=" + Date.now(), { cache: "no-store" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if(!json || typeof json !== "object" || !json._meta) throw new Error("Format status EWS tidak valid");
    EWS_STATUS_OTOMATIS_CACHE = json;
  }catch(e){
    console.warn("[Status otomatis] Hasil GitHub Actions belum tersedia:", e);
    EWS_STATUS_OTOMATIS_CACHE = null;
  }
  return EWS_STATUS_OTOMATIS_CACHE;
}

// Kapan pengecekan otomatis (GitHub Actions) TERAKHIR berhasil jalan —
// dipakai untuk menampilkan "Terakhir dicek otomatis: ..." di halaman,
// supaya jelas beda antara "memang masih Rendah" vs "sistemnya berhenti jalan".
function ewsWaktuStatusOtomatisTerakhir(){
  return (EWS_STATUS_OTOMATIS_CACHE && EWS_STATUS_OTOMATIS_CACHE._meta)
    ? EWS_STATUS_OTOMATIS_CACHE._meta.diperbaruiPada
    : null;
}

// PERBAIKAN (lihat "Riwayat Revisi" di README, poin soal Peringatan macet
// di Rendah): sebelum ini, entri hasil cek otomatis (data/status-notifikasi-
// terakhir.json) LANGSUNG dipakai tanpa dicek dulu bentuknya. Kalau file itu
// masih format LAMA (cuma string "Rendah"/"Sedang"/"Tinggi", bukan objek)
// atau belum pernah diisi GitHub Actions (nilainya null / field tidak
// lengkap), maka w.suhu/w.kelembapan/w.hotspot/w.risiko ikut jadi undefined.
// Akibatnya kecamatan itu SILANG HILANG dari pengelompokan risiko di
// generatePeringatanDariMonitoring() (lihat kelompok[w.risiko]?.push — kalau
// w.risiko undefined, tidak masuk kelompok manapun), sehingga peringatan
// Sedang/Tinggi yang sebenarnya ada jadi tidak muncul dan halaman Peringatan
// terlihat "stuck" cuma menampilkan Rendah (atau malah kosong). Fungsi ini
// sekarang memvalidasi dulu bentuk datanya sebelum dipakai.
function ewsEntriOtomatisValid(a){
  return !!a && typeof a === "object" &&
    ["Tinggi","Sedang","Rendah"].includes(a.risiko) &&
    typeof a.suhu === "number" && typeof a.kelembapan === "number" && typeof a.hotspot === "number";
}

// Data monitoring gabungan (dasar + hasil cek otomatis + hasil update
// petugas) — dipakai di SEMUA halaman. Prioritas: kalau ada override MANUAL
// dan hasil cek OTOMATIS untuk kecamatan yang sama, yang dipakai adalah
// yang PALING BARU waktunya (bukan otomatis selalu menang, bukan juga
// manual selalu menang) — supaya data yang ditampilkan selalu yang paling
// mutakhir, dari sumber manapun itu datang.
function ewsGetWilayahRisikoGabungan(){
  const override = ewsGetMonitoringOverride();
  const otomatis = (EWS_STATUS_OTOMATIS_CACHE && typeof EWS_STATUS_OTOMATIS_CACHE === "object") ? EWS_STATUS_OTOMATIS_CACHE : {};

  return WILAYAH_RISIKO.map(w => {
    const o = override[w.kecamatan];
    const aMentah = otomatis[w.kecamatan]; // { risiko, suhu, kelembapan, hotspot, waktuCek }
    // Entri yang tidak valid (format lama / belum pernah dicek) dianggap
    // TIDAK ADA, supaya tidak menimpa data dasar/manual dengan nilai undefined.
    const a = ewsEntriOtomatisValid(aMentah) ? aMentah : null;

    let terpilih = null; // sumber data yang dipakai: null = pakai data dasar
    if(o && a){
      const waktuO = o.diperbaruiPada ? new Date(o.diperbaruiPada).getTime() : 0;
      const waktuA = a.waktuCek ? new Date(a.waktuCek).getTime() : 0;
      terpilih = waktuA > waktuO ? "otomatis" : "manual";
    } else if(o){
      terpilih = "manual";
    } else if(a){
      terpilih = "otomatis";
    }

    if(terpilih === "manual"){
      const hasil = { ...w, suhu:o.suhu, kelembapan:o.kelembapan, hotspot:o.hotspot, risiko:o.risiko, diperbaruiOleh:o.diperbaruiOleh, diperbaruiPada:o.diperbaruiPada, sumberData:"manual" };
      EWS_FIELD_CATATAN_MONITORING.forEach(f => { if(o[f] !== undefined) hasil[f] = o[f]; });
      return hasil;
    }
    if(terpilih === "otomatis"){
      return { ...w, suhu:a.suhu, kelembapan:a.kelembapan, hotspot:a.hotspot, risiko:a.risiko, diperbaruiOleh:"Sistem (otomatis)", diperbaruiPada:a.waktuCek, sumberData:"otomatis" };
    }
    return w;
  });
}

/* =========================================================
   Status risiko KESELURUHAN kota, dihitung dari jumlah wilayah
   per tingkat risiko (bukan nilai tetap/hardcode). Dua pendekatan
   tersedia — Dashboard memakai ewsHitungStatusMayoritas() di bawah
   sebagai status UTAMA, dan versi "worst-case" berikut ini disimpan
   sebagai alternatif/referensi bila suatu saat ingin diaktifkan
   kembali (mis. kebijakan BPBD berubah jadi lebih ketat):
   - worst-case wins: ADA 1 wilayah Tinggi -> status Tinggi;
     tidak ada Tinggi tapi ada Sedang -> Sedang; semua Rendah -> Rendah.
   ========================================================= */
function ewsHitungStatusKota(jumlahRisiko){
  if(jumlahRisiko.tinggi > 0) return "Tinggi";
  if(jumlahRisiko.sedang > 0) return "Sedang";
  return "Rendah";
}

// Status berdasarkan warna yang PALING BANYAK jumlah wilayahnya (mayoritas).
// INI YANG DIPAKAI Dashboard saat ini — label utama donut & banner mengikuti
// warna paling dominan secara visual (supaya tidak kontradiktif, mis. donut
// dominan hijau tapi label "Tinggi"). Wilayah Sedang/Tinggi yang bukan
// mayoritas tetap ditampilkan sebagai catatan tambahan di dashboard.html,
// jadi tidak hilang/tersembunyi begitu saja. Jika jumlahnya seri,
// diprioritaskan tingkat yang lebih parah (Tinggi > Sedang > Rendah)
// supaya tetap condong ke sisi aman/waspada.
function ewsHitungStatusMayoritas(jumlahRisiko){
  const entri = [
    ["Tinggi", jumlahRisiko.tinggi],
    ["Sedang", jumlahRisiko.sedang],
    ["Rendah", jumlahRisiko.rendah]
  ];
  entri.sort((a, b) => b[1] - a[1]); // urut jumlah terbanyak dulu; seri -> urutan asli (Tinggi>Sedang>Rendah) menang
  return entri[0][0];
}

/* =========================================================
   Peringatan otomatis dari data Monitoring
   Data peringatan TIDAK diinput manual — melainkan dihasilkan
   langsung dari ewsGetWilayahRisikoGabungan() (data terkini
   halaman Monitoring Karhutla, termasuk update petugas).
   Setiap kecamatan berisiko Tinggi/Sedang otomatis menjadi
   satu entri peringatan aktif.

   CATATAN TANGGAL/WAKTU KEMUNCULAN: sebelumnya field "waktu" di
   setiap kartu SELALU menunjukkan waktu SAAT HALAMAN DIBUKA (jam
   sekarang) — bukan kapan kondisi itu SEBENARNYA pertama kali
   muncul. Jadi kalau halaman dibuka ulang beberapa hari kemudian
   dan kondisinya masih sama, waktunya ikut "maju" seolah baru saja
   terjadi, dan begitu ditutup/berubah, riwayatnya hilang begitu
   saja tanpa jejak kapan pertama terjadi. Sekarang setiap kali
   kombinasi (tingkat + wilayah + jumlah titik panas) berbeda dari
   yang terakhir tercatat, waktu SAAT ITU dicatat permanen ke log
   (ewsCatatKemunculanPeringatan) sebagai "pertama terdeteksi", dan
   log itu tetap tersimpan di Riwayat walau kondisinya sudah lewat/
   berubah lagi — tidak perlu menunggu petugas klik "Tutup".
   ========================================================= */
const EWS_STORAGE_PERINGATAN_LOG = "ews_karhutla_peringatan_log";
const EWS_STORAGE_PERINGATAN_LOG_TERAKHIR = "ews_karhutla_peringatan_log_terakhir"; // { [tingkat]: { signature, waktuIso } }
const EWS_PERINGATAN_LOG_MAKS_ENTRI = 500; // batas jumlah entri log tersimpan, entri tertua dibuang duluan

function ewsGetPeringatanLog(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_PERINGATAN_LOG)) || []; }
  catch(e){ return []; }
}

function ewsGetPeringatanLogTerakhir(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_PERINGATAN_LOG_TERAKHIR)) || {}; }
  catch(e){ return {}; }
}

// Dipanggil tiap kali generatePeringatanDariMonitoring() jalan (jadi tiap
// halaman Peringatan dibuka/di-refresh/auto-sync). Untuk tiap tingkat risiko
// yang sedang aktif, bandingkan signature-nya dengan signature TERAKHIR yang
// pernah tercatat untuk tingkat itu:
//  - kalau BEDA (baru pertama kali / kondisinya berubah) -> catat entri log
//    baru dengan waktu SEKARANG sebagai "pertama terdeteksi", dan jadikan
//    signature ini acuan baru.
//  - kalau SAMA -> tidak menambah log baru, tapi waktu "pertama terdeteksi"
//    yang sudah tersimpan sebelumnya dipakai lagi (supaya waktunya tidak
//    ikut maju terus tiap halaman dibuka ulang).
// Mengembalikan map { [tingkat]: waktuIsoPertamaTerdeteksi } untuk dipakai
// menampilkan "Terdeteksi sejak" di kartu peringatan aktif.
function ewsCatatKemunculanPeringatan(hasilAktif){
  const log = ewsGetPeringatanLog();
  const terakhir = ewsGetPeringatanLogTerakhir();
  const pertamaTerdeteksi = {};
  const nowIso = new Date().toISOString();

  hasilAktif.forEach(h => {
    const acuan = terakhir[h.tingkat];
    if(acuan && acuan.signature === h.signature){
      pertamaTerdeteksi[h.tingkat] = acuan.waktuIso;
      return;
    }
    // Signature berubah (atau belum pernah tercatat) -> catat kemunculan baru
    log.unshift({
      id: "PRG-LOG-" + Date.now() + "-" + h.tingkat,
      tingkat: h.tingkat,
      wilayah: h.wilayah,
      pesan: h.pesan,
      totalHotspot: h.totalHotspot,
      jumlahWilayah: h.jumlahWilayah,
      signature: h.signature,
      waktuIso: nowIso,
      waktu: new Date(nowIso).toLocaleString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) + " WIB",
      status: "Terdeteksi (" + h.tingkat + ")"
    });
    terakhir[h.tingkat] = { signature: h.signature, waktuIso: nowIso };
    pertamaTerdeteksi[h.tingkat] = nowIso;
  });

  if(log.length > EWS_PERINGATAN_LOG_MAKS_ENTRI) log.length = EWS_PERINGATAN_LOG_MAKS_ENTRI;
  localStorage.setItem(EWS_STORAGE_PERINGATAN_LOG, JSON.stringify(log));
  localStorage.setItem(EWS_STORAGE_PERINGATAN_LOG_TERAKHIR, JSON.stringify(terakhir));
  return pertamaTerdeteksi;
}

function generatePeringatanDariMonitoring(){
  const now = new Date();
  const waktu = now.toLocaleString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) + " WIB";

  const dataTerkini = ewsGetWilayahRisikoGabungan();
  const kelompok = { Tinggi: [], Sedang: [], Rendah: [] };
  dataTerkini.forEach(w => kelompok[w.risiko]?.push(w));

  const pesanTemplate = {
    Tinggi: "Suhu tinggi, kelembapan rendah, dan titik panas terdeteksi menunjukkan potensi risiko karhutla TINGGI. Perlu kesiagaan dan patroli lapangan segera.",
    Sedang: "Beberapa indikator (suhu/kelembapan/titik panas) menunjukkan peningkatan risiko karhutla pada tingkat SEDANG. Perlu pemantauan lebih ketat.",
    Rendah: "Kondisi cuaca dan jumlah titik panas masih dalam batas normal. Risiko karhutla saat ini tergolong RENDAH."
  };

  const hasil = [];
  ["Tinggi","Sedang"].forEach(level => {
    const list = kelompok[level];
    if(list.length === 0) return;
    hasil.push({
      id: "PRG-AUTO-" + level.toUpperCase(),
      tingkat: level,
      wilayah: list.map(w => w.kecamatan).join(", "),
      pesan: pesanTemplate[level],
      waktuUpdate: waktu,
      status: "Aktif",
      totalHotspot: list.reduce((s,w)=>s+w.hotspot,0),
      jumlahWilayah: list.length,
      // Rincian per kecamatan — dasar perhitungan totalHotspot di atas, dipakai
      // untuk menampilkan detail "titik panas ini datang dari kecamatan mana saja"
      rincian: list.map(w => ({ nama: w.nama, kecamatan: w.kecamatan, suhu: w.suhu, kelembapan: w.kelembapan, hotspot: w.hotspot }))
                   .sort((a,b) => b.hotspot - a.hotspot),
      signature: level + "|" + list.map(w=>w.kecamatan).sort().join(",") + "|" + list.reduce((s,w)=>s+w.hotspot,0)
    });
  });
  if(kelompok.Rendah.length){
    hasil.push({
      id: "PRG-AUTO-RENDAH",
      tingkat: "Rendah",
      wilayah: kelompok.Rendah.map(w => w.kecamatan).join(", "),
      pesan: pesanTemplate.Rendah,
      waktuUpdate: waktu,
      status: "Aktif",
      totalHotspot: kelompok.Rendah.reduce((s,w)=>s+w.hotspot,0),
      jumlahWilayah: kelompok.Rendah.length,
      rincian: kelompok.Rendah.map(w => ({ nama: w.nama, kecamatan: w.kecamatan, suhu: w.suhu, kelembapan: w.kelembapan, hotspot: w.hotspot }))
                              .sort((a,b) => b.hotspot - a.hotspot),
      signature: "Rendah|" + kelompok.Rendah.map(w=>w.kecamatan).sort().join(",") + "|" + kelompok.Rendah.reduce((s,w)=>s+w.hotspot,0)
    });
  }

  // Catat kapan tiap kondisi ini PERTAMA kali terdeteksi (lihat catatan di
  // atas fungsi ewsCatatKemunculanPeringatan) — otomatis masuk ke Riwayat
  // walau tidak pernah diklik "Tutup", dan waktunya tidak ikut maju tiap
  // halaman dibuka ulang selama kondisinya belum berubah.
  const pertamaTerdeteksi = ewsCatatKemunculanPeringatan(hasil);
  hasil.forEach(h => {
    h.pertamaTerdeteksiIso = pertamaTerdeteksi[h.tingkat] || null;
    h.pertamaTerdeteksi = h.pertamaTerdeteksiIso
      ? new Date(h.pertamaTerdeteksiIso).toLocaleString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) + " WIB"
      : null;
    h.waktu = h.pertamaTerdeteksi
      ? `Terdeteksi sejak ${h.pertamaTerdeteksi} · update terakhir ${h.waktuUpdate}`
      : "Update " + h.waktuUpdate;
  });

  // Sembunyikan peringatan yang sudah ditutup petugas, SELAMA kondisi datanya
  // belum berubah. Begitu data monitoring berubah (signature beda), peringatan
  // baru otomatis muncul lagi sebagai aktif.
  const ditutup = ewsGetPeringatanDitutup();
  return hasil.filter(h => ditutup[h.tingkat] !== h.signature);
}

/* =========================================================
   Menutup peringatan aktif
   Dipanggil dari halaman Peringatan saat petugas klik "Tutup".
   1. Menyimpan salinan peringatan ke arsip (localStorage) dengan
      status "Ditutup" agar tampil di tabel Riwayat Peringatan.
   2. Menyimpan "signature" kondisi saat ditutup, supaya peringatan
      dengan kondisi PERSIS SAMA tidak muncul lagi sebagai aktif —
      tapi begitu data Monitoring berubah, peringatan baru otomatis
      muncul kembali (karena signature-nya beda).
   ========================================================= */
const EWS_STORAGE_PERINGATAN_ARSIP = "ews_karhutla_peringatan_arsip";
const EWS_STORAGE_PERINGATAN_DITUTUP = "ews_karhutla_peringatan_ditutup";

function ewsGetPeringatanArsip(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_PERINGATAN_ARSIP)) || []; }
  catch(e){ return []; }
}

function ewsGetPeringatanDitutup(){
  try{ return JSON.parse(localStorage.getItem(EWS_STORAGE_PERINGATAN_DITUTUP)) || {}; }
  catch(e){ return {}; }
}

function ewsTutupPeringatan(entry){
  // 1) catat ke arsip/riwayat
  const arsip = ewsGetPeringatanArsip();
  arsip.unshift({
    id: "PRG-" + Date.now(),
    tingkat: entry.tingkat,
    wilayah: entry.wilayah,
    pesan: entry.pesan,
    waktu: entry.waktu,
    status: "Ditutup",
    ditutupOleh: (typeof ewsCurrentUser === "function" && ewsCurrentUser() && ewsCurrentUser().nama) || "Petugas BPBD",
    ditutupPada: new Date().toISOString(),
    waktuIso: new Date().toISOString() // dipakai untuk mengurutkan gabungan riwayat, lihat ewsSemuaArsipPeringatan()
  });
  localStorage.setItem(EWS_STORAGE_PERINGATAN_ARSIP, JSON.stringify(arsip));

  // 2) tandai signature kondisi ini sebagai "ditutup" untuk tingkat risiko tsb.
  const ditutup = ewsGetPeringatanDitutup();
  ditutup[entry.tingkat] = entry.signature;
  localStorage.setItem(EWS_STORAGE_PERINGATAN_DITUTUP, JSON.stringify(ditutup));
}

// Gabungan arsip contoh (DAFTAR_PERINGATAN yang berstatus Ditutup) + arsip hasil klik "Tutup"
// Riwayat eskalasi hasil pengecekan OTOMATIS (GitHub Actions) — lihat
// scripts/cek-status-karhutla.mjs (_meta.riwayatEskalasi). Beda dengan arsip
// "Ditutup" di atas (yang perlu diklik manual oleh petugas), daftar ini
// mencatat SETIAP momen suatu kecamatan naik ke Sedang/Tinggi yang pernah
// terdeteksi cek terjadwal, walau belakangan kondisinya sudah turun lagi ke
// Rendah sebelum sempat ada yang membuka/menutup peringatannya secara manual.
// Inilah yang membuat halaman Peringatan tidak lagi "stuck" terlihat cuma
// Rendah — histori naik-turunnya tetap terlihat di tabel Riwayat.
function ewsGetRiwayatEskalasiOtomatis(){
  const meta = EWS_STATUS_OTOMATIS_CACHE && EWS_STATUS_OTOMATIS_CACHE._meta;
  const daftar = (meta && Array.isArray(meta.riwayatEskalasi)) ? meta.riwayatEskalasi : [];
  return daftar.map((r, i) => ({
    id: "PRG-AUTO-" + i + "-" + (r.waktu || ""),
    tingkat: r.ke,
    wilayah: r.kecamatan,
    pesan: `Terdeteksi sistem otomatis: ${r.kecamatan} naik dari ${r.dari} ke ${r.ke} `
         + `(suhu ${r.suhu}°C, kelembapan ${r.kelembapan}%, ${r.hotspot} titik panas).`,
    waktu: r.waktu ? new Date(r.waktu).toLocaleString("id-ID", { day:"2-digit", month:"short", year:"numeric", hour:"2-digit", minute:"2-digit" }) + " WIB" : "-",
    waktuIso: r.waktu || "",
    status: r.notifikasiTerkirim ? "Terdeteksi otomatis (Telegram terkirim)" : "Terdeteksi otomatis"
  }));
}

function ewsSemuaArsipPeringatan(){
  const contoh = DAFTAR_PERINGATAN.filter(p => p.status === "Ditutup");
  const otomatisGithub = ewsGetRiwayatEskalasiOtomatis();
  const logKemunculan = ewsGetPeringatanLog(); // log "pertama terdeteksi" dari halaman ini sendiri (lihat ewsCatatKemunculanPeringatan)
  // Urutkan gabungan berdasarkan waktu terbaru dulu kalau tersedia (entri
  // otomatis punya waktuIso yang bisa dibandingkan); entri lama tanpa
  // waktuIso tetap ditampilkan mengikuti urutan aslinya di bagian bawah.
  return [...ewsGetPeringatanArsip(), ...logKemunculan, ...otomatisGithub, ...contoh]
    .sort((a, b) => (b.waktuIso || "").localeCompare(a.waktuIso || ""));
}
