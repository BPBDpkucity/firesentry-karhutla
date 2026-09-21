/* =========================================================
   FIRESENTRY KARHUTLA - Data Analisis Risiko (KRB)
   Sumber data: file geodatabase ESRI "4 Risiko.gdb" (Indeks Risiko
   Multibahaya BNPB/InaRISK-style, band raster per jenis bahaya),
   resolusi asli 30m, proyeksi UTM 47N (EPSG:32647), diproses ulang
   (reproject ke WGS84 + klasifikasi 3 kelas KRB) untuk ditampilkan
   sebagai overlay peta pada halaman Analisis Risiko.
   Ambang klasifikasi mengikuti konvensi Indeks Risiko Bencana BNPB
   pada skala 0-1: Rendah < 0.34, Sedang 0.34-0.66, Tinggi >= 0.67.
   ========================================================= */

const RISIKO_KRB_LAYERS = [
  {
    "key": "cuaca",
    "label": "Cuaca Ekstrem",
    "file": "assets/img/krb/Indeks_Risiko_Cuaca_Ekstrem.png",
    "bounds": [
      [
        0.420105,
        101.322624
      ],
      [
        0.691409,
        101.605548
      ]
    ],
    "max": 0.7263,
    "mean": 0.294,
    "pctRendah": 43.2,
    "pctSedang": 56.6,
    "pctTinggi": 0.1
  },
  {
    "key": "gempabumi",
    "label": "Gempabumi",
    "file": "assets/img/krb/Indeks_Risiko_Gempabumi.png",
    "bounds": [
      [
        0.420321,
        101.322897
      ],
      [
        0.691085,
        101.605281
      ]
    ],
    "max": 0.0,
    "mean": 0.0,
    "pctRendah": 100.0,
    "pctSedang": 0.0,
    "pctTinggi": 0.0
  },
  {
    "key": "longsor",
    "label": "Tanah Longsor",
    "file": "assets/img/krb/Indeks_Risiko_Tanah_Longsor.png",
    "bounds": [
      [
        0.420226,
        101.322642
      ],
      [
        0.691259,
        101.605565
      ]
    ],
    "max": 0.7268,
    "mean": 0.3393,
    "pctRendah": 63.3,
    "pctSedang": 33.5,
    "pctTinggi": 3.2
  },
  {
    "key": "kekeringan",
    "label": "Kekeringan",
    "file": "assets/img/krb/Indeks_Risiko_Kekeringan.png",
    "bounds": [
      [
        0.420321,
        101.322897
      ],
      [
        0.691085,
        101.605281
      ]
    ],
    "max": 0.713,
    "mean": 0.4608,
    "pctRendah": 21.0,
    "pctSedang": 78.7,
    "pctTinggi": 0.3
  },
  {
    "key": "banjir",
    "label": "Banjir",
    "file": "assets/img/krb/Indeks_Risiko_Banjir.png",
    "bounds": [
      [
        0.42012,
        101.322777
      ],
      [
        0.691154,
        101.60543
      ]
    ],
    "max": 0.8355,
    "mean": 0.3186,
    "pctRendah": 47.4,
    "pctSedang": 48.3,
    "pctTinggi": 4.2
  },
  {
    "key": "kebakaran",
    "label": "Kebakaran Hutan & Lahan",
    "file": "assets/img/krb/Indeks_Risiko_Kebakaran_Hutan_Lahan.png",
    "bounds": [
      [
        0.420321,
        101.322897
      ],
      [
        0.691085,
        101.605281
      ]
    ],
    "max": 0.8659,
    "mean": 0.4147,
    "pctRendah": 37.7,
    "pctSedang": 34.0,
    "pctTinggi": 28.3
  },
  {
    "key": "multibahaya",
    "label": "Multibahaya (Gabungan)",
    "file": "assets/img/krb/Indeks_Risiko_Multibahaya.png",
    "bounds": [
      [
        0.420321,
        101.322897
      ],
      [
        0.691085,
        101.605281
      ]
    ],
    "max": 0.8538,
    "mean": 0.5487,
    "pctRendah": 7.1,
    "pctSedang": 79.4,
    "pctTinggi": 13.4
  }
];

// Statistik risiko per kecamatan, dihitung dari zonal-mean nilai raster
// tiap bahaya di atas poligon batas kecamatan (assets/js/batas-kecamatan.js).
// Field "..._cov" = persentase piksel raster yang valid (bukan NoData) di
// dalam wilayah kecamatan tsb. Cakupan piksel < 5% dianggap tidak cukup
// representatif (nilai di-null-kan) -- umumnya terjadi pada kecamatan yang
// didominasi area terbangun/perkotaan, karena indeks risiko karhutla &
// bencana lahan hanya dimodelkan pada tutupan lahan bervegetasi/gambut.
//
// CATATAN skor "kebakaran" (karhutla) pada 6 kecamatan pusat kota (Lima
// Puluh, Pekanbaru Kota, Sail, Senapelan, Sukajadi, Tuah Madani): cakupan
// piksel raster valid di wilayah ini sangat kecil (0%-2.9%) karena hampir
// seluruh area sudah terbangun/perkotaan, sehingga TIDAK ADA nilai zonal
// mean asli dari raster untuk kecamatan tsb. Agar tabel tetap informatif
// (tidak kosong) bagi kecamatan-kecamatan ini, skornya diisi dengan
// ESTIMASI hasil interpolasi jarak terbalik (Inverse Distance Weighting,
// power=2) dari skor 7 kecamatan lain yang punya cakupan data valid,
// berdasarkan jarak antar titik tengah (centroid) poligon kecamatan.
// Field "kebakaran_estimasi": true menandai nilai ini BUKAN hasil
// pengukuran raster langsung — supaya tetap jujur & bisa dibedakan saat
// ditampilkan (lihat badge "(estimasi)" di analisis-risiko.html).
const TABEL_RISIKO_KECAMATAN = [
  {
    "kecamatan": "Rumbai",
    "kebakaran": 0.577,
    "kebakaran_cov": 31.1,
    "kebakaran_kelas": "Sedang",
    "multibahaya": 0.574,
    "multibahaya_cov": 56.2,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.271,
    "cuaca_cov": 54.8,
    "cuaca_kelas": "Rendah",
    "longsor": null,
    "longsor_cov": 3.2,
    "longsor_kelas": null,
    "kekeringan": 0.479,
    "kekeringan_cov": 56.2,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.419,
    "banjir_cov": 22.4,
    "banjir_kelas": "Sedang"
  },
  {
    "kecamatan": "Binawidya",
    "kebakaran": 0.407,
    "kebakaran_cov": 13.3,
    "kebakaran_kelas": "Sedang",
    "multibahaya": 0.49,
    "multibahaya_cov": 86.6,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.417,
    "cuaca_cov": 86.4,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.366,
    "kekeringan_cov": 86.6,
    "kekeringan_kelas": "Sedang",
    "banjir": null,
    "banjir_cov": 0.0,
    "banjir_kelas": null
  },
  {
    "kecamatan": "Tenayan Raya",
    "kebakaran": 0.355,
    "kebakaran_cov": 37.8,
    "kebakaran_kelas": "Sedang",
    "multibahaya": 0.545,
    "multibahaya_cov": 60.9,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.276,
    "cuaca_cov": 59.8,
    "cuaca_kelas": "Rendah",
    "longsor": null,
    "longsor_cov": 4.5,
    "longsor_kelas": null,
    "kekeringan": 0.458,
    "kekeringan_cov": 60.9,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.311,
    "banjir_cov": 18.8,
    "banjir_kelas": "Rendah"
  },
  {
    "kecamatan": "Bukit Raya",
    "kebakaran": 0.353,
    "kebakaran_cov": 5.7,
    "kebakaran_kelas": "Sedang",
    "multibahaya": 0.507,
    "multibahaya_cov": 30.2,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.415,
    "cuaca_cov": 29.8,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.377,
    "kekeringan_cov": 30.2,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.268,
    "banjir_cov": 13.4,
    "banjir_kelas": "Rendah"
  },
  {
    "kecamatan": "Rumbai Barat",
    "kebakaran": 0.337,
    "kebakaran_cov": 11.0,
    "kebakaran_kelas": "Rendah",
    "multibahaya": 0.548,
    "multibahaya_cov": 53.1,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.202,
    "cuaca_cov": 51.4,
    "cuaca_kelas": "Rendah",
    "longsor": null,
    "longsor_cov": 1.9,
    "longsor_kelas": null,
    "kekeringan": 0.491,
    "kekeringan_cov": 53.1,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.239,
    "banjir_cov": 16.4,
    "banjir_kelas": "Rendah"
  },
  {
    "kecamatan": "Marpoyan Damai",
    "kebakaran": 0.298,
    "kebakaran_cov": 11.2,
    "kebakaran_kelas": "Rendah",
    "multibahaya": 0.486,
    "multibahaya_cov": 77.8,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.407,
    "cuaca_cov": 77.7,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.373,
    "kekeringan_cov": 77.8,
    "kekeringan_kelas": "Sedang",
    "banjir": null,
    "banjir_cov": 0.2,
    "banjir_kelas": null
  },
  {
    "kecamatan": "Payung Sekaki",
    "kebakaran": 0.183,
    "kebakaran_cov": 30.5,
    "kebakaran_kelas": "Rendah",
    "multibahaya": 0.568,
    "multibahaya_cov": 75.0,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.339,
    "cuaca_cov": 74.0,
    "cuaca_kelas": "Rendah",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.499,
    "kekeringan_cov": 75.0,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.243,
    "banjir_cov": 50.6,
    "banjir_kelas": "Rendah"
  },
  {
    "kecamatan": "Lima Puluh",
    "kebakaran": 0.344,
    "kebakaran_cov": 2.9,
    "kebakaran_kelas": "Sedang",
    "kebakaran_estimasi": true,
    "multibahaya": 0.546,
    "multibahaya_cov": 64.8,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.48,
    "cuaca_cov": 60.7,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.365,
    "kekeringan_cov": 64.8,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.446,
    "banjir_cov": 43.9,
    "banjir_kelas": "Sedang"
  },
  {
    "kecamatan": "Pekanbaru Kota",
    "kebakaran": 0.321,
    "kebakaran_cov": 0.0,
    "kebakaran_kelas": "Rendah",
    "kebakaran_estimasi": true,
    "multibahaya": 0.542,
    "multibahaya_cov": 63.0,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.542,
    "cuaca_cov": 63.1,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.396,
    "kekeringan_cov": 63.0,
    "kekeringan_kelas": "Sedang",
    "banjir": null,
    "banjir_cov": 1.5,
    "banjir_kelas": null
  },
  {
    "kecamatan": "Sail",
    "kebakaran": 0.333,
    "kebakaran_cov": 0.0,
    "kebakaran_kelas": "Rendah",
    "kebakaran_estimasi": true,
    "multibahaya": 0.489,
    "multibahaya_cov": 65.4,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.454,
    "cuaca_cov": 64.0,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.335,
    "kekeringan_cov": 65.4,
    "kekeringan_kelas": "Rendah",
    "banjir": 0.428,
    "banjir_cov": 19.5,
    "banjir_kelas": "Sedang"
  },
  {
    "kecamatan": "Senapelan",
    "kebakaran": 0.301,
    "kebakaran_cov": 0.0,
    "kebakaran_kelas": "Rendah",
    "kebakaran_estimasi": true,
    "multibahaya": 0.615,
    "multibahaya_cov": 67.6,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.599,
    "cuaca_cov": 66.2,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.494,
    "kekeringan_cov": 67.6,
    "kekeringan_kelas": "Sedang",
    "banjir": 0.509,
    "banjir_cov": 56.3,
    "banjir_kelas": "Sedang"
  },
  {
    "kecamatan": "Sukajadi",
    "kebakaran": 0.305,
    "kebakaran_cov": 0.0,
    "kebakaran_kelas": "Rendah",
    "kebakaran_estimasi": true,
    "multibahaya": 0.59,
    "multibahaya_cov": 60.6,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.59,
    "cuaca_cov": 60.5,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.513,
    "kekeringan_cov": 60.6,
    "kekeringan_kelas": "Sedang",
    "banjir": null,
    "banjir_cov": 2.7,
    "banjir_kelas": null
  },
  {
    "kecamatan": "Tuah Madani",
    "kebakaran": 0.352,
    "kebakaran_cov": 0.1,
    "kebakaran_kelas": "Sedang",
    "kebakaran_estimasi": true,
    "multibahaya": 0.511,
    "multibahaya_cov": 49.9,
    "multibahaya_kelas": "Sedang",
    "cuaca": 0.489,
    "cuaca_cov": 49.4,
    "cuaca_kelas": "Sedang",
    "longsor": null,
    "longsor_cov": 0.0,
    "longsor_kelas": null,
    "kekeringan": 0.394,
    "kekeringan_cov": 49.9,
    "kekeringan_kelas": "Sedang",
    "banjir": null,
    "banjir_cov": 0.0,
    "banjir_kelas": null
  }
];

function krbWarnaKelas(kelas){
  if(kelas === "Tinggi") return "#dc2626";
  if(kelas === "Sedang") return "#f59e0b";
  if(kelas === "Rendah") return "#22c55e";
  return "#94a3b8";
}

function krbBadgeKelas(kelas){
  if(kelas === "Tinggi") return "badge-high";
  if(kelas === "Sedang") return "badge-medium";
  if(kelas === "Rendah") return "badge-low";
  return "badge-neutral";
}
