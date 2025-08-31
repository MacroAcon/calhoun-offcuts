// scripts/scrape_ebay.mjs
import Parser from 'rss-parser';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

// Simple eBay search RSS (newly listed first via &_sop=10). Tweak keywords anytime.
const RSS_URL = 'https://www.ebay.com/sch/i.html?_nkw=metal+scrap+offcuts+drops&_sop=10&_rss=1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function parsePrice(str = '') {
  const m = String(str).replace(',', '').match(/\$?\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
}

async function run() {
  const parser = new Parser();
  // fetch with headers then parse to dodge occasional 403s
  const res = await fetch(RSS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'application/rss+xml,text/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`eBay fetch failed: ${res.status}`);
  const xml = await res.text();
  const feed = await parser.parseString(xml);

  let tried = 0, inserted = 0;

  for (const item of feed.items ?? []) {
    tried++;
    const title = item.title ?? '';
    const url = item.link ?? '';
    if (!url) continue;

    // eBay RSS sometimes includes price in title or snippet
    const sniff = [title, item.contentSnippet, item.content].filter(Boolean).join(' • ');
    const price = parsePrice(sniff);

    const hash = crypto.createHash('sha256').update(`ebay|${url}`).digest('hex');

    const { error } = await supabase.from('listings').insert({
      source: 'manual', // keep as 'manual' to satisfy your CHECK; we can add 'ebay' later
      city: CITY,
      title,
      url,
      price,
      hash
    });

    if (!error) inserted++;
  }

  console.log(JSON.stringify({ ok: true, source: 'ebay', tried, inserted }));
}

run().catch(err => {
  console.error(JSON.stringify({ ok: false, source: 'ebay', error: err.message }));
  process.exit(1);
});
