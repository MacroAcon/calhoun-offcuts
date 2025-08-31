// scripts/normalize_listings.mjs
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// --- parsing helpers ---
function fracToNum(s) {
  const [a, b] = s.split('/').map(Number);
  return b ? a / b : Number(s);
}
function mmToIn(mm) {
  const n = Number(mm);
  return Number.isFinite(n) ? +(n / 25.4).toFixed(4) : undefined;
}
function parseThickness(t) {
  // 1/4", 0.25in, 6mm, 3/8 in
  const mFrac = t.match(/(\d+\/\d+)\s*(?:in|inch|")\b/i);
  if (mFrac) return fracToNum(mFrac[1]);
  const mDec = t.match(/(\d+(?:\.\d+)?)\s*(?:in|inch|")\b/i);
  if (mDec) return Number(mDec[1]);
  const mMM = t.match(/(\d+(?:\.\d+)?)\s*mm\b/i);
  if (mMM) return mmToIn(mMM[1]);
  return undefined;
}
function normalizeTitle(title) {
  const t = title.toLowerCase();

  const material =
    (t.match(/\b(a36|1018|1045|tool\s*steel|mild\s*steel|stainless|316|304|aluminum|aluminium|6061|5052|brass|copper)\b/) || [])[1];

  const shape =
    (t.match(/\b(plate|sheet|bar|flat\s*bar|round|rod|square|tube|square\s*tube|rectangular\s*tube|pipe|angle|channel|drops?|offcuts?)\b/) || [])[1];

  const thickness_in = parseThickness(t);

  return {
    material: material?.replace(/\s+/g, ' '),
    shape: shape?.replace(/\s+/g, ' '),
    thickness_in
  };
}

async function run() {
  // normalize most recent set (last 3 days) plus any rows missing fields
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();

  const { data: recent, error: e1 } = await supabase
    .from('listings')
    .select('id,title,material,shape,thickness_in')
    .or(`gte.first_seen.${since},is.material.null,is.shape.null,is.thickness_in.null`)
    .order('first_seen', { ascending: false })
    .limit(800);

  if (e1) {
    console.error(JSON.stringify({ ok: false, stage: 'select', error: e1.message }));
    process.exit(1);
  }

  let tried = 0, updated = 0;
  for (const row of recent ?? []) {
    tried++;
    const n = normalizeTitle(row.title || '');
    // Only update if we found something new
    const patch = {};
    if (n.material && !row.material) patch.material = n.material;
    if (n.shape && !row.shape) patch.shape = n.shape;
    if (n.thickness_in && !row.thickness_in) patch.thickness_in = n.thickness_in;

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await supabase.from('listings').update(patch).eq('id', row.id);
      if (!upErr) updated++;
    }
  }

  console.log(JSON.stringify({ ok: true, tried, updated }));
}

run().catch(err => {
  console.error(JSON.stringify({ ok: false, stage: 'catch', error: err.message }));
  process.exit(1);
});
