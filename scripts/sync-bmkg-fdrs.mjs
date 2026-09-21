#!/usr/bin/env node
/* FireSentry — sinkronisasi metadata FDRS BMKG (FFMC + FWI).
 *
 * BMKG mempublikasikan FDRS resmi sebagai peta gambar, bukan endpoint angka
 * publik yang stabil. Karena itu FireSentry TIDAK mengarang nilai numerik dari
 * warna peta. Script ini menyimpan URL observasi resmi, waktu sinkronisasi,
 * dan definisi kategori BMKG sebagai sinyal konfirmasi/konteks EWS.
 *
 * Jika BMKG nantinya menyediakan endpoint numerik FDRS, field ffmc/fwi di file
 * ini dapat diisi tanpa mengubah mesin EWS lainnya.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const out = path.join(process.cwd(), 'data', 'bmkg-fdrs.json');
const sources = {
  pageFfmc: 'https://www.bmkg.go.id/cuaca/karhutla/ffmc',
  pageFwi: 'https://www.bmkg.go.id/cuaca/karhutla/fwi',
  imageFfmcObservation: 'https://dataweb.bmkg.go.id/cuaca/spartan/36_indonesia_ffmc_obs.png',
  imageFwiObservation: 'https://dataweb.bmkg.go.id/cuaca/spartan/36_indonesia_fwi_obs.png'
};

async function check(url){
  const r = await fetch(url, {method:'GET'});
  if(!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r;
}

async function main(){
  // Pastikan sumber resmi masih hidup. Kita tidak menyimpan ulang gambar BMKG
  // supaya repo tidak membengkak dan hak/atribusi sumber tetap jelas.
  const checks = {};
  for(const [name,url] of Object.entries(sources)){
    try{
      const r = await check(url);
      checks[name] = {ok:true, contentType:r.headers.get('content-type') || null};
    }catch(e){
      checks[name] = {ok:false, error:e.message};
    }
  }

  const result = {
    source: 'BMKG SPARTAN / Fire Danger Rating System',
    wilayah: 'Indonesia — digunakan sebagai konteks resmi untuk Riau/Pekanbaru',
    fetchedAt: new Date().toISOString(),
    numericValuesAvailable: false,
    ffmc: null,
    fwi: null,
    ffmcInterpretation: [
      {range:'0–72', level:'Rendah', description:'Bahan bakar ringan relatif basah dan sulit terbakar.'},
      {range:'73–77', level:'Sedang', description:'Bahan bakar ringan lembap dan cukup sulit terbakar.'},
      {range:'78–82', level:'Tinggi', description:'Bahan bakar ringan kering dan mudah terbakar.'},
      {range:'>82', level:'Sangat Tinggi', description:'Bahan bakar ringan sangat kering dan sangat mudah terbakar.'}
    ],
    fwiInterpretation: [
      {range:'0–1', level:'Rendah', description:'Intensitas api rendah.'},
      {range:'2–6', level:'Sedang', description:'Intensitas api sedang.'},
      {range:'7–13', level:'Tinggi', description:'Intensitas api tinggi.'},
      {range:'>13', level:'Sangat Tinggi', description:'Intensitas api sangat tinggi.'}
    ],
    sources,
    checks,
    note: 'FFMC/FWI BMKG dipakai sebagai indikator meteorologis resmi tambahan. Karena BMKG saat ini mempublikasikannya sebagai peta, FireSentry tidak menebak nilai numerik dari warna peta. Nilai risiko utama tetap dihitung dari BMKG cuaca + NASA FIRMS, sedangkan FDRS menjadi konfirmasi/konteks sampai tersedia feed numerik resmi.'
  };

  await mkdir(path.dirname(out), {recursive:true});
  await writeFile(out, JSON.stringify(result,null,2)+'\n','utf8');
  console.log('[BMKG FDRS] metadata tersimpan:', out);
}

main().catch(e=>{console.error('[BMKG FDRS] gagal:',e);process.exit(1);});
