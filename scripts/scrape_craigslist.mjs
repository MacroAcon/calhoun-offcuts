// scripts/scrape_craigslist.mjs
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Your feed
const RSS_URL = 'https://nwga.craigslist.org/search/maa?format=rss';

// Public RSS→JSON gateway (free, rate-limited). You can swap to another later.
const GATEWAY = 'https://api.rss2json.com/v1/api.json?rss_url=' + encodeURIComponent(RSS_URL);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function run() {
  const res = await fetch(GATEWAY, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'Accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Gateway fetch failed: ${res.status}`);
  const json = await res.json();

  if (!json || !Array.isArray(json.items)) {
    throw new Error('Gateway returned unexpected format');
  }

  let tried = 0, inserted = 0;

  for (const item of json.items) {
    tried++;
    const title = item.title ?? '';
    const url = item.link ?? '';
    if (!url) continue;

    // Craigslist sometimes sticks price in title like "$50 steel plate"
    const priceMatch = title.match(/\$(\d+[\.,]?\d*)/);
    const price = priceMatch ? Number(priceMatch[1].replace(',', '')) : null;

    const hash = crypto.createHash('sha256').update(`craigslist|${url}`).digest('hex');

    const { error } = await supabase.from('listings').insert({
      source: 'craigslist',
      city: CITY,
      title,
      url,
      price,
      hash
    });

    if (!error) inserted++;
  }

  console.log(JSON.stringify({ ok: true, tried, inserted }));
}

run().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
