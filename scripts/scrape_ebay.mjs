// scripts/scrape_ebay.mjs
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

// eBay search: newly listed near ZIP 30701 (≈Calhoun), 60 per page
const SEARCH_URL =
  'https://www.ebay.com/sch/i.html?_nkw=metal+scrap+offcuts+drops&_sop=10&_ipg=60&_stpos=30701&_sadis=75&rt=nc';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

function cleanText(s = '') {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}
function parsePrice(str = '') {
  const m = String(str).replace(/[, ]/g, '').match(/\$?([0-9]+(?:\.[0-9]+)?)/);
  return m ? Number(m[1]) : null;
}
async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html',
      'Referer': 'https://www.ebay.com/'
    }
  });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return await res.text();
}

async function run() {
  // 1) Get search HTML
  const html = await fetchHtml(SEARCH_URL);

  // 2) Collect /itm/ links
  const linkMatches = [...html.matchAll(/https?:\/\/www\.ebay\.com\/itm\/[^"'\s<>{}]+/gi)];
  const urls = Array.from(new Set(linkMatches.map(m => m[0]))).slice(0, 30); // cap to 30 per run

  let tried = 0, inserted = 0;

  // 3) Fetch each item page and extract title/price
  for (const url of urls) {
    tried++;
    let title = 'eBay listing';
    let price = null;

    try {
      const page = await fetchHtml(url);

      // Try several title strategies
      const mH1 = page.match(/<h1[^>]*>([\s\S]{5,200}?)<\/h1>/i);
      const mTitle = page.match(/<title>([\s\S]{5,200}?)<\/title>/i);
      title = cleanText(mH1?.[1] || mTitle?.[1] || title);

      // Try several price strategies (JSON and DOM)
      const mJsonPrice = page.match(/"price"\s*:\s*"([0-9]+(?:\.[0-9]+)?)"/i);
      const mMetaPrice = page.match(/itemprop="price"[^>]*content="([0-9]+(?:\.[0-9]+)?)"/i);
      const mSpanPrice = page.match(/class="[^"]*price[^"]*"[^>]*>([^<]{1,40})</i);
      price =
        (mJsonPrice && Number(mJsonPrice[1])) ||
        (mMetaPrice && Number(mMetaPrice[1])) ||
        (mSpanPrice && parsePrice(mSpanPrice[1])) ||
        null;
    } catch {
      // If an item fetch fails, skip it quietly
      continue;
    }

    const hash = crypto.createHash('sha256').update(`ebay|${url}`).digest('hex');

    // keep 'manual' to satisfy your current CHECK constraint
    const { error } = await supabase.from('listings').insert({
      source: 'manual',
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
