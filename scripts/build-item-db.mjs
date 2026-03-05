/**
 * Crawl D2Trader.net sitemap and build a local item stats database.
 * Extracts variable stat ranges (min/max) for unique, set, and runeword items.
 *
 * Usage: node scripts/build-item-db.mjs
 * Output: data/item-db.json
 */

import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CONCURRENCY = 5;
const DELAY_MS = 200;

async function fetchItemSlugs() {
  const res = await fetch('https://d2trader.net/sitemap.xml', { headers: { 'User-Agent': UA } });
  const xml = await res.text();
  const urls = xml.match(/https:\/\/d2trader\.net\/item\/[^<]+/g) || [];
  // Filter out ethereal variants (separate pages for same item)
  return urls.filter(u => !u.includes('/ethereal-'));
}

async function fetchItemData(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, timeout: 15000 });
  if (!res.ok) return null;
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) return null;

  const data = JSON.parse(match[1]);
  const page = data.props?.pageProps?.page;
  if (!page) return null;

  const details = page.item_details;
  if (!details) return null;

  const quality = details.item_quality; // unique, set, runeword
  const category = url.match(/\/item\/(unique|set|runeword)\//)?.[1];

  // Extract variable stats with their ranges
  const variableStats = [];
  const allStats = [];

  for (const attr of (details.item_attrs || [])) {
    if (!attr.placeholder || !attr.values?.length) continue;

    const val = attr.values[0];
    const stat = {
      id: attr.id,
      name: attr.placeholder.replace(/\{[^}]*\}/g, '#'),
      type: attr.type,
      min: val.min,
      max: val.max,
      varies: val.varies === 1,
    };

    allStats.push(stat);
    if (val.varies === 1 && val.min !== val.max) {
      variableStats.push(stat);
    }
  }

  // Base stats (defense, damage, etc.)
  const baseStats = [];
  for (const attr of (details.item_base_attrs || [])) {
    if (!attr.placeholder || !attr.values?.length) continue;
    const val = attr.values[0];
    baseStats.push({
      name: attr.placeholder.replace(/\{[^}]*\}/g, '#'),
      min: val.min,
      max: val.max,
    });
  }

  return {
    name: details.item_name,
    quality: category || quality,
    baseName: details.item_base_name || null,
    baseType: details.item_base_type || null,
    variableStats,
    allStats,
    baseStats,
    slug: url.match(/\/item\/[^/]+\/(.+?)-price\/?$/)?.[1] || null,
  };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Fetching sitemap...');
  const urls = await fetchItemSlugs();
  console.log(`Found ${urls.length} items (excluding ethereal variants)`);

  const items = {};
  let done = 0;
  let failed = 0;

  // Process in batches
  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(url => fetchItemData(url))
    );

    for (const result of results) {
      done++;
      if (result.status === 'fulfilled' && result.value) {
        const item = result.value;
        items[item.name] = item;
      } else {
        failed++;
      }
    }

    if (done % 50 === 0 || done === urls.length) {
      console.log(`Progress: ${done}/${urls.length} (${failed} failed)`);
    }

    await sleep(DELAY_MS);
  }

  // Save
  const outDir = path.join(__dirname, '..', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'item-db.json');
  writeFileSync(outPath, JSON.stringify(items, null, 2));

  // Summary
  const byQuality = {};
  const withVariable = Object.values(items).filter(i => i.variableStats.length > 0);
  for (const item of Object.values(items)) {
    byQuality[item.quality] = (byQuality[item.quality] || 0) + 1;
  }
  console.log(`\nSaved ${Object.keys(items).length} items to ${outPath}`);
  console.log('By quality:', byQuality);
  console.log(`Items with variable stats: ${withVariable.length}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
