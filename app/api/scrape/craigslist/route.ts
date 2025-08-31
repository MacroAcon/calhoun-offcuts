import { NextResponse } from 'next/server';
import Parser from 'rss-parser';
import crypto from 'node:crypto';
import { supabase } from '@/lib/supabaseAdmin';

const FEED_URL = 'https://nwga.craigslist.org/search/maa?format=rss';
const FALLBACK = 'https://r.jina.ai/http://nwga.craigslist.org/search/maa?format=rss'; // read-only fetch mirror

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function fetchRssText() {
  // Try direct first with browser-like headers
  const res = await fetch(FEED_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Accept': 'application/rss+xml,text/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://nwga.craigslist.org/search/maa',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    }
  });

  if (res.ok) return res.text();

  // Fallback: public read-only mirror (often bypasses 403 on simple reads)
  const fb = await fetch(FALLBACK, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/plain' }
  });
  if (!fb.ok) throw new Error(`Both direct and fallback failed: ${res.status} / ${fb.status}`);
  return fb.text();
}

export async function GET() {
  try {
    const xml = await fetchRssText();

    // Parse RSS (works with both direct and fallback text)
    const parser = new Parser();
    const feed = await parser.parseString(xml);

    let tried = 0;
    let inserted = 0;

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
        city: 'Calhoun',
        title,
        url,
        price,
        hash
      });

      if (!error) inserted++;
    }

    return NextResponse.json({ ok: true, tried, inserted });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
