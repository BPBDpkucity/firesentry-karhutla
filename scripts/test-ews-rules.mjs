// FireSentry EWS rule smoke test — no network calls.
const assert = (actual, expected, label) => { if (actual !== expected) throw new Error(`${label}: ${actual} !== ${expected}`); };

function status({hotspot, persistent, ffmc}) {
  const h = Number(hotspot || 0) > 0;
  const f = String(ffmc || '').toLowerCase();
  const high = f === 'tinggi' || f === 'sangat tinggi';
  if (persistent && f === 'sangat tinggi') return 'PERINGATAN';
  if ((h && high) || (persistent && h)) return 'SIAGA';
  if (h || high) return 'WASPADA';
  return 'NORMAL';
}

assert(status({hotspot:0,persistent:false,ffmc:'Rendah'}),'NORMAL','normal');
assert(status({hotspot:1,persistent:false,ffmc:null}),'WASPADA','hotspot');
assert(status({hotspot:1,persistent:true,ffmc:null}),'SIAGA','persistent');
assert(status({hotspot:1,persistent:false,ffmc:'Tinggi'}),'SIAGA','hotspot+ffmc');
assert(status({hotspot:1,persistent:true,ffmc:'Sangat Tinggi'}),'PERINGATAN','persistent+very-high');
console.log('FireSentry EWS rules: OK');
