// scripts/scrape_craigslist.mjs
import Parser from 'rss-parser';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const FEED_URL = 'https://nwga.craigslist.org/search/maa?format=rss';

const SUPABASE_URL = process.env.SUPABASE_URL;            // set in GitHub Secrets
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE; // set in GitHub Secrets
const CITY = process.env.CITY || 'Calhoun';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function fetchRss() {
  // try direct with browser-like headers; if blocked, throw (we’ll still run on Actions IPs)
  const res = await fetch(FEED_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://nwga.craigslist.org/search/maa',
    }
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

async function run() {
  const parser = new Parser();
  const xml = await fetchRss();
  const feed = await parser.parseString(xml);

  let tried = 0, inserted = 0;

  for (const item of feed.items ?? []) {
    tried++;
    const title = item.title ?? '';
    const url = item.link ?? '';
    if (!url) continue;

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
