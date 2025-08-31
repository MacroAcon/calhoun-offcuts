// scripts/scrape_offerup.mjs
import cheerio from 'cheerio';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

// OfferUp search (pickup, ~40mi around Calhoun GA). Adjust query terms as needed.
const SEARCH_URL = 'https://offerup.com/search/?q=steel%20scrap%20OR%20metal%20drops%20OR%20offcuts&delivery_method=pickup&radius=40&location=Calhoun%2C%20GA';

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
  const res = await fetch(SEARCH_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });
  if (!res.ok) throw new Error(`OfferUp fetch failed: ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);

  let items = [];

  // Strategy A: Next.js payload (id="__NEXT_DATA__")
  const nextData = $('#__NEXT_DATA__').first().text();
  if (nextData) {
    try {
      const json = JSON.parse(nextData);
      // Heuristic path to listings array (OfferUp can change this)
      const props = json?.props?.pageProps || {};
      const candidates = JSON.stringify(props);
      const ids = [...candidates.matchAll(/"id":"([^"]+)","title":"([^"]+)".{0,120}?"price":"([^"]*)".{0,200}?"permalink":"([^"]+)"/g)];
      for (const m of ids) {
        items.push({
          title: m[2],
          price: parsePrice(m[3]),
          url: `https://offerup.com${m[4]}`
        });
      }
    } catch { /* fall back to Strategy B */ }
  }

  // Strategy B: DOM anchors
  if (items.length === 0) {
    $('a[href*="/item/detail/"]').each((_, el) => {
      const href = $(el).attr('href');
      const title = $(el).find('[data-testid="listing-card-title"]').text().trim() || $(el).attr('title') || 'OfferUp listing';
      const price = parsePrice($(el).find('[data-testid="listing-card-price"]').text());
      if (href) {
        items.push({
          title,
          price,
          url: new URL(href, 'https://offerup.com').toString()
        });
      }
    });
  }

  // Dedup by URL
  const seen = new Set();
  items = items.filter(x => {
    if (!x.url || seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });

  let tried = 0, inserted = 0;
  for (const it of items) {
    tried++;
    const hash
