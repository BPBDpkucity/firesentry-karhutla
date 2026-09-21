#!/usr/bin/env node
/* =========================================================
   FIRESENTRY KARHUTLA - Pengecekan Status Otomatis (server-side)
   ---------------------------------------------------------
   Dijalankan TERJADWAL lewat GitHub Actions (lihat
   .github/workflows/cek-status-karhutla.yml) — TANPA perlu ada
   yang membuka browser/dashboard. Inilah bagian yang membuat
   sistem ini benar-benar "Peringatan DINI", bukan cuma tampilan
   pasif yang harus dibuka manual.

   ALUR:
   1. Ambil cuaca terkini (BMKG) + titik panas (NASA FIRMS) untuk
      tiap kecamatan — logikanya sama persis dengan
      ewsSinkronMonitoringRealtime() di assets/js/api.js, hanya
      dijalankan di Node (server), bukan di browser.
   2. Hitung status risiko tiap kecamatan.
   3. Bandingkan dengan status hasil run SEBELUMNYA (disimpan di
      data/status-notifikasi-terakhir.json, di-commit balik ke
      repo tiap kali script ini jalan).
   4. Kirim pesan Telegram HANYA untuk kecamatan yang levelnya
      NAIK ke Sedang/Tinggi.

   ====== PRINSIP MESIN RISIKO ======
   Tidak ada threshold numerik buatan untuk suhu, kelembapan, atau
   jumlah hotspot. NASA FIRMS menjadi bukti hotspot; BMKG suhu/RH/angin
   menjadi konteks meteorologis; kategori FFMC BMKG dipakai bila tersedia
   sebagai data terstruktur. Persistensi hotspot dibandingkan antar-run.
   =========================================================    ========================================================= */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const FIRMS_MAP_KEY = process.env.FIRMS_MAP_KEY;
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const BMKG_ENDPOINT = "https://api.bmkg.go.id/publik/prakiraan-cuaca";
const FIRMS_BOX = "101.30,0.40,101.60,0.70"; // cakupan diperlebar agar seluruh bentang Kota Pekanbaru/Rumbai Timur ikut terambil
const FILE_STATUS = path.join(process.cwd(), "data", "status-notifikasi-terakhir.json");
const FDRS_FILE = path.join(process.cwd(), "data", "bmkg-fdrs.json");

// Kode wilayah (adm4) per kecamatan — disalin dari KECAMATAN_ADM4 di assets/js/data.js
const KECAMATAN_ADM4 = {
  "Pekanbaru Kota": "14.71.02.1004",
  "Tenayan Raya": "14.71.10.1004",
  "Rumbai": "14.71.12.1009",
  "Rumbai Barat": "14.71.06.1003",
  "Rumbai Timur": "14.71.15.1005",
  "Kulim": "14.71.14.1001",
  "Bukit Raya": "14.71.07.1005",
  "Marpoyan Damai": "14.71.09.1003",
  "Payung Sekaki": "14.71.11.1002",
  "Tuah Madani": "14.71.13.1004",
  "Binawidya": "14.71.08.1010",
  "Sukajadi": "14.71.01.1007",
  "Sail": "14.71.03.1001",
  "Lima Puluh": "14.71.04.1001",
  "Senapelan": "14.71.05.1005",
};

// Satu titik koordinat wakil per kecamatan (dipakai HANYA untuk
// mengelompokkan titik panas FIRMS ke kecamatan terdekat — cukup untuk
// keperluan notifikasi, tidak perlu presisi kelurahan seperti di dashboard).
const TITIK_ACUAN_KECAMATAN = {
  "Tenayan Raya": { lat: 0.5486, lng: 101.5192 },
  "Rumbai": { lat: 0.5637, lng: 101.4111 },
  "Rumbai Barat": { lat: 0.535, lng: 101.439 },
  "Binawidya": { lat: 0.4802, lng: 101.3986 },
  "Bukit Raya": { lat: 0.5083, lng: 101.4767 },
  "Marpoyan Damai": { lat: 0.5069, lng: 101.4364 },
  "Payung Sekaki": { lat: 0.5147, lng: 101.4058 },
  "Tuah Madani": { lat: 0.5215, lng: 101.398 },
  "Sukajadi": { lat: 0.5261, lng: 101.4342 },
  "Pekanbaru Kota": { lat: 0.5333, lng: 101.45 },
  "Sail": { lat: 0.528, lng: 101.46 },
  "Lima Puluh": { lat: 0.541, lng: 101.453 },
  "Senapelan": { lat: 0.5305, lng: 101.438 },
  "Kulim": { lat: 0.489, lng: 101.533 },
  "Rumbai Timur": { lat: 0.575, lng: 101.465 },
};

const URUTAN_STATUS_EWS = { NORMAL: 0, WASPADA: 1, SIAGA: 2, PERINGATAN: 3 };
const URUTAN_RISIKO = { Rendah: 0, Sedang: 1, Tinggi: 2 };

function normalisasiFfmcCategory(raw){
  const v = String(raw ?? '').trim().toLowerCase();
  if(['sangat tinggi','very high'].includes(v)) return 'Sangat Tinggi';
  if(['tinggi','high'].includes(v)) return 'Tinggi';
  if(['sedang','moderate','medium'].includes(v)) return 'Sedang';
  if(['rendah','low'].includes(v)) return 'Rendah';
  return null;
}

function hitungStatusEws({ hotspot, persistent, ffmcCategory }){
  const adaHotspot = Number(hotspot || 0) > 0;
  const ffmc = normalisasiFfmcCategory(ffmcCategory);
  const ffmcTinggi = ffmc === 'Tinggi' || ffmc === 'Sangat Tinggi';
  if (persistent && ffmc === 'Sangat Tinggi') return 'PERINGATAN';
  if ((adaHotspot && ffmcTinggi) || (persistent && adaHotspot)) return 'SIAGA';
  if (adaHotspot || ffmcTinggi) return 'WASPADA';
  return 'NORMAL';
}

function risikoLegacyDariStatus(statusEws){
  if(statusEws === 'NORMAL') return 'Rendah';
  if(statusEws === 'WASPADA') return 'Sedang';
  return 'Tinggi';
}

function alasanStatusEws({ hotspot, persistent, ffmcCategory }){
  const alasan = [];
  const ffmc = normalisasiFfmcCategory(ffmcCategory);
  if(Number(hotspot || 0) > 0) alasan.push(`Hotspot NASA FIRMS terdeteksi (${hotspot})`);
  else alasan.push('Tidak ada hotspot NASA FIRMS pada data yang diperiksa');
  if(persistent) alasan.push('Hotspot terdeteksi berulang pada kecamatan ini');
  if(ffmc) alasan.push(`FFMC BMKG: kategori ${ffmc}`);
  else alasan.push('Kategori FFMC BMKG belum tersedia sebagai data terstruktur');
  return alasan;
}

async function ambilCuacaTerkini(adm4) {
  const res = await fetch(`${BMKG_ENDPOINT}?adm4=${encodeURIComponent(adm4)}`);
  if (!res.ok) throw new Error("BMKG HTTP " + res.status);
  const json = await res.json();
  const cuaca = json?.data?.[0]?.cuaca;
  if (!cuaca) return null;
  const flat = cuaca.flat();
  const now = Date.now();
  let terdekat = null;
  let selisihMin = Infinity;
  for (const item of flat) {
    const t = new Date((item.local_datetime || "").replace(" ", "T")).getTime();
    if (Number.isNaN(t)) continue;
    const selisih = Math.abs(now - t);
    if (selisih < selisihMin) {
      selisihMin = selisih;
      terdekat = item;
    }
  }
  return terdekat ? {
    suhu: terdekat.t ?? null,
    kelembapan: terdekat.hu ?? null,
    anginKecepatan: terdekat.ws ?? null,
    anginArah: terdekat.wd ?? null,
    waktuPrakiraan: terdekat.local_datetime ?? null
  } : null;
}


async function bacaBatasKecamatan(){
  try{
    const file = path.join(process.cwd(), "assets", "js", "batas-kecamatan.js");
    const src = await readFile(file, "utf8");
    const match = src.match(/const\s+BATAS_KECAMATAN_PEKANBARU\s*=\s*(\{[\s\S]*\})\s*;\s*$/);
    return match ? JSON.parse(match[1]) : null;
  }catch(e){
    console.warn("[Wilayah] Batas kecamatan tidak dapat dimuat, fallback centroid dipakai:", e.message);
    return null;
  }
}

function pointInRing(lng, lat, ring){
  let inside = false;
  for(let i=0, j=ring.length-1; i<ring.length; j=i++){
    const xi=ring[i][0], yi=ring[i][1], xj=ring[j][0], yj=ring[j][1];
    const intersect = ((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi+Number.EPSILON)+xi);
    if(intersect) inside=!inside;
  }
  return inside;
}
function pointInPolygon(lng, lat, polygon){
  if(!polygon || !polygon.length) return false;
  if(!pointInRing(lng,lat,polygon[0])) return false;
  for(let i=1;i<polygon.length;i++) if(pointInRing(lng,lat,polygon[i])) return false;
  return true;
}
function pointInGeometry(lng, lat, geometry){
  if(!geometry) return false;
  if(geometry.type === "Polygon") return pointInPolygon(lng,lat,geometry.coordinates);
  if(geometry.type === "MultiPolygon") return geometry.coordinates.some(poly=>pointInPolygon(lng,lat,poly));
  return false;
}

function klasifikasiKecamatan(lng, lat, batas){
  if(batas?.features){
    // Pertama pastikan titik memang berada di bentang Kota Pekanbaru.
    const diKota = batas.features.some(f=>pointInGeometry(lng,lat,f.geometry));
    if(!diKota) return null;
    // Gunakan poligon yang relatif aman untuk pemetaan per kecamatan.
    // Poligon Rumbai/Tenayan lama mencakup wilayah pemekaran baru, jadi keduanya
    // sengaja tidak dipakai sebagai klasifikasi presisi; titiknya akan jatuh ke
    // fallback centroid 15 kecamatan.
    const feature = batas.features.find(f=>{
      const k=f.properties?.kecamatan;
      if(k === "Rumbai" || k === "Tenayan Raya") return false;
      return pointInGeometry(lng,lat,f.geometry);
    });
    if(feature?.properties?.kecamatan) return feature.properties.kecamatan;
  }
  // Fallback hanya untuk wilayah yang batas poligonnya belum tersedia/presisi.
  let terdekat=null, jarakMin=Infinity;
  for(const [kec,titik] of Object.entries(TITIK_ACUAN_KECAMATAN)){
    const jarak=Math.hypot(lat-titik.lat,lng-titik.lng);
    if(jarak<jarakMin){jarakMin=jarak;terdekat=kec;}
  }
  return terdekat;
}

function normalisasiConfidenceFirms(raw){
  const v=String(raw??"").trim().toLowerCase();
  if(v === "h") return 3;
  if(v === "n") return 2;
  if(v === "l") return 1;
  const n=Number(raw);
  return Number.isFinite(n) ? (n>=80?3:n>=50?2:1) : 0;
}

function dedupeFirms(points){
  const seen=new Map();
  for(const p of points){
    const lat=Number(p.latitude), lng=Number(p.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lng)) continue;
    // ~100 m grid + acquisition timestamp. Mengurangi duplikasi deteksi
    // lintas satelit tanpa menggabungkan titik yang berjauhan.
    const key=[Math.round(lat*1000),Math.round(lng*1000),p.acq_date||"",p.acq_time||""].join("|");
    const old=seen.get(key);
    if(!old || normalisasiConfidenceFirms(p.confidence)>normalisasiConfidenceFirms(old.confidence)) seen.set(key,p);
  }
  return [...seen.values()];
}

async function ambilTitikFirms() {
  if (!FIRMS_MAP_KEY) {
    console.warn("[FIRMS] FIRMS_MAP_KEY tidak diset (secret kosong), lewati pengambilan hotspot.");
    return [];
  }
  const sumber = ["VIIRS_SNPP_NRT","VIIRS_NOAA20_NRT","VIIRS_NOAA21_NRT"];
  const batas = await bacaBatasKecamatan();
  const semua=[];
  for(const sensor of sumber){
    try{
      const url=`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_MAP_KEY}/${sensor}/${FIRMS_BOX}/1`;
      const res=await fetch(url);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const csv=(await res.text()).trim();
      if(!/^latitude,longitude/i.test(csv)) throw new Error("respons bukan CSV FIRMS");
      const baris=csv.split("\n");
      if(baris.length<2) continue;
      const header=baris[0].split(",");
      for(const r of baris.slice(1)){
        const kolom=r.split(","), obj={};
        header.forEach((h,i)=>obj[h.trim()]=kolom[i]);
        const lat=Number(obj.latitude), lng=Number(obj.longitude);
        if(!Number.isFinite(lat)||!Number.isFinite(lng)) continue;
        const kec=klasifikasiKecamatan(lng,lat,batas);
        if(!kec) continue;
        obj.kecamatan= kec;
        obj._confidenceScore=normalisasiConfidenceFirms(obj.confidence);
        // Untuk EWS, low-confidence tidak dihitung sebagai sinyal utama.
        if(obj._confidenceScore < 2) continue;
        semua.push(obj);
      }
      console.log(`[FIRMS] ${sensor}: ${baris.length-1} record diterima sebelum filter.`);
    }catch(e){
      console.warn(`[FIRMS] ${sensor} gagal:`,e.message);
    }
  }
  return dedupeFirms(semua);
}

function kecamatanTerdekat(lat, lng) {
  let terdekat = null;
  let jarakMin = Infinity;
  for (const [kec, titik] of Object.entries(TITIK_ACUAN_KECAMATAN)) {
    const jarak = Math.hypot(lat - titik.lat, lng - titik.lng);
    if (jarak < jarakMin) {
      jarakMin = jarak;
      terdekat = kec;
    }
  }
  return terdekat;
}

function kelompokkanHotspot(titikFirms) {
  const jumlah = {};
  for (const p of titikFirms) {
    const kec = p.kecamatan || kecamatanTerdekat(parseFloat(p.latitude), parseFloat(p.longitude));
    if (!kec) continue;
    jumlah[kec] = (jumlah[kec] || 0) + 1;
  }
  return jumlah;
}

async function supabaseRequest(pathname, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase HTTP ${res.status}: ${await res.text()}`);
  return res;
}

async function simpanKeSupabase(statusBaru, riwayatBaru, mulaiPada, selesaiPada, kecamatanGagal) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  const rows = Object.entries(statusBaru)
    .filter(([k]) => k !== "_meta")
    .map(([kecamatan, v]) => ({
      kecamatan, risiko: v.risiko, status_ews: v.statusEws || null, suhu: v.suhu, kelembapan: v.kelembapan,
      angin_kecepatan: v.anginKecepatan ?? null, angin_arah: v.anginArah ?? null, hotspot: v.hotspot, waktu_cek: v.waktuCek, sumber: "BMKG + NASA FIRMS", updated_at: selesaiPada, fdrs_ffmc: v.fdrs?.ffmc ?? null, fdrs_fwi: v.fdrs?.fwi ?? null, fdrs_numeric_available: !!v.fdrs?.numericValuesAvailable, fdrs_source: v.fdrs?.source ?? "BMKG SPARTAN"
    }));
  if (rows.length) {
    await supabaseRequest("ews_status_current?on_conflict=kecamatan", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    });
  }

  const alerts = riwayatBaru.filter(x => x.waktu === selesaiPada || x.waktu === mulaiPada).map(x => ({
    kecamatan: x.kecamatan, dari_risiko: x.dari || "Rendah", ke_risiko: x.ke,
    suhu: x.suhu, kelembapan: x.kelembapan, hotspot: x.hotspot,
    terdeteksi_pada: x.waktu, telegram_terkirim: !!x.notifikasiTerkirim
  }));
  if (alerts.length) {
    await supabaseRequest("ews_alerts", { method: "POST", body: JSON.stringify(alerts) });
  }

  const gagal = kecamatanGagal.length === Object.keys(KECAMATAN_ADM4).length ? "gagal" : kecamatanGagal.length ? "sebagian" : "berhasil";
  await supabaseRequest("ews_runs", { method: "POST", body: JSON.stringify([{ mulai_pada: mulaiPada, selesai_pada: selesaiPada, status: gagal, kecamatan_gagal: kecamatanGagal, sumber: "GitHub Actions" }]) });
}

async function kirimTelegram(pesan) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.warn("[Telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID belum diset di GitHub Secrets, notifikasi dilewati.");
    return false;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: pesan, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    console.warn("[Telegram] Gagal kirim:", res.status, await res.text());
    return false;
  }
  return true;
}

function susunPesan(kecamatan, statusEws, detail) {
  const emoji = statusEws === 'PERINGATAN' ? '🚨' : statusEws === 'SIAGA' ? '🔴' : '🟠';
  const angin = detail?.anginKecepatan != null ? `${detail.anginKecepatan} km/jam` : '-';
  const arah = detail?.anginArah || '-';
  const ffmc = detail?.fdrs?.ffmcCategory || 'Belum tersedia';
  const alasan = Array.isArray(detail?.alasan) ? detail.alasan.map(x => `• ${x}`).join('\n') : '';
  return (
    `${emoji} <b>FIRESENTRY — PERINGATAN DINI KARHUTLA</b>\n` +
    `Kecamatan: <b>${kecamatan}</b>\n` +
    `Status EWS: <b>${statusEws}</b>\n\n` +
    `<b>Indikator</b>\n` +
    `• Hotspot NASA FIRMS: <b>${detail?.hotspot ?? 0}</b>${detail?.hotspotPersistent ? ' (berulang)' : ''}\n` +
    `• Suhu BMKG: <b>${detail?.suhu ?? '-'} °C</b>\n` +
    `• Kelembapan BMKG: <b>${detail?.kelembapan ?? '-'}%</b>\n` +
    `• Angin BMKG: <b>${angin}</b> (${arah})\n` +
    `• FFMC BMKG: <b>${ffmc}</b>\n\n` +
    `<b>Alasan</b>\n${alasan}\n\n` +
    `Waktu cek: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB\n` +
    `Sumber: BMKG + NASA FIRMS`
  );
}

/**
 * Alert KHUSUS untuk masalah SISTEM (bukan eskalasi risiko karhutla biasa)
 * — dipakai saat BMKG gagal total atau script error, supaya petugas/dev
 * tahu sistemnya sedang "buta", bukan diam-diam berhenti kerja.
 */
async function kirimAlertSistem(pesan) {
  await kirimTelegram(`⚠️ <b>PERINGATAN SISTEM FIRESENTRY</b>\n${pesan}\n\nWaktu: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`);
}

// Kompatibel dengan format LAMA (tiap kecamatan cuma berupa string
// "Rendah"/"Sedang"/"Tinggi") maupun format BARU (objek berisi detail).
// Supaya file lama yang sudah ada di repo tidak bikin script ini error,
// dan supaya dashboard.js yang membaca file baru tetap bisa mundur ke
// bentuk lama kalau perlu.
function risikoDariEntriLama(entri) {
  if (!entri) return "Rendah";
  if (typeof entri === "string") return entri;
  return entri.risiko || "Rendah";
}

async function bacaFdrsMetadata() {
  try { return JSON.parse(await readFile(FDRS_FILE, "utf8")); }
  catch { return null; }
}

async function bacaStatusLama() {
  try {
    return JSON.parse(await readFile(FILE_STATUS, "utf8"));
  } catch (e) {
    return {}; // pertama kali dijalankan, file belum ada
  }
}

async function simpanStatusBaru(status) {
  await mkdir(path.dirname(FILE_STATUS), { recursive: true });
  await writeFile(FILE_STATUS, JSON.stringify(status, null, 2) + "\n", "utf8");
}

// Jumlah maksimal entri riwayat eskalasi yang disimpan (supaya file JSON
// tidak membengkak tanpa batas — entri lama otomatis dibuang).
const MAKS_RIWAYAT_ESKALASI = 50;

async function main() {
  const mulaiPada = new Date().toISOString();
  const statusLama = await bacaStatusLama();
  const fdrs = await bacaFdrsMetadata();
  // "_meta" bukan nama kecamatan — dipisah supaya tidak ikut ke-loop/dibaca sebagai kecamatan.
  const statusBaru = {};
  const dinotifikasi = [];
  // Riwayat SEMUA momen eskalasi (naik ke Sedang/Tinggi) yang pernah terdeteksi
  // pengecekan otomatis ini — disimpan terus walau kondisi belakangan turun lagi
  // ke Rendah, supaya halaman Peringatan bisa menunjukkan "sempat Sedang pada
  // jam sekian" alih-alih terlihat "stuck" di status saat ini saja.
  const riwayatEskalasi = Array.isArray(statusLama?._meta?.riwayatEskalasi)
    ? [...statusLama._meta.riwayatEskalasi]
    : [];

  const titikFirms = await ambilTitikFirms().catch((e) => {
    console.warn("[FIRMS] Gagal ambil hotspot:", e.message);
    return [];
  });
  const hotspotPerKecamatan = kelompokkanHotspot(titikFirms);

  const kecamatanGagal = []; // nama kecamatan yang BMKG-nya gagal diambil kali ini
  const sekarangIso = new Date().toISOString();

  for (const [kecamatan, adm4] of Object.entries(KECAMATAN_ADM4)) {
    let cuaca = null;
    try {
      cuaca = await ambilCuacaTerkini(adm4);
    } catch (e) {
      console.warn(`[BMKG] Gagal ambil cuaca untuk ${kecamatan}:`, e.message);
    }
    if (!cuaca) {
      kecamatanGagal.push(kecamatan);
      // Pertahankan status HASIL CEK TERAKHIR yang masih valid untuk kecamatan
      // ini (jangan hilang dari file cuma karena satu run gagal), tapi jangan
      // dianggap "baru saja dicek" — waktuCek-nya tetap yang lama.
      if (statusLama[kecamatan]) statusBaru[kecamatan] = statusLama[kecamatan];
      continue; // BMKG gagal untuk kecamatan ini, lewati (jangan tebak status)
    }

    const hotspot = hotspotPerKecamatan[kecamatan] || 0;
    const entriLama = statusLama[kecamatan];
    const hotspotLama = Number(entriLama?.hotspot || 0);
    const persistent = hotspot > 0 && hotspotLama > 0;
    const ffmcCategory = normalisasiFfmcCategory(fdrs?.ffmcCategory || fdrs?.ffmc_category || null);
    const statusEws = hitungStatusEws({ hotspot, persistent, ffmcCategory });
    const risikoBaru = risikoLegacyDariStatus(statusEws);
    const alasan = alasanStatusEws({ hotspot, persistent, ffmcCategory });

    statusBaru[kecamatan] = {
      risiko: risikoBaru,
      statusEws,
      alasan,
      suhu: cuaca.suhu,
      kelembapan: cuaca.kelembapan,
      anginKecepatan: cuaca.anginKecepatan,
      anginArah: cuaca.anginArah,
      waktuPrakiraan: cuaca.waktuPrakiraan,
      hotspot,
      hotspotPersistent: persistent,
      waktuCek: sekarangIso,
      fdrs: fdrs ? { source: 'BMKG SPARTAN', numericValuesAvailable: !!fdrs.numericValuesAvailable, ffmc: fdrs.ffmc ?? null, ffmcCategory, fwi: fdrs.fwi ?? null, observationUrl: fdrs.sources?.imageFfmcObservation || null } : null,
    };

    const statusLamaEws = entriLama?.statusEws || (entriLama ? (entriLama.risiko === 'Tinggi' ? 'SIAGA' : entriLama.risiko === 'Sedang' ? 'WASPADA' : 'NORMAL') : 'NORMAL');
    const naik = URUTAN_STATUS_EWS[statusEws] > URUTAN_STATUS_EWS[statusLamaEws];
    const perluCatatEskalasi = naik && statusEws !== 'NORMAL';

    console.log(`${kecamatan}: suhu=${cuaca.suhu} RH=${cuaca.kelembapan} angin=${cuaca.anginKecepatan ?? '-'} km/h hotspot=${hotspot} persisten=${persistent} FFMC=${ffmcCategory || '-'} -> ${statusEws}`);

    if (perluCatatEskalasi) {
      // Catat ke riwayat SEBELUM mengecek berhasil-tidaknya kirim Telegram —
      // supaya momen eskalasi tetap tercatat walau notifikasi Telegram gagal
      // terkirim (token belum diisi, Telegram error, dll). Ini yang membuat
      // histori "sempat Sedang" tidak ikut hilang hanya karena notifikasinya
      // gagal/belum aktif.
      const terkirim = await kirimTelegram(susunPesan(kecamatan, statusEws, statusBaru[kecamatan]));
      if (terkirim) dinotifikasi.push(kecamatan);
      riwayatEskalasi.unshift({
        kecamatan,
        dari: risikoLama,
        ke: statusEws,
        risiko: risikoBaru,
        suhu: cuaca.suhu,
        kelembapan: cuaca.kelembapan,
        hotspot,
        waktu: sekarangIso,
        notifikasiTerkirim: terkirim,
      });
    }
  }

  // Batasi jumlah riwayat yang disimpan supaya file tidak membengkak.
  const riwayatTerpangkas = riwayatEskalasi.slice(0, MAKS_RIWAYAT_ESKALASI);

  // Metadata di kunci terpisah "_meta" — supaya halaman web tahu KAPAN
  // pengecekan otomatis ini terakhir jalan, walau semua kecamatan Rendah
  // (jadi "stuck di Rendah" vs "sistemnya berhenti jalan" bisa dibedakan).
  // "riwayatEskalasi" menyimpan jejak SEMUA momen naik ke Sedang/Tinggi yang
  // pernah terdeteksi, supaya tidak hilang begitu saja kalau kondisi
  // belakangan turun lagi ke Rendah sebelum sempat ditutup/dilihat manual.
  statusBaru._meta = {
    diperbaruiPada: sekarangIso,
    sumber: "GitHub Actions terjadwal (BMKG + NASA FIRMS + BMKG FDRS + IQAir terpisah)",
    fdrs,
    kecamatanGagal,
    riwayatEskalasi: riwayatTerpangkas,
  };

  await simpanStatusBaru(statusBaru);
  try {
    await simpanKeSupabase(statusBaru, riwayatEskalasi, mulaiPada, sekarangIso, kecamatanGagal);
  } catch (e) {
    console.warn("[Supabase] Penyimpanan database gagal, status JSON tetap tersimpan:", e.message);
  }

  const totalKecamatan = Object.keys(KECAMATAN_ADM4).length;
  if (kecamatanGagal.length === totalKecamatan) {
    // SEMUA kecamatan gagal — kemungkinan besar BMKG down atau endpoint berubah.
    // Ini paling kritis: sistem jadi "buta" total tanpa ada yang tahu.
    console.error("[ALERT] BMKG gagal untuk SEMUA kecamatan — sistem tidak bisa menilai risiko saat ini.");
    await kirimAlertSistem(
      `Gagal mengambil data cuaca BMKG untuk <b>SEMUA ${totalKecamatan} kecamatan</b>.\n` +
      `Sistem TIDAK BISA menilai status risiko saat ini — kemungkinan BMKG API sedang down atau berubah.\n` +
      `Cek log GitHub Actions untuk detail error.`
    );
  } else if (kecamatanGagal.length > 0) {
    // Sebagian gagal — beri tahu supaya tidak dikira "aman", padahal cuma tidak ter-cek.
    console.warn(`[ALERT] BMKG gagal untuk ${kecamatanGagal.length} dari ${totalKecamatan} kecamatan:`, kecamatanGagal.join(", "));
    await kirimAlertSistem(
      `Gagal ambil data cuaca untuk ${kecamatanGagal.length} dari ${totalKecamatan} kecamatan:\n` +
      `<b>${kecamatanGagal.join(", ")}</b>\n` +
      `Kecamatan ini TIDAK ter-update statusnya kali ini (bukan berarti aman, datanya cuma tidak masuk).`
    );
  }

  if (dinotifikasi.length) {
    console.log("Notifikasi terkirim untuk:", dinotifikasi.join(", "));
  } else {
    console.log("Tidak ada eskalasi status — tidak ada notifikasi yang dikirim kali ini.");
  }
}

main().catch(async (e) => {
  console.error("Pengecekan gagal total:", e);
  // Kirim juga ke Telegram, jangan cuma diam di log GitHub Actions yang jarang dicek.
  await kirimAlertSistem(
    `Script pengecekan status karhutla GAGAL TOTAL dengan error:\n<code>${String(e.message || e).slice(0, 300)}</code>\n` +
    `Cek log GitHub Actions untuk detail lengkap.`
  ).catch(() => {}); // kalau kirim alert-nya sendiri juga gagal, jangan sampai bikin proses macet
  process.exit(1);
});
