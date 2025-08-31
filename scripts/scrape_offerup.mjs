// scripts/scrape_offerup.mjs
import { load } from 'cheerio';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

/**
 * Simpler, broader query. "OR" often doesn't work in OfferUp's q param.
 * Increase radius and keep pickup-only.
 */
const SEARCH_URL =
  'https://offerup.com/search/?q=metal%20scrap&radius=60&delivery_method=pickup&location=Calhoun%2C%20GA';

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
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html',
      'Referer': 'https://offerup.com/'
    }
  });
  if (!res.ok) throw new Error(`OfferUp fetch failed: ${res.status}`);

  const html = await res.text();
  const $ = load(html);

  let items = [];

  // Strategy A: Next.js data blob
  const nextBlob = $('script#__NEXT_DATA__').first().html();
  if (nextBlob) {
    try {
      const data = JSON.parse(nextBlob);
      const flat = JSON.stringify(data?.props?.pageProps ?? {});
      // Try to capture title/price/permalink triplets from embedded JSON
      const matches = [...flat.matchAll(
        /"title":"([^"]{3,80})".{0,200}?"price":"([^"]*)".{0,200}?"permalink":"([^"]+)"/g
      )];
      for (const m of matches) {
        items.push({
          title: m[1],
          price: parsePrice(m[2]),
          url: `https://offerup.com${m[3]}`
        });
      }
    } catch {
      // fall through
    }
  }

  // Strategy B: DOM anchors/cards (multiple selector fallbacks)
  if (items.length === 0) {
    $('a[href*="/item/detail/"]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      // try a few possible title/price locations
      const title =
        $(el).find('[data-testid="listing-card-title"]').text().trim() ||
        $(el).find('[data-testid="item-title"]').text().trim() ||
        $(el).attr('title') ||
        'OfferUp listing';

      const price =
        parsePrice($(el).find('[data-testid="listing-card-price"]').text()) ??
        parsePrice($(el).find('[data-testid="item-price"]').text()) ??
        null;

      items.push({
        title,
        price,
        url: new URL(href, 'https://offerup.com').toString()
      });
    });
  }

  // Dedupe by URL
  const seen = new Set();
  items = items.filter(x => {
    if (!x.url || seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });

  let tried = 0, inserted = 0;
  for (const it of items) {
    tried++;
    const hash = crypto.createHash('sha256').update(`offerup|${it.url}`).digest('hex');

    // keep 'manual' to satisfy your current CHECK constraint
    const { error } = await supabase.from('listings').insert({
      source: 'manual',
      city: CITY,
      title: it.title || 'OfferUp listing',
      url: it.url,
      price: it.price ?? null,
      hash
    });

    if (!error) inserted++;
  }

  // Always succeed so the schedule keeps running; log if empty for debugging
  console.log(JSON.stringify({
    ok: true,
    source: 'offerup',
    tried,
    inserted,
    note: items.length === 0 ? 'no results parsed (query too narrow or DOM changed)' : undefined
  }));
}

run().catch(err => {
  // Still exit non-zero on genuine network/HTTP errors so we notice
  console.error(JSON.stringify({ ok: false, source: 'offerup', error: err.message }));
  process.exit(1);
});
