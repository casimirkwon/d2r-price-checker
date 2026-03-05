import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// diablo2.io topic ID mapping (item name → topic ID = pricecheck ID)
let d2ioTopics = {};
try {
  d2ioTopics = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'd2io-topics.json'), 'utf-8'));
} catch { /* will be populated on first use */ }

// diablo2.io stat filter URL param mapping
const D2IO_STAT_PARAMS = {
  mf: 'magicfind', ed: 'ed', fcr: 'fcr', frw: 'frw',
  fhr: 'fhr', ias: 'ias', allRes: 'resists', life: 'life', mana: 'mana',
};

// Traderie property ID mapping (stat key → prop ID)
const TRADERIE_PROPS = {
  allSkills: 587, allRes: 441, fireRes: 427, coldRes: 426,
  lightRes: 428, poisonRes: 401, life: 418, mana: 400,
  mf: 461, ias: 457, ed: 510, fhr: 430, pdr: 413,
};

/**
 * Look up price data from diablo2.io, D2Trader.net, ChaossCube + generate Traderie link
 */
export async function lookupPrice(itemNameEn, baseTypeEn, stats, options = {}) {
  const { ladder = false, itemNameKo, baseTypeKo, ethereal, sockets } = options;

  const lookups = [
    lookupD2io(itemNameEn, { ladder, ethereal, sockets }),
    lookupD2Trader(itemNameEn, { ethereal }),
  ];
  if (itemNameKo || baseTypeKo) {
    lookups.push(lookupChaoscube(itemNameKo, baseTypeKo, ladder, { ethereal, sockets }));
  }

  const results = await Promise.allSettled(lookups);

  const d2io = results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message };
  const d2trader = results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message };
  const chaoscube = results[2]?.status === 'fulfilled' ? results[2].value : (results[2] ? { error: results[2].reason?.message } : { error: '한국어 아이템명 없음' });

  // Generate Traderie filtered URL
  const traderie = {
    url: generateTraderieUrl(itemNameEn, { ladder, ethereal, sockets, stats }),
  };

  // Generate d2io filtered URL with stat params (for user to click)
  if (d2io.url && stats) {
    d2io.filteredUrl = buildD2ioFilteredUrl(d2io.url, stats);
  }

  // Stat comparison from D2Trader
  let statComparison = null;
  if (d2trader.itemAttrs && stats) {
    statComparison = compareStats(stats, d2trader.itemAttrs);
  }

  return { itemNameEn, d2io, d2trader, chaoscube, traderie, statComparison };
}

// --- Traderie link generation ---

function generateTraderieUrl(itemNameEn, options = {}) {
  const { ladder, ethereal, sockets, stats } = options;
  const params = new URLSearchParams();
  params.set('search', itemNameEn);
  params.set('prop_Platform', 'PC');
  params.set('prop_Mode', 'softcore');
  if (ladder) params.set('prop_Ladder', 'true');
  if (ethereal) params.set('prop_Ethereal', 'true');
  if (sockets != null && sockets > 0) {
    params.set('prop_402Min', String(sockets));
    params.set('prop_402Max', String(sockets));
  }
  if (stats) {
    for (const [key, stat] of Object.entries(stats)) {
      if (stat.value === undefined || key === 'sockets') continue;
      const propId = TRADERIE_PROPS[key];
      if (propId) params.set(`prop_${propId}Min`, String(stat.value));
    }
  }
  return `https://traderie.com/diablo2resurrected/products?${params}`;
}

// --- diablo2.io ---

async function lookupD2io(itemNameEn, options = {}) {
  const { ladder = false, ethereal, sockets } = options;

  let pricecheckId = d2ioTopics[itemNameEn];

  // Try case-insensitive search if not found
  if (!pricecheckId) {
    const lower = itemNameEn.toLowerCase();
    for (const [name, id] of Object.entries(d2ioTopics)) {
      if (name.toLowerCase() === lower) {
        pricecheckId = id;
        break;
      }
    }
  }

  if (!pricecheckId) {
    // Try refreshing the topic index
    await refreshD2ioTopics();
    pricecheckId = d2ioTopics[itemNameEn];
  }

  if (!pricecheckId) {
    return { error: 'diablo2.io에서 아이템을 찾을 수 없습니다', searchUrl: `https://diablo2.io/database/?q=${encodeURIComponent(itemNameEn)}` };
  }

  // Build URL with ethereal/socket filter params
  const params = new URLSearchParams();
  params.set('item', String(pricecheckId));
  params.set('ladder', ladder ? '1' : '0');
  params.set('legacy_resu', '2');
  if (ethereal) params.set('eth', '1');
  if (sockets != null && sockets > 0) params.set('imaxsockets', String(sockets));

  const pcUrl = `https://diablo2.io/pricecheck.php?${params}`;

  const res = await fetch(pcUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: 10000 });
  const html = await res.text();

  // Parse price entries
  const trades = parseD2ioTrades(html);

  return {
    url: pcUrl,
    trades,
    tradeCount: trades.length,
    priceRange: summarizePrices(trades),
  };
}

/**
 * Build d2io URL with stat filters included (for user to click and refine)
 */
function buildD2ioFilteredUrl(baseUrl, stats) {
  try {
    const url = new URL(baseUrl);
    for (const [key, paramName] of Object.entries(D2IO_STAT_PARAMS)) {
      if (stats[key]?.value) {
        url.searchParams.set(paramName, String(stats[key].value));
      }
    }
    return url.toString();
  } catch {
    return baseUrl;
  }
}

async function refreshD2ioTopics() {
  try {
    const res = await fetch('https://diablo2.io/liveSearch/topic/0/0/0', {
      headers: { 'User-Agent': USER_AGENT },
      timeout: 10000,
    });
    const raw = await res.text();
    const data = JSON.parse(raw);

    const items = {};
    // Unique/set items (z-uniques-title)
    for (const [, name, id] of data.matchAll(/z-uniques-title">(.*?)<\/span>.*?zs-id">(\d+)<\/div>/g)) {
      items[name.trim()] = parseInt(id);
    }
    // Base items (z-bone)
    for (const [, name, id] of data.matchAll(/z-bone">(.*?)<\/span>.*?zs-id">(\d+)<\/div>/g)) {
      const n = name.trim();
      if (!items[n]) items[n] = parseInt(id);
    }
    // Base items (z-white) — common runeword bases like Archon Plate, Monarch, etc.
    for (const [, name, id] of data.matchAll(/z-white">(.*?)<\/span>.*?zs-id">(\d+)<\/div>/g)) {
      const n = name.trim();
      if (!items[n]) items[n] = parseInt(id);
    }

    d2ioTopics = items;

    // Save to disk for next startup
    const { writeFileSync } = await import('fs');
    writeFileSync(path.join(__dirname, '..', 'data', 'd2io-topics.json'), JSON.stringify(items), 'utf-8');
    console.log(`Refreshed diablo2.io topic index: ${Object.keys(items).length} items`);
  } catch (err) {
    console.error('Failed to refresh d2io topics:', err.message);
  }
}

function parseD2ioTrades(html) {
  const trades = [];
  const $ = cheerio.load(html);

  // Each price entry is a z-pc-li element
  $('li.z-pc-li, [class*="z-pc-li"]').each((_, el) => {
    const $el = $(el);
    const priceDesc = $el.find('.z-price-desc').text().trim();
    const dateText = $el.find('.z-relative-date').text().trim();

    if (!priceDesc) return;

    const trade = {
      priceText: priceDesc.substring(0, 200),
      date: dateText,
      runeValue: extractRuneValue(priceDesc),
    };
    trades.push(trade);
  });

  // Fallback: regex parse if cheerio couldn't find elements
  if (trades.length === 0) {
    const priceDescs = html.match(/z-price-desc">([\s\S]*?)<\/div>/g);
    if (priceDescs) {
      for (const pd of priceDescs) {
        const text = pd.replace(/<[^>]+>/g, '').replace(/z-price-desc">/, '').trim();
        if (text) {
          trades.push({
            priceText: text.substring(0, 200),
            runeValue: extractRuneValue(text),
          });
        }
      }
    }
  }

  return trades;
}

// Rune value hierarchy (in Ist runes, approximate)
const RUNE_VALUES = {
  'El': 0, 'Eld': 0, 'Tir': 0, 'Nef': 0, 'Eth': 0, 'Ith': 0, 'Tal': 0, 'Ral': 0,
  'Ort': 0, 'Thul': 0, 'Amn': 0, 'Sol': 0, 'Shael': 0, 'Dol': 0, 'Hel': 0,
  'Io': 0, 'Lum': 0, 'Ko': 0.1, 'Fal': 0.1, 'Lem': 0.2,
  'Pul': 0.25, 'Um': 0.5, 'Mal': 0.75, 'Ist': 1, 'Gul': 2,
  'Vex': 4, 'Ohm': 6, 'Lo': 8, 'Sur': 10, 'Ber': 16,
  'Jah': 14, 'Cham': 3, 'Zod': 6,
};

function extractRuneValue(text) {
  const cleaned = text.replace(/<[^>]+>/g, ' ').trim();

  // Find the highest-value rune mentioned in the text
  let best = null;
  for (const [rune, val] of Object.entries(RUNE_VALUES)) {
    if (val < 0.1) continue; // Skip trivial runes
    const patterns = [
      new RegExp(`(\\d+)\\s*[x×]?\\s*${rune}\\b`, 'i'),
      new RegExp(`${rune}\\s*[x×]?\\s*(\\d+)`, 'i'),
      new RegExp(`\\b${rune}\\b`, 'i'),
    ];

    for (const pat of patterns) {
      const match = cleaned.match(pat);
      if (match) {
        const count = match[1] ? parseInt(match[1]) : 1;
        const istValue = val * count;
        if (!best || istValue > best.istValue) {
          best = { rune, count, istValue };
        }
        break; // Found this rune, check remaining runes for higher value
      }
    }
  }
  return best;
}

function summarizePrices(trades) {
  const valued = trades.filter(t => t.runeValue && t.runeValue.istValue > 0);
  if (valued.length === 0) return null;

  const istValues = valued.map(t => t.runeValue.istValue);
  const min = Math.min(...istValues);
  const max = Math.max(...istValues);
  const avg = istValues.reduce((a, b) => a + b, 0) / istValues.length;

  // Find most common rune denomination
  const runeCounts = {};
  for (const t of valued) {
    const key = `${t.runeValue.count} ${t.runeValue.rune}`;
    runeCounts[key] = (runeCounts[key] || 0) + 1;
  }
  const mostCommon = Object.entries(runeCounts).sort((a, b) => b[1] - a[1])[0];

  return {
    minIst: min,
    maxIst: max,
    avgIst: Math.round(avg * 10) / 10,
    sampleCount: valued.length,
    mostCommonPrice: mostCommon ? mostCommon[0] : null,
  };
}

// --- D2Trader.net ---

async function lookupD2Trader(itemNameEn, options = {}) {
  const { ethereal } = options;
  const slug = itemNameEn.toLowerCase()
    .replace(/['']s\b/g, 's')  // possessive: 's → s
    .replace(/['']/g, '')       // other apostrophes
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  // Try unique, set, runeword in parallel
  const categories = ['unique', 'set', 'runeword'];

  const attempts = categories.map(async cat => {
    const prefix = cat === 'runeword' ? 'item/runeword' : `item/${cat}`;

    // If ethereal, try ethereal variant first
    if (ethereal) {
      try {
        const ethUrl = `https://d2trader.net/${prefix}/ethereal-${slug}-price/`;
        const result = await fetchD2TraderPage(ethUrl, cat);
        result.isEthereal = true;
        return result;
      } catch {
        // Fall through to normal variant
      }
    }

    return fetchD2TraderPage(`https://d2trader.net/${prefix}/${slug}-price/`, cat);
  });

  const results = await Promise.allSettled(attempts);
  // Prefer unique > set > runeword
  for (const r of results) {
    if (r.status === 'fulfilled') return r.value;
  }

  return { error: 'D2Trader.net에서 아이템을 찾을 수 없습니다' };
}

async function fetchD2TraderPage(url, cat) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
    timeout: 8000,
  });
  if (!res.ok) throw new Error('not found');

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
  if (!match) throw new Error('no data');

  const nextData = JSON.parse(match[1]);
  const page = nextData?.props?.pageProps?.page;
  if (!page) throw new Error('no page');

  return {
    url,
    itemName: page.item_name,
    itemPrice: page.item_price,
    itemAttrs: page.item_details?.item_attrs || [],
    itemVariants: page.item_variants || [],
    category: cat,
  };
}

// --- ChaossCube (chaoscube.co.kr) ---

const CC_API = 'https://api.chaoscube.co.kr';
const CC_WEB = 'https://www.chaoscube.co.kr';

// Cache binding keys to avoid creating a new one every request (TTL: 10 minutes)
const ccBindingCache = new Map();
const CC_CACHE_TTL = 10 * 60 * 1000;

/**
 * Search ChaossCube: try unique name first, fall back to base type name
 */
async function lookupChaoscube(itemNameKo, baseTypeKo, ladder = false, filters = {}) {
  // Try unique name first
  if (itemNameKo) {
    const result = await searchChaoscube(itemNameKo, ladder, filters);
    if (result.priceRange || (result.listings && result.listings.length > 0)) {
      return result;
    }
  }

  // Fall back to base type name if unique name didn't find anything
  if (baseTypeKo && baseTypeKo !== itemNameKo) {
    const result = await searchChaoscube(baseTypeKo, ladder, filters);
    if (result.priceRange || (result.listings && result.listings.length > 0)) {
      return result;
    }
  }

  return { error: 'ChaossCube에서 아이템을 찾을 수 없습니다' };
}

async function searchChaoscube(keyword, ladder = false, filters = {}) {
  const { ethereal, sockets } = filters;
  const searchConfig = {
    d2REXGameType: 'REIGN_OF_THE_WARLOCK',
    d2REXPlatformType: 'PC',
    d2REXServerLocation: 'ASIA',
    d2REXLadderType: ladder ? 'LADDER' : 'NON_LADDER',
    d2REXGameModeType: 'SOFTCORE',
    isOnline: true,
    onSalesBasicStatus: 'IN_PROGRESS_SALE',
    pageable: { page: 0, size: 30 },
    sortable: { column: 'create_date', direction: 'DESC' },
    socketCounts: sockets ? [sockets] : [],
    keyword,
  };
  if (ethereal) searchConfig.isEthereal = true;

  // Step 1: Create search params → get binding key (with cache)
  const cacheKey = `${keyword}:${ladder}:s${sockets || ''}:e${ethereal || ''}`;
  const cached = ccBindingCache.get(cacheKey);
  let bindingKey;

  if (cached && Date.now() - cached.time < CC_CACHE_TTL) {
    bindingKey = cached.key;
  } else {
    const createRes = await fetch(CC_API + '/add-item-condition-search-params', {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        'Origin': CC_WEB,
        'Referer': CC_WEB + '/',
      },
      body: JSON.stringify({ paramsJsonStr: JSON.stringify(searchConfig) }),
      timeout: 10000,
    });
    const createData = await createRes.json();
    bindingKey = createData.rval?.bindingKey;
    if (!bindingKey) {
      return { error: 'ChaossCube 검색 파라미터 생성 실패' };
    }
    ccBindingCache.set(cacheKey, { key: bindingKey, time: Date.now() });
  }

  // Step 2: Fetch SSR page with binding key
  const pageRes = await fetch(`${CC_WEB}/exchange/list/${bindingKey}`, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000,
  });
  const html = await pageRes.text();

  const nuxtMatch = html.match(/window\.__NUXT__\s*=(.*?)(?:<\/script>)/s);
  if (!nuxtMatch) {
    return { error: 'ChaossCube 페이지 파싱 실패' };
  }

  // Parse __NUXT__ data (Nuxt SSR embeds data as a JS expression)
  let nuxtData;
  try {
    nuxtData = new Function('return ' + nuxtMatch[1])();
  } catch {
    return { error: 'ChaossCube NUXT 데이터 파싱 실패' };
  }

  const d = nuxtData.data?.[0];
  if (!d?.items?.length) {
    return { error: 'ChaossCube에서 아이템을 찾을 수 없습니다', url: `${CC_WEB}/exchange/list/${bindingKey}` };
  }

  // Filter: only keep items whose name/preset/tags actually contain the keyword
  const kw = keyword.toLowerCase();
  const matched = d.items.filter(item => {
    const fields = [item.name, item.preset, item.title, ...(item.tags || [])].filter(Boolean);
    return fields.some(f => f.toLowerCase().includes(kw));
  });

  if (matched.length === 0) {
    return { error: 'ChaossCube에서 아이템을 찾을 수 없습니다', url: `${CC_WEB}/exchange/list/${bindingKey}` };
  }

  const listings = matched.map(item => ({
    name: item.name || item.preset,
    baseType: item.title || null,
    rarity: item.rarity,
    priceCP: item.amount,
    ethereal: item.ethereal || false,
  }));

  const prices = listings.map(l => l.priceCP).filter(p => p > 0);
  const priceRange = prices.length > 0 ? {
    minCP: Math.min(...prices),
    maxCP: Math.max(...prices),
    avgCP: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    count: prices.length,
  } : null;

  return {
    url: `${CC_WEB}/exchange/list/${bindingKey}`,
    listings: listings.slice(0, 10),
    total: d.total,
    priceRange,
    ladder,
  };
}

// --- Stat Comparison ---

function compareStats(userStats, itemAttrs) {
  const comparison = [];

  // Map D2Trader attr placeholders to our stat keys
  const attrMapping = {
    'Enhanced Defense': 'ed',
    'Enhanced Damage': 'ed',
    'Faster Run/Walk': 'frw',
    'Magic Find': 'mf',
    'Better Chance': 'mf',
    'All Skills': 'allSkills',
    'All Resistances': 'allRes',
    'Faster Cast Rate': 'fcr',
    'Increased Attack Speed': 'ias',
    'Faster Hit Recovery': 'fhr',
    'Strength': 'str',
    'Vitality': 'vit',
    'Dexterity': 'dex',
    'Energy': 'energy',
    'Life': 'life',
    'Mana': 'mana',
    'Attacker Takes': 'thorns',
    'Crushing Blow': 'cb',
    'Life Stolen': 'lifeLeech',
    'Mana Stolen': 'manaLeech',
    'Fire Resist': 'fireRes',
    'Cold Resist': 'coldRes',
    'Lightning Resist': 'lightRes',
    'Poison Resist': 'poisonRes',
  };

  for (const attr of itemAttrs) {
    if (!attr.values?.[0]?.varies) continue; // Only compare variable stats

    const placeholder = attr.placeholder || '';
    let statKey = null;

    for (const [keyword, key] of Object.entries(attrMapping)) {
      if (placeholder.includes(keyword)) {
        statKey = key;
        break;
      }
    }

    if (!statKey || !userStats[statKey]) continue;

    const range = attr.values[0];
    const userVal = userStats[statKey].value;

    if (userVal !== undefined && range.min !== undefined && range.max !== undefined) {
      const rangeSpan = range.max - range.min;
      const quality = rangeSpan > 0
        ? Math.round(((userVal - range.min) / rangeSpan) * 100)
        : 100;

      comparison.push({
        stat: userStats[statKey].label || statKey,
        userValue: userVal,
        min: range.min,
        max: range.max,
        quality, // 0% = worst roll, 100% = perfect
        isPerfect: userVal >= range.max,
      });
    }
  }

  return comparison;
}
