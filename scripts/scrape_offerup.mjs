// scripts/scrape_offerup.mjs
import { load } from 'cheerio';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;
const CITY = process.env.CITY || 'Calhoun';

// OfferUp search (~40mi around Calhoun GA). Tweak query to taste.
const SEARCH_URL =
  'https://offerup.com/search/?q=steel%20scrap%20OR%20metal%20drops%20OR%20offcuts&delivery_method=pickup&radius=40&location=Calhoun%2C%20GA';

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
    },
  });
  if (!res.ok) throw new Error(`OfferUp fetch failed: ${res.status}`);

  const html = await res.text();
  const $ = load(html);

  let items = [];

  // Strategy A: parse Next.js data blob if present
  const nextBlob = $('script#__NEXT_DATA__').first().html();
  if (nextBlob) {
    try {
      const json = JSON.parse(nextBlob);
      const flat = JSON.stringify(json?.props?.pageProps ?? {});
      const matches = [...flat.matchAll(
        /"title":"([^"]+)".{0,200}?"price":"([^"]*)".{0,200}?"permalink":"([^"]+)"/g
      )];
      for (const m of matches) {
        items.push({
          title: m[1],
          price: parsePrice(m[2]),
          url: `https://offerup.com${m[3]}`,
        });
      }
    } catch {
      // fall through to Strategy B
    }
  }

  // Strategy B: scrape anchors/cards
  if (items.length === 0) {
    $('a[href*="/item/detail/"]').each((_i, el) => {
      const href = $(el).attr('href');
      const title =
        $(el).find('[data-testid="listing-card-title"]').text().trim() ||
        $(el).attr('title') ||
        'OfferUp listing';
      const price = parsePrice(
        $(el).find('[data-testid="listing-card-price"]').text()
      );
      if (href) {
        items.push({
          title,
          price,
          url: new URL(href, 'https://offerup.com').toString(),
        });
      }
    });
  }

  // Dedupe by URL
  const seen = new Set();
  items = items.filter((x) => {
    if (!x.url || seen.has(x.url)) return false;
    seen.add(x.url);
    return true;
  });

  let tried = 0;
  let inserted = 0;

  for (const it of items) {
    tried++;
    const hash = crypto
      .createHash('sha256')
      .update(`offerup|${it.url}`)
      .digest('hex');

    // Use 'manual' to satisfy your current CHECK constraint
    const { error } = await supabase.from('listings').insert({
      source: 'manual', // change to 'offerup' after altering CHECK constraint if desired
      city: CITY,
      title: it.title || 'OfferUp listing',
      url: it.url,
      price: it.price ?? null,
      hash,
    });

    if (!error) inserted++;
  }

  console.log(JSON.stringify({ ok: true, source: 'offerup', tried, inserted }));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, source: 'offerup', error: err.message }));
  process.exit(1);
});
