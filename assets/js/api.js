/* =========================================================
   FIRESENTRY KARHUTLA - Integrasi API resmi
   Sumber: BMKG - Data Prakiraan Cuaca Terbuka
   https://data.bmkg.go.id/prakiraan-cuaca
   Dokumentasi endpoint:
   GET https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4={kode_wilayah}

   CATATAN:
   - Wajib mencantumkan BMKG sebagai sumber data (sudah ditampilkan
     pada elemen .source-note di setiap halaman yang memakai data ini).
   - Kode wilayah (adm4) pada EWS_CONFIG.bmkgAdm4 (assets/js/data.js)
     harus disesuaikan dengan kelurahan yang ingin dipantau. Daftar
     kode wilayah dapat dicari melalui portal wilayah.bmkg.go.id.
   - Jika permintaan gagal (offline, CORS pada environment tertentu,
     atau kode wilayah belum diisi), sistem otomatis memakai data
     contoh (CUACA_3HARI_FALLBACK) agar tampilan tetap dapat berjalan.
   ========================================================= */

async function fetchBmkgCuaca(adm4Code){
  const kode = adm4Code || EWS_CONFIG.bmkgAdm4;
  const url = `${EWS_CONFIG.bmkgEndpoint}?adm4=${encodeURIComponent(kode)}`;
  try{
    const res = await fetch(url, { method: "GET" });
    if(!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    return normalizeBmkgResponse(json);
  }catch(err){
    console.warn("[BMKG API] Tidak dapat mengambil data langsung, memakai data contoh.", err);
    return null; // pemanggil akan fallback ke CUACA_3HARI_FALLBACK
  }
}

/* Mengubah struktur respons BMKG (per-3-jam, 3 hari) menjadi
   ringkasan harian pagi/siang/malam yang dipakai tampilan.

   REVISI: sebelumnya hanya titik waktu SIANG (~12:00) yang diambil,
   sehingga kolom "Pagi" & "Malam" di tabel Detail Parameter Cuaca
   selalu kosong ("—") walau BMKG sebenarnya menyediakan data per 3
   jam sepanjang hari (termasuk titik pagi & malam). Sekarang ketiga
   titik waktu dicari dari data yang SAMA persis (bukan tebakan/data
   contoh) — dipilih titik yang JAMnya paling dekat ke target
   (06:00 pagi / 12:00 siang / 18:00 malam), supaya tetap akurat walau
   BMKG tidak selalu memberi titik persis di jam bulat tersebut. */
function ewsTitikCuacaTerdekat(hariArr, jamTarget){
  if(!hariArr.length) return null;
  let terdekat = hariArr[0], selisihMin = Infinity;
  hariArr.forEach(j => {
    const jam = parseInt((j.local_datetime || "").slice(11,13), 10);
    if(isNaN(jam)) return;
    const selisih = Math.abs(jam - jamTarget);
    if(selisih < selisihMin){ selisihMin = selisih; terdekat = j; }
  });
  return terdekat;
}

function normalizeBmkgResponse(json){
  try{
    const cuaca = json?.data?.[0]?.cuaca; // array of array (per hari)
    if(!cuaca) return null;
    const lokasi = json?.lokasi || json?.data?.[0]?.lokasi || {};
    const hasil = cuaca.slice(0,3).map((hariArr) => {
      const suhuArr = hariArr.map(j => j.t);
      const humArr = hariArr.map(j => j.hu);
      const titikPagi = ewsTitikCuacaTerdekat(hariArr, 6);
      const titikSiang = ewsTitikCuacaTerdekat(hariArr, 12);
      const titikMalam = ewsTitikCuacaTerdekat(hariArr, 18);
      return {
        tanggal: hariArr[0]?.local_datetime?.slice(0,10) || "-",
        suhuMin: Math.min(...suhuArr),
        suhuMax: Math.max(...suhuArr),
        kelembapanMin: Math.min(...humArr),
        kelembapanMax: Math.max(...humArr),
        cuacaPagi: titikPagi?.weather_desc || "-",
        cuacaSiang: titikSiang?.weather_desc || "-",
        cuacaMalam: titikMalam?.weather_desc || "-",
        angin: titikSiang ? `${titikSiang.ws} km/j - ${titikSiang.wd}` : "-"
      };
    });
    return { lokasi, harian: hasil };
  }catch(e){
    console.warn("[BMKG API] Format respons tidak sesuai dugaan.", e);
    return null;
  }
}

/* =========================================================
   Tren cuaca untuk grafik Dashboard ("Tren Kondisi Cuaca")
   ---------------------------------------------------------
   Berbeda dari fetchBmkgCuaca() di atas (yang meringkas jadi
   min/max per HARI untuk kartu prakiraan 3 hari), fungsi ini
   mengambil titik-titik data MENTAH per-3-jam dari respons BMKG
   yang sama, lalu memotongnya mulai dari titik paling dekat
   dengan waktu sekarang — supaya grafik tren selalu relevan
   dengan "sekarang", bukan berhenti di jam yang di-hardcode.
   ========================================================= */
const EWS_TREN_JUMLAH_TITIK_24JAM = 8; // 8 titik x 3 jam = 24 jam ke depan

async function ewsAmbilTrenCuacaBmkg(adm4Code, jumlahTitik){
  const kode = adm4Code || EWS_CONFIG.bmkgAdm4;
  const n = jumlahTitik || EWS_TREN_JUMLAH_TITIK_24JAM;
  try{
    const res = await fetch(`${EWS_CONFIG.bmkgEndpoint}?adm4=${encodeURIComponent(kode)}`);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    const cuaca = json?.data?.[0]?.cuaca; // array per hari, tiap hari array titik per-3-jam
    if(!cuaca) throw new Error("Format respons BMKG tidak sesuai dugaan");

    const flat = cuaca.flat().filter(j => j.local_datetime && typeof j.t === "number" && typeof j.hu === "number");
    flat.sort((a,b) => new Date(a.local_datetime.replace(" ","T")) - new Date(b.local_datetime.replace(" ","T")));

    const sekarang = Date.now();
    let idxMulai = flat.findIndex(j => new Date(j.local_datetime.replace(" ","T")).getTime() >= sekarang);
    if(idxMulai === -1) idxMulai = 0; // semua titik sudah lewat (jarang terjadi) → mulai dari awal yang tersedia

    const dipilih = flat.slice(idxMulai, idxMulai + n);
    if(dipilih.length === 0) throw new Error("Tidak ada titik prakiraan BMKG yang tersedia");

    return {
      sumber: "bmkg",
      label: dipilih.map(j => new Date(j.local_datetime.replace(" ","T")).toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"})),
      labelTanggal: dipilih.map(j => new Date(j.local_datetime.replace(" ","T")).toLocaleDateString("id-ID",{day:"2-digit",month:"short"})),
      suhu: dipilih.map(j => j.t),
      kelembapan: dipilih.map(j => j.hu),
      indeksPotensi: dipilih.map(j => ewsIndeksPotensiDariCuaca(j.t, j.hu)),
      waktuAmbil: new Date().toISOString()
    };
  }catch(err){
    console.warn("[BMKG API] Gagal mengambil tren cuaca, memakai data contoh.", err);
    return null; // pemanggil (dashboard.html) akan fallback ke ewsBuatTrenContohFallback()
  }
}

/* =========================================================
   Hotspot / titik panas
   Sumber resmi: SIPONGI+ (Kementerian Kehutanan) - tidak
   menyediakan API publik terbuka tanpa autentikasi, sehingga
   untuk integrasi real-time disarankan memakai:
   NASA FIRMS Area API (butuh MAP_KEY gratis dari firms.modaps.eosdis.nasa.gov)
   Contoh endpoint:
   https://firms.modaps.eosdis.nasa.gov/api/area/csv/{MAP_KEY}/VIIRS_SNPP_NRT/{west},{south},{east},{north}/1

   Fungsi di bawah ini disiapkan sebagai titik integrasi; jika
   MAP_KEY belum diisi, sistem memakai arsip kosong (lihat DATA_HOTSPOT di data.js).
   ========================================================= */
/* CATATAN: MAP_KEY diisi lagi di sini untuk keperluan testing LOKAL
   (repo ini belum pernah benar-benar di-push ke GitHub publik, jadi
   key ini belum pernah ke-expose). Situs ini statis tanpa backend,
   sedangkan fitur peta/tabel hotspot di dashboard butuh data live saat
   halaman dibuka di browser siapa pun (bukan cuma saat GitHub Actions
   jalan) — jadi key ini TIDAK bisa dipindah ke GitHub Secrets seperti
   token Telegram (Secrets cuma kebaca saat workflow jalan di server,
   bukan di browser client).

   PENTING SEBELUM PUSH KE GITHUB PUBLIK: kosongkan lagi baris
   FIRMS_MAP_KEY di bawah ini (jadi FIRMS_MAP_KEY = "") supaya key tidak
   ikut ter-commit. Kalau sampai kepush publik dengan key ini terisi,
   anggap key itu bocor dan generate key BARU di
   https://firms.modaps.eosdis.nasa.gov/api/map_key/ */
const FIRMS_MAP_KEY = ""; // API key NASA FIRMS — KOSONGKAN sebelum push ke GitHub

/* Rentang hari pencarian hotspot FIRMS (day_range pada endpoint area/csv).
   Bisa dipilih pengguna di halaman Data Hotspot / Monitoring (1 / 3 / 7 hari
   terakhir) supaya tabel tidak kosong hanya karena kebetulan tidak ada
   hotspot baru dalam 24 jam terakhir. Disimpan di localStorage supaya
   pilihan yang sama dipakai konsisten oleh kedua halaman & auto-sync. */
const EWS_STORAGE_HOTSPOT_RENTANG = "ews_karhutla_hotspot_rentang_hari";
const EWS_RENTANG_HOTSPOT_PILIHAN = [1, 3, 7, 30]; // nilai yang valid dipilih dari UI
const EWS_RENTANG_HOTSPOT_DEFAULT = 1;

function ewsGetRentangHariHotspot(){
  const v = parseInt(localStorage.getItem(EWS_STORAGE_HOTSPOT_RENTANG), 10);
  return EWS_RENTANG_HOTSPOT_PILIHAN.includes(v) ? v : EWS_RENTANG_HOTSPOT_DEFAULT;
}

function ewsSetRentangHariHotspot(n){
  const v = EWS_RENTANG_HOTSPOT_PILIHAN.includes(n) ? n : EWS_RENTANG_HOTSPOT_DEFAULT;
  localStorage.setItem(EWS_STORAGE_HOTSPOT_RENTANG, String(v));
}

// FIRMS Area API membatasi DAY_RANGE maksimal 5 hari per sekali panggilan
// (dikonfirmasi LANGSUNG dari dokumentasi resmi firms.modaps.eosdis.nasa.gov/api/area/
// per 20 Sep 2026: "DAY_RANGE: 1 .. 5 - number of days to query at one time").
// SEBELUMNYA nilai ini ditulis 10 berdasarkan asumsi/dokumentasi lama — itu
// PENYEBAB "Muat Riwayat Historis" selalu kosong: tiap potongan yang minta
// day_range 6-10 ditolak NASA (bukan CSV valid), jadi SEMUA potongan gagal
// kalau rentang riwayat yang dipilih lebih dari 5 hari. Supaya pilihan
// "7 hari", "sebulan (30 hari)", sampai backfill riwayat berbulan-bulan tetap
// bisa jalan, kita pecah jadi beberapa panggilan (maks 5 hari tiap panggilan)
// pakai parameter [DATE] eksplisit, lalu hasilnya digabung. Tanggal dihitung
// dalam GMT karena FIRMS mendasarkan tanggalnya pada GMT (bukan WIB).
const EWS_FIRMS_MAKS_DAY_RANGE = 5;

function ewsTanggalGmtMundur(hariMundur){
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - hariMundur);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD (GMT)
}

function ewsTunggu(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }

// Server FIRMS diketahui kadang timeout/504 sesaat khususnya untuk permintaan
// arsip berbulan-bulan (dikonfirmasi tim FIRMS sendiri di forum resminya:
// "temporary unexpected outage... due to website slowness" — bukan hanya
// kejadian di aplikasi ini). Supaya satu hiccup sesaat tidak membuat seluruh
// potongan tanggal itu dianggap gagal permanen, tiap potongan dicoba ulang
// beberapa kali dengan jeda sebelum benar-benar menyerah.
const EWS_FIRMS_MAKS_PERCOBAAN = 4;
const EWS_FIRMS_JEDA_RETRY_MS = 1500;
const EWS_FIRMS_JEDA_RETRY_MAKS_MS = 8000; // batas atas backoff per percobaan, supaya tidak menunggu terlalu lama di percobaan akhir

// Jeda antar-potongan (chunk 5-harian, lihat EWS_FIRMS_MAKS_DAY_RANGE di atas).
// SEBELUMNYA cuma 250ms rata untuk semua panjang rentang — untuk rentang
// panjang (mis. "1 tahun" = ~73 potongan) ini ternyata cukup untuk memicu
// server FIRMS menolak/memutus koneksi di tengah jalan (banyak potongan gagal
// jaringan sekaligus, bukan cuma 1-2 sesekali).
// Sekarang jedanya lebih longgar, dan ada jeda ekstra tiap beberapa potongan
// supaya beban ke server FIRMS lebih menyebar untuk permintaan arsip panjang.
const EWS_FIRMS_JEDA_ANTAR_POTONGAN_MS = 700;
const EWS_FIRMS_JEDA_EKSTRA_TIAP_N_POTONGAN = 5;
const EWS_FIRMS_JEDA_EKSTRA_MS = 2500;

// Satu putaran fetch untuk daftar potongan {tanggalAwal, ukuran} yang sudah
// dihitung sebelumnya — dipakai baik untuk putaran pertama maupun untuk
// putaran ULANG (lihat fetchFirmsRentang) yang hanya menyasar potongan yang
// gagal di putaran sebelumnya.
async function ewsFetchPotonganList(potonganList, sumber, box, progressCb){
  const semuaTitik = [];
  let berhasil = false;
  const diagnostik = [];
  for(let i = 0; i < potonganList.length; i++){
    const { tanggalAwal, ukuran } = potonganList[i];
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/${sumber}/${box}/${ukuran}/${tanggalAwal}`;

    let potonganBerhasil = false;
    let diagnostikTerakhir = null;
    for(let percobaan = 1; percobaan <= EWS_FIRMS_MAKS_PERCOBAAN && !potonganBerhasil; percobaan++){
      if(progressCb) progressCb(tanggalAwal, ukuran, percobaan);
      try{
        const res = await fetch(url);
        const csv = await res.text();
        // FIRMS mengembalikan teks error biasa berstatus 200 (bukan CSV) kalau
        // MAP_KEY tidak valid/kuota habis/sumber tidak dikenal — cek header CSV
        // asli supaya tidak ikut ter-parse sebagai data.
        if(res.ok && /^latitude,longitude/i.test(csv.trim())){
          semuaTitik.push(...parseFirmsCsv(csv));
          berhasil = true;
          potonganBerhasil = true;
        }else{
          diagnostikTerakhir = { tanggalAwal, ukuran, status: res.status, cuplikan: csv.trim().slice(0, 160), percobaan };
          console.warn("[FIRMS API] Respons tidak valid untuk potongan mulai", tanggalAwal, `(${ukuran} hari, sumber ${sumber}, percobaan ${percobaan}/${EWS_FIRMS_MAKS_PERCOBAAN})`, "status:", res.status, "isi:", csv.slice(0,160));
        }
      }catch(e){
        // "Failed to fetch" di sini biasanya hiccup jaringan/server sesaat
        // (termasuk yang sudah dikonfirmasi tim FIRMS sendiri terjadi di
        // sisi mereka untuk permintaan arsip panjang) — bukan otomatis
        // berarti MAP_KEY salah, jadi dicoba ulang dulu sebelum menyerah.
        diagnostikTerakhir = { tanggalAwal, ukuran, status: null, cuplikan: String(e && e.message || e), percobaan };
        console.warn("[FIRMS API] Gagal mengambil potongan mulai", tanggalAwal, `(${ukuran} hari, sumber ${sumber}, percobaan ${percobaan}/${EWS_FIRMS_MAKS_PERCOBAAN})`, e);
      }
      if(!potonganBerhasil && percobaan < EWS_FIRMS_MAKS_PERCOBAAN){
        const jeda = Math.min(EWS_FIRMS_JEDA_RETRY_MS * percobaan, EWS_FIRMS_JEDA_RETRY_MAKS_MS);
        await ewsTunggu(jeda); // jeda makin lama tiap percobaan (backoff), dibatasi biar tidak kelamaan
      }
    }
    if(!potonganBerhasil && diagnostikTerakhir) diagnostik.push(diagnostikTerakhir);

    // Jeda antar-potongan (bukan cuma saat retry) supaya tidak membombardir
    // server FIRMS dengan puluhan request beruntun tanpa jeda sama sekali —
    // salah satu dugaan penyebab 504/"Failed to fetch" sesaat pada request
    // arsip panjang. Tiap beberapa potongan dikasih jeda ekstra yang lebih
    // besar lagi supaya beban ke server lebih menyebar untuk rentang panjang.
    if(i < potonganList.length - 1){
      const jedaAntarPotongan = ((i + 1) % EWS_FIRMS_JEDA_EKSTRA_TIAP_N_POTONGAN === 0)
        ? EWS_FIRMS_JEDA_EKSTRA_MS
        : EWS_FIRMS_JEDA_ANTAR_POTONGAN_MS;
      await ewsTunggu(jedaAntarPotongan);
    }
  }
  return { titik: semuaTitik, berhasil, diagnostik };
}

// Menarik data FIRMS untuk rentang [mundurAwal .. mundurAwal+totalHari-1] hari
// yang lalu (dihitung mundur dari HARI INI), otomatis dipecah jadi beberapa
// panggilan kalau totalHari > EWS_FIRMS_MAKS_DAY_RANGE. `sumber` memilih dataset
// FIRMS: "VIIRS_SNPP_NRT" (Near Real-Time, ~mengcover ±2 bulan terakhir) dipakai
// untuk sinkron harian, sedangkan "VIIRS_SNPP_SP" (Standard Processing — data
// terverifikasi kualitas ilmiah, dipakai untuk ARSIP RIWAYAT yang sudah lewat)
// dipakai untuk memuat kejadian yang sudah benar-benar terjadi sebelumnya.
// Mengembalikan { titik, berhasil } — "berhasil" true kalau MINIMAL satu
// potongan berhasil dihubungi (supaya gagalnya satu potongan di tengah tidak
// membuat seluruh sinkronisasi dianggap gagal total).
//
// CATATAN PERBAIKAN: untuk rentang panjang (mis. "1 tahun" = puluhan potongan),
// beberapa potongan bisa gagal jaringan padahal potongan lain di request yang
// sama berhasil — biasanya karena beban permintaan beruntun ke server FIRMS.
// Supaya pengguna tidak perlu klik ulang manual, sekarang ada SATU putaran
// ulang otomatis KHUSUS untuk potongan yang gagal di putaran pertama, setelah
// jeda pendinginan — jadi hasil akhirnya jauh lebih lengkap tanpa menambah
// beban di potongan yang sudah berhasil.
async function fetchFirmsRentang(box, totalHari, mundurAwal, sumber, progressCb){
  mundurAwal = mundurAwal || 0;
  sumber = sumber || "VIIRS_SNPP_NRT";

  // Susun daftar potongan tanggal dulu (tanpa fetch) supaya bisa dipakai ulang
  // untuk putaran retry-khusus-yang-gagal di bawah.
  const potonganList = [];
  let sisa = totalHari;
  let mundurAkhir = mundurAwal;
  while(sisa > 0){
    const ukuran = Math.min(EWS_FIRMS_MAKS_DAY_RANGE, sisa);
    const mundurAwalPotongan = mundurAkhir + ukuran - 1;
    potonganList.push({ tanggalAwal: ewsTanggalGmtMundur(mundurAwalPotongan), ukuran });
    mundurAkhir += ukuran;
    sisa -= ukuran;
  }

  const putaran1 = await ewsFetchPotonganList(potonganList, sumber, box, progressCb);

  if(putaran1.diagnostik.length === 0){
    return { titik: putaran1.titik, berhasil: putaran1.berhasil, diagnostik: putaran1.diagnostik };
  }

  // Ada potongan yang gagal — beri jeda pendinginan lalu coba ulang HANYA
  // potongan yang gagal itu (bukan seluruh rentang, biar hemat & cepat).
  if(progressCb) progressCb(null, null, "cooldown");
  await ewsTunggu(4000);
  const potonganGagalUlang = putaran1.diagnostik.map(d => ({ tanggalAwal: d.tanggalAwal, ukuran: d.ukuran }));
  const putaran2 = await ewsFetchPotonganList(potonganGagalUlang, sumber, box, progressCb);

  return {
    titik: [...putaran1.titik, ...putaran2.titik],
    berhasil: putaran1.berhasil || putaran2.berhasil,
    diagnostik: putaran2.diagnostik // hanya yang masih gagal setelah putaran ulang kedua
  };
}

async function fetchFirmsHotspot(bbox, hariRentang){
  if(!FIRMS_MAP_KEY) return null;
  const box = bbox || "101.30,0.40,101.60,0.70";
  const rentang = EWS_RENTANG_HOTSPOT_PILIHAN.includes(hariRentang) ? hariRentang : EWS_RENTANG_HOTSPOT_DEFAULT;
  const sumber = ["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT"];
  const gabungan=[]; let adaYangBerhasil=false;
  for(const sensor of sumber){
    try{
      const h=await fetchFirmsRentang(box,rentang,0,sensor);
      if(h.berhasil){gabungan.push(...h.titik); adaYangBerhasil=true;}
    }catch(e){ console.warn(`[FIRMS] ${sensor} gagal`,e); }
  }
  return adaYangBerhasil ? ewsDedupeHotspot(gabungan) : null;
}

/* ---------------------------------------------------------------------
   Batas akhir data VIIRS_SNPP_SP (dicek otomatis ke NASA, bukan ditebak)
   ---------------------------------------------------------------------
   NASA mengonfirmasi di forum resminya: "Standard Processing (SP)
   datasets are and will be behind at least 3 months or more" — lag-nya
   TIDAK tetap 60 hari seperti yang tadinya diasumsikan di sini, dan bisa
   berubah-ubah (pernah lebih dari setahun saat ada gangguan pemrosesan).
   Supaya request tidak lagi menebak angka lag secara hardcode, fungsi ini
   menanyakan LANGSUNG ke endpoint resmi data_availability kapan data SP
   VIIRS_SNPP terbaru benar-benar tersedia, lalu itu yang dipakai sebagai
   titik mulai. Hasilnya di-cache 12 jam di localStorage supaya tidak
   memanggil API ini berulang-ulang tiap kali tombol riwayat ditekan.
   ------------------------------------------------------------------ */
const EWS_STORAGE_SP_BATAS = "ews_karhutla_sp_batas_akhir_cache";
const EWS_SP_CACHE_MS = 12 * 60 * 60 * 1000; // 12 jam
const EWS_SP_FALLBACK_MUNDUR = 90; // dipakai HANYA kalau data_availability gagal dihubungi (mengikuti angka minimum resmi NASA: "at least 3 months or more")

async function ewsAmbilMundurAwalSP(){
  try{
    const cache = JSON.parse(localStorage.getItem(EWS_STORAGE_SP_BATAS));
    if(cache && (Date.now() - cache.waktuCek) < EWS_SP_CACHE_MS && Number.isFinite(cache.mundurAwal)){
      return cache.mundurAwal;
    }
  }catch(e){ /* cache rusak/kosong, lanjut cek ulang ke NASA */ }

  let mundurAwal = EWS_SP_FALLBACK_MUNDUR;
  try{
    const url = `https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/${FIRMS_MAP_KEY}/VIIRS_SNPP_SP`;
    const res = await fetch(url);
    const csv = await res.text();
    const baris = parseFirmsCsv(csv); // format tabel: header + baris, fungsi ini generik untuk CSV apa pun
    // Cari kolom yang isinya tanggal (YYYY-MM-DD), ambil yang PALING BARU di seluruh tabel
    // — tanpa mengasumsikan nama kolom persis, supaya tahan kalau format NASA sedikit berubah.
    let tanggalTerbaru = null;
    baris.forEach(row => {
      Object.values(row).forEach(v => {
        if(/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim())){
          if(!tanggalTerbaru || v > tanggalTerbaru) tanggalTerbaru = v;
        }
      });
    });
    if(tanggalTerbaru){
      const selisihMs = Date.now() - new Date(tanggalTerbaru + "T00:00:00Z").getTime();
      const selisihHari = Math.floor(selisihMs / 86400000);
      if(selisihHari > 0) mundurAwal = selisihHari;
    }
  }catch(e){
    console.warn("[FIRMS API] Gagal mengecek data_availability, pakai fallback", EWS_SP_FALLBACK_MUNDUR, "hari:", e);
  }

  try{
    localStorage.setItem(EWS_STORAGE_SP_BATAS, JSON.stringify({ mundurAwal, waktuCek: Date.now() }));
  }catch(e){ /* localStorage penuh/tidak tersedia, abaikan — tetap jalan tanpa cache */ }
  return mundurAwal;
}

/* ---------------------------------------------------------------------
   ARSIP RIWAYAT (data yang SUDAH BENAR-BENAR TERJADI sebelumnya)
   ---------------------------------------------------------------------
   Beda dengan fetchFirmsHotspot() di atas (yang hanya menarik hotspot
   "hari ini"/"N hari terakhir" secara live), fungsi ini dipakai tombol
   "Muat Riwayat Historis" di halaman Data Hotspot untuk mengisi arsip
   dengan kejadian NYATA di masa lalu — bukan rekaan — langsung dari
   produk arsip resmi NASA FIRMS (VIIRS_SNPP_SP, Standard Processing).
   Titik mulai mundurnya TIDAK lagi dihardcode 60 hari (lihat catatan di
   ewsAmbilMundurAwalSP di atas) — dicek dulu ke NASA kapan data SP
   terbaru betul-betul tersedia.
   ------------------------------------------------------------------ */
async function ewsMuatRiwayatHistorisFirms(box, totalHariRiwayat, progressCb){
  box = box || "101.30,0.40,101.60,0.70";
  const mundurAwalSP = await ewsAmbilMundurAwalSP();
  const { titik, berhasil, diagnostik } = await fetchFirmsRentang(
    box, totalHariRiwayat, mundurAwalSP, "VIIRS_SNPP_SP",
    (tanggal, ukuran) => { if(progressCb) progressCb(tanggal, ukuran); }
  );
  if(!berhasil) return { jumlahBaru: 0, berhasil: false, diagnostik, mundurAwalSP };
  const record = ewsBuatDetailHotspotDariFirms(titik);
  const sebelumId = new Set();
  try{
    const arsipLama = JSON.parse(localStorage.getItem(EWS_STORAGE_HOTSPOT_ARSIP)) || [];
    arsipLama.forEach(r => sebelumId.add(r.id));
  }catch(e){ /* abaikan, anggap arsip kosong */ }
  ewsSimpanArsipHotspot(record);
  const jumlahBaru = record.filter(r => !sebelumId.has(r.id)).length;
  // PENTING: walau berhasil=true, sebagian potongan tanggal di tengah rentang
  // bisa saja tetap gagal (mis. gangguan jaringan sesaat) — dulu ini disembunyikan
  // diam-diam sehingga jumlah titik yang tampil ke pengguna terlihat "lengkap"
  // padahal tidak. Sekarang statusnya dikembalikan supaya UI bisa memberi tahu.
  const sebagianGagal = diagnostik && diagnostik.length > 0;
  return { jumlahBaru, jumlahDitemukan: record.length, berhasil: true, sebagianGagal, diagnostik, mundurAwalSP };
}

function parseFirmsCsv(csv){
  const rows = csv.trim().split("\n");
  const headers = rows[0].split(",");
  return rows.slice(1).map(r => {
    const cols = r.split(",");
    const obj = {};
    headers.forEach((h,i) => obj[h.trim()] = cols[i]);
    return obj;
  });
}

/* =========================================================
   SINKRONISASI REAL-TIME → Monitoring Karhutla
   Inilah fungsi utama yang menjawab: "datanya dari mana?"

   1. Suhu & kelembapan per kecamatan → ditarik LANGSUNG dari
      BMKG (api.bmkg.go.id) untuk kelurahan wakil tiap kecamatan
      (lihat KECAMATAN_ADM4 di data.js), diambil titik data
      terdekat dengan waktu sekarang (bukan rata-rata 3 hari).
   2. Titik panas per kecamatan → ditarik LANGSUNG dari NASA FIRMS
      (data satelit VIIRS/MODIS, sumber yang sama dipakai SIPONGI),
      lalu setiap titik dikelompokkan ke kecamatan terdekat
      berdasarkan koordinat.
   3. Hasilnya disimpan lewat ewsSimpanUpdateMonitoring() — fungsi
      yang SAMA dipakai saat petugas update manual — sehingga
      otomatis mengalir ke Peringatan, Peta, dan Dashboard tanpa
      kode tambahan di halaman lain.

   CATATAN PENTING soal "selalu update tiap hari":
   Karena ini website statis (tanpa server backend), sinkronisasi
   hanya berjalan ketika ada yang MEMBUKA halaman Monitoring (baik
   otomatis saat halaman dibuka, atau lewat tombol "Sinkronkan").
   Untuk auto-update di background 24/7 tanpa perlu ada yang buka
   browser, dibutuhkan server terjadwal (cron job) — di luar
   cakupan website statis ini. Lihat README bagian "Sinkronisasi
   Real-time" untuk opsi lanjutannya.
   ========================================================= */

// Mengambil titik data cuaca BMKG yang PALING DEKAT dengan waktu sekarang
// (bukan rata-rata harian) — dipakai untuk merepresentasikan "kondisi saat ini".
function ewsAmbilCuacaTerkini(bmkgJson){
  try{
    const cuaca = bmkgJson?.data?.[0]?.cuaca;
    if(!cuaca) return null;
    const flat = cuaca.flat();
    const now = Date.now();
    let terdekat = null, selisihMin = Infinity;
    flat.forEach(item => {
      const t = new Date((item.local_datetime||"").replace(" ","T")).getTime();
      if(isNaN(t)) return;
      const selisih = Math.abs(now - t);
      if(selisih < selisihMin){ selisihMin = selisih; terdekat = item; }
    });
    if(!terdekat) return null;
    return { suhu: terdekat.t, kelembapan: terdekat.hu, waktu: terdekat.local_datetime, cuaca: terdekat.weather_desc };
  }catch(e){
    console.warn("[BMKG API] Gagal membaca titik cuaca terkini.", e);
    return null;
  }
}

// Mengelompokkan titik panas FIRMS ke kecamatan terdekat (berdasarkan jarak koordinat)
function ewsPointInRing(lng, lat, ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const intersect=((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi+Number.EPSILON)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function ewsPointInPolygon(lng,lat,poly){
  if(!poly?.length || !ewsPointInRing(lng,lat,poly[0])) return false;
  for(let i=1;i<poly.length;i++) if(ewsPointInRing(lng,lat,poly[i])) return false;
  return true;
}
function ewsPointInGeometry(lng,lat,g){
  if(!g) return false;
  if(g.type==="Polygon") return ewsPointInPolygon(lng,lat,g.coordinates);
  if(g.type==="MultiPolygon") return g.coordinates.some(p=>ewsPointInPolygon(lng,lat,p));
  return false;
}
function ewsConfidenceScore(raw){
  const v=String(raw??"").trim().toLowerCase();
  if(v==="h") return 3; if(v==="n") return 2; if(v==="l") return 1;
  const n=Number(raw); return Number.isFinite(n) ? (n>=80?3:n>=50?2:1) : 0;
}
function ewsKecamatanDariTitikHotspot(p){
  const lat=Number(p.latitude), lng=Number(p.longitude);
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) return null;
  if(typeof BATAS_KECAMATAN_PEKANBARU!=="undefined"){
    const features=BATAS_KECAMATAN_PEKANBARU.features || [];
    // Filter dulu ke bentang Kota Pekanbaru supaya box FIRMS yang diperlebar
    // tidak memasukkan titik dari kabupaten tetangga.
    const diKota=features.some(x=>ewsPointInGeometry(lng,lat,x.geometry));
    if(!diKota) return null;
    // Poligon Rumbai/Tenayan yang ada di repo masih batas sebelum pemekaran;
    // jangan dipakai untuk mengklaim klasifikasi presisi di Rumbai Timur/Kulim.
    const f=features.find(x=>{
      const k=x.properties?.kecamatan;
      if(k === "Rumbai" || k === "Tenayan Raya") return false;
      return ewsPointInGeometry(lng,lat,x.geometry);
    });
    if(f?.properties?.kecamatan) return f.properties.kecamatan;
  }
  // Fallback untuk wilayah pemekaran yang belum punya poligon presisi di repo.
  let terdekat=null, jarakMin=Infinity;
  WILAYAH_RISIKO.forEach(w=>{ const jarak=Math.hypot(lat-w.lat,lng-w.lng); if(jarak<jarakMin){jarakMin=jarak;terdekat=w.kecamatan;} });
  return terdekat;
}
function ewsDedupeHotspot(points){
  const seen=new Map();
  points.forEach(p=>{
    const lat=Number(p.latitude),lng=Number(p.longitude); if(!Number.isFinite(lat)||!Number.isFinite(lng)) return;
    const key=[Math.round(lat*1000),Math.round(lng*1000),p.acq_date||"",p.acq_time||""].join("|");
    const old=seen.get(key);
    if(!old || ewsConfidenceScore(p.confidence)>ewsConfidenceScore(old.confidence)) seen.set(key,p);
  });
  return [...seen.values()];
}
function ewsKelompokkanHotspotKeKecamatan(points){
  const hasil={};
  points.forEach(p=>{
    if(ewsConfidenceScore(p.confidence)<2) return; // EWS hanya memakai nominal/high confidence
    const kec=ewsKecamatanDariTitikHotspot(p);
    if(kec) hasil[kec]=(hasil[kec]||0)+1;
  });
  return hasil;
}

/* =========================================================
   ARSIP DETAIL TITIK PANAS (dipakai halaman Data Hotspot)
   ---------------------------------------------------------
   ewsKelompokkanHotspotKeKecamatan() di atas cuma menghasilkan
   JUMLAH per kecamatan (dipakai Monitoring). Halaman Data Hotspot
   butuh detail PER TITIK (koordinat, jam deteksi, satelit,
   confidence) — makanya dipisah jadi fungsi sendiri di bawah,
   memakai data mentah FIRMS yang sama persis (tidak menambah
   panggilan API baru).
   ========================================================= */

// VIIRS NRT melaporkan confidence sebagai kategori huruf (l/n/h), MODIS
// sebagai angka 0-100. Fungsi ini menangani keduanya jadi label + persen
// yang konsisten dengan tampilan tabel (kolom Confidence & Tingkat Keyakinan).
function ewsNormalisasiConfidenceFirms(raw){
  const angka = parseFloat(raw);
  if(!isNaN(angka) && String(raw).trim() !== ""){
    // Produk berbasis MODIS: confidence sudah dalam bentuk persen asli
    const label = angka >= 80 ? "Tinggi" : angka >= 50 ? "Sedang" : "Rendah";
    return { label, persen: Math.round(angka) };
  }
  // Produk berbasis VIIRS: confidence kategorikal (h = high, n = nominal, l = low).
  // Belum ada angka persen resmi dari FIRMS untuk kategori ini — nilai di bawah
  // adalah representasi kasar per kategori supaya kolom "Tingkat Keyakinan"
  // tetap bisa ditampilkan secara konsisten dengan produk MODIS.
  const k = String(raw).trim().toLowerCase();
  if(k === "h") return { label: "Tinggi", persen: 85 };
  if(k === "n") return { label: "Sedang", persen: 55 };
  return { label: "Rendah", persen: 25 };
}

function ewsNamaSatelitFirms(p){
  // Endpoint yang dipakai saat ini (VIIRS_SNPP_NRT) selalu berasal dari
  // satelit Suomi NPP. Jika suatu saat endpoint ditambah (mis. gabung
  // VIIRS_NOAA20_NRT / MODIS_NRT), sesuaikan pemetaan di sini.
  const instrumen = (p.instrument || "VIIRS").toUpperCase();
  return `SNPP (${instrumen})`;
}

// Mengubah baris mentah FIRMS jadi record arsip siap-tampil (mengikuti bentuk
// yang sama dengan bentuk DATA_HOTSPOT di data.js), sekaligus menandai
// kecamatan terdekat — supaya bisa langsung dipakai tabel Data Hotspot.
function ewsBuatDetailHotspotDariFirms(points){
  return points.map(p => {
    const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
    if(isNaN(lat) || isNaN(lng)) return null;

    let terdekat = null, jarakMin = Infinity;
    WILAYAH_RISIKO.forEach(w => {
      const jarak = Math.hypot(lat - w.lat, lng - w.lng);
      if(jarak < jarakMin){ jarakMin = jarak; terdekat = w.kecamatan; }
    });

    const { label: confidence, persen } = ewsNormalisasiConfidenceFirms(p.confidence);
    const tanggal = p.acq_date || new Date().toISOString().slice(0,10);
    const jamMentah = (p.acq_time || "0000").padStart(4, "0");
    const jam = `${jamMentah.slice(0,2)}:${jamMentah.slice(2,4)} UTC`;

    return {
      id: `HS-${tanggal.replace(/-/g,"").slice(2)}-${lat.toFixed(3)}-${lng.toFixed(3)}`, // unik per titik+tanggal, dipakai untuk dedupe
      tanggal, jam,
      kecamatan: terdekat || "-",
      lat, lng,
      satelit: ewsNamaSatelitFirms(p),
      confidence, persen
    };
  }).filter(Boolean);
}

const EWS_STORAGE_HOTSPOT_ARSIP = "ews_karhutla_arsip_hotspot_firms";
// Dinaikkan dari 35 → 400 hari supaya arsip RIWAYAT HISTORIS (dimuat lewat
// ewsMuatRiwayatHistorisFirms(), bisa sampai 1 tahun ke belakang) tidak
// langsung terbuang oleh pembersihan otomatis ini. Data yang lebih baru
// dari sinkron harian (NRT) tetap masuk & tersaring sama seperti sebelumnya.
const EWS_ARSIP_HOTSPOT_MAKS_HARI = 450; // cukup untuk backfill "1 tahun terakhir" (60 hari offset SP + 365 hari) + buffer

// Penanda terpisah: "FIRMS pernah berhasil dihubungi minimal sekali", TERLEPAS
// dari apakah hasilnya 0 titik atau lebih. Tanpa ini, hari dengan 0 titik panas
// (hal yang WAJAR dan justru kabar baik — bukan error) akan salah dibaca sebagai
// "belum pernah sync" dan tabel jatuh balik ke data contoh tanggal lama, padahal
// sinkronisasi sebenarnya sudah berhasil.
const EWS_STORAGE_HOTSPOT_PERNAH_REAL = "ews_karhutla_hotspot_pernah_real";

// Menyimpan hasil sinkron FIRMS terbaru ke arsip lokal, digabung dengan arsip
// lama (dedupe berdasarkan id), lalu dibuang yang lebih tua dari batas di atas.
// Dipanggil setiap kali FIRMS berhasil dihubungi, walau recordBaru kosong (0 titik),
// supaya penanda "pernah real" di atas selalu ikut ter-set.
function ewsSimpanArsipHotspot(recordBaru){
  let arsip = [];
  try{ arsip = JSON.parse(localStorage.getItem(EWS_STORAGE_HOTSPOT_ARSIP)) || []; }catch(e){ arsip = []; }

  const petaId = new Map(arsip.map(r => [r.id, r]));
  recordBaru.forEach(r => petaId.set(r.id, r));

  const batasWaktu = Date.now() - EWS_ARSIP_HOTSPOT_MAKS_HARI * 24 * 60 * 60 * 1000;
  const hasil = [...petaId.values()]
    .filter(r => new Date(r.tanggal).getTime() >= batasWaktu)
    .sort((a,b) => (b.tanggal + b.jam).localeCompare(a.tanggal + a.jam));

  localStorage.setItem(EWS_STORAGE_HOTSPOT_ARSIP, JSON.stringify(hasil));
  localStorage.setItem(EWS_STORAGE_HOTSPOT_PERNAH_REAL, "1");
  return hasil;
}

// Dipakai halaman Data Hotspot. Mengembalikan null HANYA kalau belum pernah ada
// sinkronisasi FIRMS yang berhasil sama sekali (supaya halaman tahu harus
// fallback ke DATA_HOTSPOT (kosong secara sengaja) di data.js). Kalau sudah pernah berhasil tapi
// arsip 14 hari terakhir kebetulan kosong (0 titik panas terdeteksi), fungsi ini
// tetap mengembalikan array kosong — BUKAN null — supaya tabel menampilkan
// "0 titik terdeteksi" yang jujur, bukan malah balik ke data contoh lama.
function ewsGetArsipHotspot(){
  const pernahReal = localStorage.getItem(EWS_STORAGE_HOTSPOT_PERNAH_REAL) === "1";
  if(!pernahReal) return null;
  try{
    const arsip = JSON.parse(localStorage.getItem(EWS_STORAGE_HOTSPOT_ARSIP));
    return Array.isArray(arsip) ? arsip : [];
  }catch(e){
    return [];
  }
}

/* =========================================================
   Kualitas udara (PM2.5 / AQI) — World Air Quality Index (WAQI)
   Sumber resmi: https://api.waqi.info (lihat WAQI_CONFIG di data.js
   untuk penjelasan lengkap & cara mengisi token gratis).
   Endpoint: GET https://api.waqi.info/feed/{kota}/?token={token}
   Dokumentasi: https://aqicn.org/json-api/doc/

   Sama seperti BMKG/FIRMS di atas: kalau token belum diisi atau
   permintaan gagal, sistem otomatis memakai DASHBOARD_SUMMARY.pm25
   (data contoh) di data.js supaya tampilan tetap berjalan.
   ========================================================= */
async function fetchWaqiPekanbaru(){
  if(!WAQI_CONFIG.token){
    console.warn("[WAQI API] Token belum diisi (WAQI_CONFIG.token di data.js) — memakai data contoh.");
    return null;
  }
  try{
    const url = `https://api.waqi.info/feed/${encodeURIComponent(WAQI_CONFIG.kota)}/?token=${encodeURIComponent(WAQI_CONFIG.token)}`;
    const res = await fetch(url);
    if(!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if(json.status !== "ok" || !json.data) throw new Error("Status WAQI: " + json.status);
    return normalizeWaqiResponse(json.data);
  }catch(err){
    console.warn("[WAQI API] Tidak dapat mengambil data kualitas udara, memakai data contoh.", err);
    return null;
  }
}

/* Mengubah struktur respons WAQI (city feed) menjadi ringkasan yang
   dipakai kartu PM2.5/AQI di Dashboard. `aqi` di respons WAQI sudah
   dalam skala AQI EPA (AQI+ US) 0–500. `iaqi.pm25.v` adalah
   konsentrasi PM2.5 (µg/m³), bukan angka AQI; karena itu FireSentry
   menghitung kembali AQI PM2.5 dengan breakpoint EPA agar konsentrasi
   dan kategori pada kartu konsisten dengan skala AQI+ US yang dipakai
   IQAir. Nilai AQI WAQI asli tetap disimpan sebagai `aqiWaqi` untuk audit. */
function normalizeWaqiResponse(data){
  try{
    const aqiWaqi = typeof data.aqi === "number" ? data.aqi : parseFloat(data.aqi);
    const pm25 = Number(data.iaqi?.pm25?.v);
    if(!Number.isFinite(aqiWaqi) && !Number.isFinite(pm25)) return null;

    // Untuk kartu PM2.5, gunakan konsentrasi PM2.5 yang benar-benar
    // diberikan feed. AQI utama dihitung dari PM2.5 dengan breakpoint EPA
    // agar hubungan angka konsentrasi ↔ AQI konsisten dengan AQI+ US yang
    // ditampilkan IQAir. Jika PM2.5 tidak tersedia, baru pakai AQI WAQI.
    const aqi = Number.isFinite(pm25) && typeof ewsAqiDariPm25 === "function"
      ? ewsAqiDariPm25(pm25)
      : aqiWaqi;
    const kategori = ewsKategoriAqi(aqi);
    return {
      aqi,
      aqiWaqi: Number.isFinite(aqiWaqi) ? aqiWaqi : null,
      pm25: Number.isFinite(pm25) ? pm25 : null,
      pm25Status: kategori.label,
      kelasStatus: kategori.kelas,
      panah: kategori.panah,
      stasiun: data.city?.name || "Pekanbaru",
      dominan: data.dominentpol || (Number.isFinite(pm25) ? "p2" : null),
      waktuUkur: data.time?.iso || null,
      waktuAmbil: new Date().toISOString(),
      sumber: "WAQI + breakpoint US EPA (AQI+ US)"
    };
  }catch(e){
    console.warn("[WAQI API] Format respons tidak sesuai dugaan.", e);
    return null;
  }
}

const EWS_STORAGE_PM25_TERAKHIR = "ews_karhutla_pm25_terakhir";

/* Menyinkronkan kartu PM2.5/AQI Dashboard ke data WAQI real-time.
   Dipanggil dari ewsSinkronMonitoringRealtime() (tombol "Sinkronkan
   Sekarang" & auto-sync) supaya PM2.5 ikut ter-refresh bersamaan
   dengan BMKG/FIRMS, tanpa perlu logika sinkronisasi terpisah. */
async function ewsSinkronKualitasUdara(){
  const hasil = await fetchWaqiPekanbaru();
  if(!hasil) return false; // gagal/token kosong → biarkan nilai lama (atau fallback) apa adanya
  localStorage.setItem(EWS_STORAGE_PM25_TERAKHIR, JSON.stringify(hasil));
  return true;
}

/* Dipakai dashboard.html. Mengembalikan null kalau belum pernah ada
   sinkronisasi WAQI yang berhasil sama sekali (supaya halaman tahu
   harus fallback ke DASHBOARD_SUMMARY contoh di data.js). */
function ewsGetKualitasUdaraTerkini(){
  try{
    const raw = localStorage.getItem(EWS_STORAGE_PM25_TERAKHIR);
    return raw ? JSON.parse(raw) : null;
  }catch(e){
    return null;
  }
}

/* ---------------------------------------------------------------------
   Auto-refresh PM2.5/AQI TERPISAH dari sync BMKG+FIRMS yang berat
   ---------------------------------------------------------------------
   ewsAutoSyncMonitoringJikaPerlu() (BMKG per-kecamatan + FIRMS) sengaja
   hanya jalan tiap 12 jam supaya tidak membombardir BMKG/FIRMS — itu
   sudah benar untuk data cuaca/hotspot per kecamatan. TAPI PM2.5/AQI
   cuma 1 kali panggilan API yang ringan ke WAQI, jadi tidak perlu ikut
   nunggu 12 jam itu. Dipanggil lewat setInterval di dashboard.html
   supaya kartu PM2.5 ikut segar tanpa perlu reload halaman.
   ------------------------------------------------------------------ */
const EWS_PM25_AUTO_INTERVAL_MS = 15 * 60 * 1000; // 15 menit — aman untuk kuota token gratis WAQI (~1000 request/hari)

async function ewsAutoSyncPm25JikaPerlu(){
  const terakhir = ewsGetKualitasUdaraTerkini();
  const waktuAmbil = terakhir?.waktuAmbil ? new Date(terakhir.waktuAmbil).getTime() : 0;
  const perluSync = !waktuAmbil || (Date.now() - waktuAmbil) > EWS_PM25_AUTO_INTERVAL_MS;
  if(!perluSync) return false;
  return await ewsSinkronKualitasUdara();
}

const EWS_STORAGE_SYNC_TIME = "ews_karhutla_sync_terakhir";

function ewsWaktuSyncTerakhir(){
  return localStorage.getItem(EWS_STORAGE_SYNC_TIME);
}

/**
 * Menyinkronkan seluruh data Monitoring dari sumber resmi (BMKG + FIRMS).
 * @param {function} onProgress - dipanggil setiap 1 kecamatan selesai diproses (nama kecamatan)
 * @param {number} [hariRentang] - rentang hari pencarian hotspot FIRMS (1/3/7/30). Default: preferensi tersimpan (ewsGetRentangHariHotspot()).
 * @returns {Promise<{jumlahTersinkron:number, totalWilayah:number, firmsAktif:boolean, hariRentang:number}>}
 */
async function ewsSinkronMonitoringRealtime(onProgress, hariRentang){
  const rentang = EWS_RENTANG_HOTSPOT_PILIHAN.includes(hariRentang) ? hariRentang : ewsGetRentangHariHotspot();
  const daftarKecamatan = [...new Set(WILAYAH_RISIKO.map(w => w.kecamatan))];
  const cuacaPerKecamatan = {};

  for(const kec of daftarKecamatan){
    const adm4 = ewsAdm4UntukKecamatan(kec);
    try{
      const res = await fetch(`${EWS_CONFIG.bmkgEndpoint}?adm4=${encodeURIComponent(adm4)}`);
      if(res.ok){
        const json = await res.json();
        const terkini = ewsAmbilCuacaTerkini(json);
        if(terkini) cuacaPerKecamatan[kec] = terkini;
      }
    }catch(e){
      console.warn("[Sinkron] Gagal ambil cuaca BMKG untuk", kec, e);
    }
    if(onProgress) onProgress(kec);
  }

  // Titik panas real-time dari NASA FIRMS (aktif hanya jika FIRMS_MAP_KEY sudah diisi).
  // Dipecah otomatis kalau rentang > 5 hari (lihat fetchFirmsRentang) karena itu
  // batas maksimal day_range dari FIRMS Area API per sekali panggilan.
  let firmsPoints = [];
  let firmsAktif = false;
  if(FIRMS_MAP_KEY){
    const box = "101.30,0.40,101.60,0.70";
    const sumber = ["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT"];
    const gabungan=[];
    for(const sensor of sumber){
      try{
        const hasilFirms = await fetchFirmsRentang(box, rentang, 0, sensor);
        if(hasilFirms.berhasil) gabungan.push(...hasilFirms.titik);
      }catch(e){ console.warn(`[Sinkron FIRMS] ${sensor} gagal`, e); }
    }
    firmsPoints = ewsDedupeHotspot(gabungan);
    firmsAktif = firmsPoints.length > 0 || gabungan.length === 0;
  }
  const hotspotPerKecamatan = firmsAktif ? ewsKelompokkanHotspotKeKecamatan(firmsPoints) : {};

  // Simpan juga versi DETAIL per titik (dipakai halaman Data Hotspot) —
  // sumbernya persis sama dengan yang dipakai untuk hitung jumlah di atas,
  // jadi kedua halaman (Monitoring & Data Hotspot) selalu konsisten satu sama lain.
  // PENTING: tetap dipanggil walau firmsPoints kosong (array []), supaya penanda
  // "pernah real" ikut ter-set — 0 titik panas terdeteksi itu hasil FIRMS yang sah
  // (tidak ada hotspot aktif saat ini), bukan tanda sinkronisasi gagal.
  if(firmsAktif){
    ewsSimpanArsipHotspot(ewsBuatDetailHotspotDariFirms(firmsPoints));
  }

  // Kualitas udara (PM2.5/AQI) dari WAQI — disinkronkan bersamaan supaya
  // kartu Dashboard selalu sesegar BMKG/FIRMS. Tidak menggagalkan sinkron
  // keseluruhan kalau WAQI gagal/token kosong (lihat ewsSinkronKualitasUdara()).
  const pm25Aktif = await ewsSinkronKualitasUdara();

  let jumlahTersinkron = 0;
  daftarKecamatan.forEach(kec => {
    const cuaca = cuacaPerKecamatan[kec];
    if(!cuaca) return; // BMKG gagal untuk kecamatan ini → biarkan data sebelumnya, jangan ditimpa

    const dasar = WILAYAH_RISIKO.find(w => w.kecamatan === kec) || {};
    const overrideLama = ewsGetMonitoringOverride()[kec];

    // Jika kecamatan ini BELUM punya kode kelurahan sendiri (masih memakai kode
    // kota sebagai wakil sementara), suhu/kelembapan mentahnya akan sama persis
    // dengan kecamatan lain yang juga belum dipetakan. Supaya perbedaan relatif
    // antar kecamatan (yang sebelumnya masuk akal secara geografis) tidak hilang,
    // kita tambahkan selisih dari data dasar terhadap kecamatan acuan (Pekanbaru
    // Kota) — jadi angkanya tetap berbasis data BMKG asli, hanya disesuaikan
    // proporsinya. Begitu KECAMATAN_ADM4 diisi kode kelurahan sendiri, penyesuaian
    // ini otomatis tidak lagi dipakai (karena datanya sudah presisi per kecamatan).
    const sudahPunyaKodeSendiri = !!KECAMATAN_ADM4[kec];
    let suhuFinal = cuaca.suhu, kelembapanFinal = cuaca.kelembapan;
    if(!sudahPunyaKodeSendiri){
      const acuan = WILAYAH_RISIKO.find(w => w.kecamatan === "Pekanbaru Kota");
      if(acuan){
        suhuFinal = Math.round((cuaca.suhu + (dasar.suhu - acuan.suhu)) * 10) / 10;
        kelembapanFinal = Math.round(cuaca.kelembapan + (dasar.kelembapan - acuan.kelembapan));
      }
    }

    // Titik panas: pakai hasil FIRMS kalau aktif, kalau tidak pertahankan nilai yang sudah ada
    const hotspot = firmsAktif ? (hotspotPerKecamatan[kec] || 0) : (overrideLama?.hotspot ?? dasar.hotspot);

    ewsSimpanUpdateMonitoring(kec, suhuFinal, kelembapanFinal, hotspot);
    jumlahTersinkron++;
  });

  localStorage.setItem(EWS_STORAGE_SYNC_TIME, new Date().toISOString());
  ewsSetRentangHariHotspot(rentang); // simpan supaya auto-sync berikutnya & halaman lain memakai pilihan yang sama
  return { jumlahTersinkron, totalWilayah: daftarKecamatan.length, firmsAktif, pm25Aktif, hariRentang: rentang };
}

/* =========================================================
   Auto-sync BERSAMA (dipakai dashboard.html, peringatan.html, dan
   monitoring.html) — supaya begitu petugas LOGIN dan masuk ke halaman
   manapun, data Monitoring (BMKG + FIRMS) langsung disegarkan sendiri
   tanpa harus buka halaman Monitoring dulu secara manual. Aturannya
   SAMA seperti auto-sync yang sudah ada di Monitoring: hanya jalan
   kalau belum pernah sinkron ATAU sudah lewat 12 jam sejak sinkron
   terakhir, supaya tidak memanggil BMKG/FIRMS berulang-ulang tiap
   halaman dibuka.
   @returns {Promise<boolean>} true kalau sinkronisasi benar-benar
            dijalankan barusan (artinya halaman pemanggil sebaiknya
            render ulang tampilannya), false kalau dilewati (masih
            dalam 12 jam) atau gagal.
   ========================================================= */
async function ewsAutoSyncMonitoringJikaPerlu(){
  const waktu = ewsWaktuSyncTerakhir();
  const perluSync = !waktu || (Date.now() - new Date(waktu).getTime()) > 12 * 60 * 60 * 1000;
  if(!perluSync) return false;

  try{
    await ewsSinkronMonitoringRealtime();
    // Kirim notifikasi Telegram (lewat notifikasi.js) kalau ada kecamatan
    // yang baru saja naik ke Sedang/Tinggi — sama seperti tombol "Sinkronkan
    // Sekarang" di Monitoring. Tidak menggagalkan auto-sync kalau ini error
    // (mis. TELEGRAM_BOT_TOKEN memang sengaja kosong di sisi klien).
    if(typeof ewsCekDanKirimNotifikasiEskalasi === "function"){
      try{ await ewsCekDanKirimNotifikasiEskalasi(); }
      catch(e){ console.warn("[Auto-sync] Gagal cek/kirim notifikasi eskalasi:", e); }
    }
    return true;
  }catch(e){
    console.warn("[Auto-sync] Gagal menyinkronkan data Monitoring otomatis:", e);
    return false;
  }
}
