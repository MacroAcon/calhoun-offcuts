// scripts/scrape_ebay.mjs
import { load } from 'cheerio';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

// eBay HTML search (newly listed, 60 per page, around Calhoun ZIP 30701)
// Tweak keywords anytime.
const SEARCH_URL =
  'https://www.ebay.com/sch/i.html?_nkw=metal+scrap+offcuts+drops&_sop=10&_ipg=60&_stpos=30701&_sadis=75&rt=nc';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function parsePrice(str = '') {
  const m = String(str).replace(/[, ]/g, '').match(/\$?([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
}

async function run() {
  const res = await fetch(SEARCH_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html',
      'Referer': 'https://www.ebay.com/'
    }
  });
  if (!res.ok) throw new Error(`eBay fetch failed: ${res.status}`);

  const html = await res.text();
  const $ = load(html);

  let items = [];
  $('#srp-river-results li.s-item').each((_i, el) => {
    const a = $(el).find('a.s-item__link');
    const url = a.attr('href');
    const title = $(el).find('.s-item__title').text().trim();
    const price = parsePrice($(el).find('.s-item__price').text());

    if (url && title && url.includes('/itm/')) {
      items.push({ title, url, price });
    }
  });

  // dedupe by URL
  const seen = new Set();
  items = items.filter(x => {
    if (!x.url || seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });

  let tried = 0, inserted = 0;
  for (const it of items) {
    tried++;
    const hash = crypto.createHash('sha256').update(`ebay|${it.url}`).digest('hex');

    // keep 'manual' to satisfy your current CHECK constraint
    const { error } = await supabase.from('listings').insert({
      source: 'manual',
      city: CITY,
      title: it.title || 'eBay listing',
      url: it.url,
      price: it.price ?? null,
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
