#!/usr/bin/env node
/* FireSentry — sinkronisasi AQI Pekanbaru dari IQAir AirVisual API.
 * API key hanya dibaca dari GitHub Secret IQAIR_API_KEY dan TIDAK pernah
 * ditulis ke frontend. Community API IQAir menyediakan AQI US + cuaca;
 * konsentrasi PM2.5 hanya tersedia pada paket API tertentu, jadi bila
 * field PM2.5 tidak tersedia dashboard tetap dapat memakai WAQI untuk
 * konsentrasi PM2.5 dan menghitung AQI PM2.5 dengan breakpoint EPA.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const key = process.env.IQAIR_API_KEY || '';
const url = 'https://api.airvisual.com/v2/city?city=Pekanbaru&state=Riau&country=Indonesia&key=' + encodeURIComponent(key);
const out = path.join(process.cwd(), 'data', 'air-quality-pekanbaru.json');

async function main(){
  if(!key){
    console.log('[IQAir] IQAIR_API_KEY belum diisi; file AQI tidak diperbarui. Dashboard akan memakai fallback WAQI.');
    return;
  }
  const res = await fetch(url);
  if(!res.ok) throw new Error(`IQAir HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if(json.status !== 'success' || !json.data?.current) throw new Error('Respons IQAir tidak valid: ' + JSON.stringify(json));
  const d = json.data;
  const p = d.current.pollution || {};
  const w = d.current.weather || {};
  const result = {
    source: 'IQAir AirVisual API',
    city: d.city || 'Pekanbaru',
    state: d.state || 'Riau',
    country: d.country || 'Indonesia',
    aqi: Number.isFinite(Number(p.aqius)) ? Number(p.aqius) : null,
    aqiScale: 'US AQI',
    mainPollutant: p.mainus || null,
    pm25: Number.isFinite(Number(p.pm25)) ? Number(p.pm25) : null,
    temperature: Number.isFinite(Number(w.tp)) ? Number(w.tp) : null,
    humidity: Number.isFinite(Number(w.hu)) ? Number(w.hu) : null,
    windSpeed: Number.isFinite(Number(w.ws)) ? Number(w.ws) * 3.6 : null,
    windDirection: Number.isFinite(Number(w.wd)) ? Number(w.wd) : null,
    measuredAt: p.ts || w.ts || null,
    fetchedAt: new Date().toISOString(),
    note: 'AQI US dari IQAir. PM2.5 hanya diisi bila paket API mengembalikan konsentrasi PM2.5.'
  };
  await mkdir(path.dirname(out), {recursive:true});
  await writeFile(out, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log('[IQAir] tersimpan:', result);
}
main().catch(err=>{ console.error('[IQAir] gagal:', err.message); process.exit(1); });
