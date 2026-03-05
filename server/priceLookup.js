import * as cheerio from 'cheerio';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Local item database (stat ranges for uniques, sets, runewords)
let itemDb = {};
try {
  itemDb = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'item-db.json'), 'utf-8'));
  console.log(`Loaded item DB: ${Object.keys(itemDb).length} items`);
} catch { /* will work without it */ }

// diablo2.io topic ID mapping (item name → topic ID = pricecheck ID)
let d2ioTopics = {};
try {
  d2ioTopics = JSON.parse(readFileSync(path.join(__dirname, '..', 'data', 'd2io-topics.json'), 'utf-8'));
} catch { /* will be populated on first use */ }

// diablo2.io stat filter URL param mapping (for filtered link only)
const D2IO_STAT_PARAMS = {
  mf: 'magicfind', ed: 'ed', fcr: 'fcr', frw: 'frw',
  fhr: 'fhr', ias: 'ias', allRes: 'resists', life: 'life', mana: 'mana',
};

// Traderie property ID mapping (for filtered link only)
const TRADERIE_PROPS = {
  allSkills: 587, allRes: 441, fireRes: 427, coldRes: 426,
  lightRes: 428, poisonRes: 401, life: 418, mana: 400,
  mf: 461, ias: 457, ed: 510, fhr: 430, pdr: 413,
};

// ChaossCube modifier ID → our stat key
const CC_MOD_TO_KEY = {
  7: 'defense', 47: 'ed', 48: 'ed', 50: 'addsDmg', 51: 'str', 52: 'dex', 53: 'vit',
  54: 'energy', 55: 'mana', 56: 'life', 60: 'ias', 61: 'fcr', 62: 'fhr',
  65: 'frw', 66: 'cb', 69: 'pdr', 70: 'lifeLeech', 71: 'manaLeech',
  73: 'allSkills', 74: 'allAttr', 75: 'allRes', 76: 'fireRes', 77: 'coldRes',
  78: 'lightRes', 80: 'poisonRes', 92: 'thorns', 94: 'mf', 183: 'slowerStamina',
  200: 'enemyColdRes', 201: 'enemyFireRes', 202: 'enemyLightRes', 203: 'enemyPoisonRes',
};

// Stat display labels
const STAT_LABELS = {
  ed: 'ED%', mf: 'MF%', frw: 'FRW%', fcr: 'FCR%', ias: 'IAS%', fhr: 'FHR%',
  allSkills: '올스킬', allRes: '전저항', allAttr: '전능력치',
  str: '힘', vit: '활력', dex: '민첩', energy: '에너지',
  life: '생명력', mana: '마나', cb: '크러싱', thorns: '반사피해',
  pdr: '물리감소%', lifeLeech: '생흡%', manaLeech: '마흡%',
  slowerStamina: '지구력', defense: '방어력', addsDmg: '추가피해', minDmg: '최소피해', maxDmg: '최대피해',
  enemyLightRes: '적번저', enemyFireRes: '적화저', enemyColdRes: '적냉저', enemyPoisonRes: '적독저',
  lifePerKill: '킬당생명', manaPerKill: '킬당마나',
  coldAbsorb: '냉흡수', fireAbsorb: '화흡수', lightAbsorb: '번흡수',
};

/**
 * Look up price data from diablo2.io, D2Trader.net, ChaossCube.
 * Search by name only (no stat/attribute filters), then compare user's item
 * against market listings to gauge value.
 */
export async function lookupPrice(itemNameEn, baseTypeEn, stats, options = {}) {
  const { ladder = false, itemNameKo, baseTypeKo, ethereal, sockets } = options;

  const lookups = [
    lookupD2io(itemNameEn, { ladder }),
    lookupD2Trader(itemNameEn),
  ];
  if (itemNameKo || baseTypeKo) {
    lookups.push(lookupChaoscube(itemNameKo, baseTypeKo, ladder));
  }

  const results = await Promise.allSettled(lookups);

  const d2io = results[0].status === 'fulfilled' ? results[0].value : { error: results[0].reason?.message };
  const d2trader = results[1].status === 'fulfilled' ? results[1].value : { error: results[1].reason?.message };
  const chaoscube = results[2]?.status === 'fulfilled' ? results[2].value : (results[2] ? { error: results[2].reason?.message } : { error: '한국어 아이템명 없음' });

  // Generate filtered links for user reference (these HAVE attribute filters)
  const traderie = {
    url: generateTraderieUrl(itemNameEn, { ladder, ethereal, sockets, stats }),
  };
  if (d2io.url) {
    d2io.filteredUrl = buildD2ioFilteredUrl(d2io.url, { stats, ethereal, sockets });
  }

  // Stat quality comparison: prefer local DB, fallback to D2Trader
  let statComparison = null;
  let perfectAnalysis = null;
  if (stats) {
    const localResult = compareWithLocalDb(itemNameEn, stats);
    if (localResult) {
      statComparison = localResult.comparison;
      perfectAnalysis = localResult.perfectAnalysis;
    } else if (d2trader.itemAttrs) {
      statComparison = compareStats(stats, d2trader.itemAttrs);
    }
  }

  // Market comparison: compare user's item against CC listings
  let marketComparison = null;
  if (chaoscube.listings && chaoscube.listings.length > 0 && stats) {
    marketComparison = buildMarketComparison(chaoscube.listings, stats, { ethereal, sockets });
  }

  return { itemNameEn, d2io, d2trader, chaoscube, traderie, statComparison, perfectAnalysis, marketComparison };
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
  const { ladder = false } = options;

  let pricecheckId = d2ioTopics[itemNameEn];

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
    await refreshD2ioTopics();
    pricecheckId = d2ioTopics[itemNameEn];
  }

  if (!pricecheckId) {
    return { error: 'diablo2.io에서 아이템을 찾을 수 없습니다', searchUrl: `https://diablo2.io/database/?q=${encodeURIComponent(itemNameEn)}` };
  }

  // Search by name + ladder only (no attribute filters)
  const pcUrl = `https://diablo2.io/pricecheck.php?item=${pricecheckId}&ladder=${ladder ? '1' : '0'}&legacy_resu=2`;

  const res = await fetch(pcUrl, { headers: { 'User-Agent': USER_AGENT }, timeout: 10000 });
  const html = await res.text();
  const trades = parseD2ioTrades(html);

  return {
    url: pcUrl,
    trades,
    tradeCount: trades.length,
    priceRange: summarizePrices(trades),
  };
}

/**
 * Build d2io URL with all filters (eth, sockets, stats) for user to click
 */
function buildD2ioFilteredUrl(baseUrl, options = {}) {
  const { stats, ethereal, sockets } = options;
  try {
    const url = new URL(baseUrl);
    if (ethereal) url.searchParams.set('eth', '1');
    if (sockets != null && sockets > 0) url.searchParams.set('imaxsockets', String(sockets));
    if (stats) {
      for (const [key, paramName] of Object.entries(D2IO_STAT_PARAMS)) {
        if (stats[key]?.value) {
          url.searchParams.set(paramName, String(stats[key].value));
        }
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
    for (const [, name, id] of data.matchAll(/z-uniques-title">(.*?)<\/span>.*?zs-id">(\d+)<\/div>/g)) {
      items[name.trim()] = parseInt(id);
    }
    for (const [, name, id] of data.matchAll(/z-bone">(.*?)<\/span>.*?zs-id">(\d+)<\/div>/g)) {
      const n = name.trim();
      if (!items[n]) items[n] = parseInt(id);
    }
    for (const [, name, id] of data.matchAll(/z-white">(.*?)<\/span>.*?zs-id">(\d+)<\/div>/g)) {
      const n = name.trim();
      if (!items[n]) items[n] = parseInt(id);
    }

    d2ioTopics = items;
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

  $('li.z-pc-li, [class*="z-pc-li"]').each((_, el) => {
    const $el = $(el);
    const priceDesc = $el.find('.z-price-desc').text().trim();
    const dateText = $el.find('.z-relative-date').text().trim();
    if (!priceDesc) return;
    trades.push({
      priceText: priceDesc.substring(0, 200),
      date: dateText,
      runeValue: extractRuneValue(priceDesc),
    });
  });

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
  let best = null;
  for (const [rune, val] of Object.entries(RUNE_VALUES)) {
    if (val < 0.1) continue;
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
        break;
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

async function lookupD2Trader(itemNameEn) {
  const slug = itemNameEn.toLowerCase()
    .replace(/['']s\b/g, 's')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const categories = ['unique', 'set', 'runeword'];

  const attempts = categories.map(async cat => {
    const prefix = cat === 'runeword' ? 'item/runeword' : `item/${cat}`;
    return fetchD2TraderPage(`https://d2trader.net/${prefix}/${slug}-price/`, cat);
  });

  const results = await Promise.allSettled(attempts);
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
const ccBindingCache = new Map();
const CC_CACHE_TTL = 10 * 60 * 1000;

/**
 * Search ChaossCube by name only. No attribute filters.
 */
async function lookupChaoscube(itemNameKo, baseTypeKo, ladder = false) {
  const keyword = itemNameKo || baseTypeKo;
  if (!keyword) return { error: 'ChaossCube에서 아이템을 찾을 수 없습니다' };
  return searchChaoscube(keyword, ladder);
}

async function searchChaoscube(keyword, ladder = false) {
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
    keyword,
  };

  const cacheKey = `${keyword}:${ladder}`;
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

  const pageRes = await fetch(`${CC_WEB}/exchange/list/${bindingKey}`, {
    headers: { 'User-Agent': USER_AGENT },
    timeout: 15000,
  });
  const html = await pageRes.text();

  const nuxtMatch = html.match(/window\.__NUXT__\s*=(.*?)(?:<\/script>)/s);
  if (!nuxtMatch) {
    return { error: 'ChaossCube 페이지 파싱 실패' };
  }

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

  const kw = keyword.toLowerCase();
  const matched = d.items.filter(item => {
    const fields = [item.name, item.preset, item.title, ...(item.tags || [])].filter(Boolean);
    return fields.some(f => f.toLowerCase().includes(kw));
  });

  if (matched.length === 0) {
    return { error: 'ChaossCube에서 아이템을 찾을 수 없습니다', url: `${CC_WEB}/exchange/list/${bindingKey}` };
  }

  // Extract rich listing data with stats
  const listings = matched.map(item => {
    const listing = {
      name: item.name || item.preset,
      baseType: item.title || null,
      rarity: item.rarity,
      priceCP: item.amount,
      ethereal: item.ethereal || false,
      socket: item.socket || 0,
      detailUrl: item.id ? `${CC_WEB}/exchange/detail/${item.id}` : null,
      thumb: item.thumb || null,
    };

    // Extract stats from magicInfo (unique/magic properties)
    const stats = {};
    const allInfo = [...(item.magicInfo || []), ...(item.baseInfo || [])];
    for (const mod of allInfo) {
      const key = CC_MOD_TO_KEY[mod.id];
      if (key && mod.value != null) {
        stats[key] = mod.value;
      }
    }
    listing.stats = stats;

    // Full stat list for detail popup
    listing.allStats = allInfo
      .filter(mod => mod.label && mod.value != null)
      .map(mod => ({ label: mod.label, value: mod.value }));

    return listing;
  });

  const prices = listings.map(l => l.priceCP).filter(p => p > 0);
  const priceRange = prices.length > 0 ? {
    minCP: Math.min(...prices),
    maxCP: Math.max(...prices),
    avgCP: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    count: prices.length,
  } : null;

  return {
    url: `${CC_WEB}/exchange/list/${bindingKey}`,
    listings: listings.slice(0, 20),
    total: d.total,
    priceRange,
    ladder,
  };
}

// --- Market Comparison ---

/**
 * Compare user's item against ChaossCube market listings.
 * Finds variable stats, estimates value range based on similar listings.
 */
function buildMarketComparison(listings, userStats, userProps = {}) {
  // Convert user stats to flat { key: value } map
  const userFlat = {};
  for (const [key, stat] of Object.entries(userStats)) {
    if (stat.value !== undefined) userFlat[key] = stat.value;
  }

  const userEthereal = userProps.ethereal || false;
  const userSockets = userProps.sockets || 0;

  // Find stats to display: UNION of user stats and listing stats
  // Shows listing-only stats too (user value will be '-')
  const listingStatKeys = new Set();
  for (const l of listings) {
    if (l.stats) Object.keys(l.stats).forEach(k => listingStatKeys.add(k));
  }

  // Include user stats that appear in listings + listing stats that appear frequently
  const variableStats = [];
  const userKeys = new Set(Object.keys(userFlat));
  for (const key of listingStatKeys) {
    // Count how many listings have this stat
    const count = listings.filter(l => l.stats?.[key] != null).length;
    // Include if: user has it, OR at least 30% of listings have it
    if (userKeys.has(key) || count >= listings.length * 0.3) {
      variableStats.push(key);
    }
  }

  // Sort: prioritize commonly used trade stats
  const statPriority = ['defense', 'mf', 'ed', 'allSkills', 'allRes', 'allAttr', 'fcr', 'ias', 'fhr', 'frw',
    'str', 'vit', 'dex', 'life', 'mana', 'cb', 'enemyLightRes', 'enemyFireRes', 'enemyColdRes',
    'lifeLeech', 'manaLeech', 'thorns', 'pdr', 'addsDmg', 'minDmg', 'maxDmg'];
  variableStats.sort((a, b) => {
    const ai = statPriority.indexOf(a);
    const bi = statPriority.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Limit to top 6 variable stats for display
  const displayStats = variableStats.slice(0, 6);

  // Build comparison entries per listing
  const compListings = listings
    .filter(l => l.priceCP > 0)
    .map(l => {
      const entry = {
        name: l.name || null,
        baseType: l.baseType || null,
        priceCP: l.priceCP,
        ethereal: l.ethereal,
        socket: l.socket,
        detailUrl: l.detailUrl || null,
        thumb: l.thumb || null,
        allStats: l.allStats || [],
        stats: {},
      };
      for (const key of displayStats) {
        entry.stats[key] = l.stats?.[key] ?? null;
      }
      return entry;
    })
    .sort((a, b) => a.priceCP - b.priceCP);

  // Group by variant (ethereal x socket count)
  const sameVariant = compListings.filter(l =>
    (!!l.ethereal) === userEthereal && (l.socket || 0) === userSockets
  );
  const otherVariant = compListings.filter(l =>
    (!!l.ethereal) !== userEthereal || (l.socket || 0) !== userSockets
  );

  // User's stats for the display columns (null for stats user doesn't have)
  const userDisplayStats = {};
  for (const key of displayStats) {
    userDisplayStats[key] = userFlat[key] ?? null;
  }

  // Estimate value range from same-variant listings preferentially
  let estimatedRange = null;
  const estimationPool = sameVariant.length >= 2 ? sameVariant : compListings;

  if (estimationPool.length >= 2 && displayStats.length > 0) {
    // Score each listing by how similar its stats are to the user's
    const scored = estimationPool.map(l => {
      let totalDiff = 0;
      let compared = 0;
      for (const key of displayStats) {
        const userVal = userFlat[key];
        const listVal = l.stats[key];
        if (userVal != null && listVal != null) {
          const allVals = listings.map(x => x.stats?.[key]).filter(v => v != null);
          const range = Math.max(...allVals) - Math.min(...allVals);
          if (range > 0) {
            totalDiff += Math.abs(userVal - listVal) / range;
            compared++;
          }
        }
      }
      let similarity = compared > 0 ? 1 - (totalDiff / compared) : 0;

      // Penalize ethereal mismatch heavily
      if ((!!l.ethereal) !== userEthereal) {
        similarity *= 0.3;
      }
      // Penalize socket count mismatch
      const socketDiff = Math.abs((l.socket || 0) - userSockets);
      if (socketDiff > 0) {
        similarity *= Math.max(0.5, 1 - socketDiff * 0.2);
      }

      return { ...l, similarity };
    });

    // Take top 5 most similar listings
    scored.sort((a, b) => b.similarity - a.similarity);
    const similar = scored.slice(0, Math.min(5, scored.length)).filter(s => s.similarity > 0.3);

    if (similar.length > 0) {
      const simPrices = similar.map(s => s.priceCP);
      estimatedRange = {
        minCP: Math.min(...simPrices),
        maxCP: Math.max(...simPrices),
        avgCP: Math.round(simPrices.reduce((a, b) => a + b, 0) / simPrices.length),
        count: similar.length,
      };
    }
  }

  return {
    displayStats: displayStats.map(k => ({ key: k, label: STAT_LABELS[k] || k })),
    listings: sameVariant,
    otherVariantListings: otherVariant,
    userStats: userDisplayStats,
    userEthereal,
    userSockets,
    estimatedRange,
    variantLabel: `${userEthereal ? '무형' : '비무형'} ${userSockets}소켓`,
  };
}

// --- Stat Quality / Perfect Analysis (Local DB) ---

// Map D2Trader placeholder keywords to our stat keys
const PLACEHOLDER_TO_KEY = {
  'Enhanced Defense': 'ed',
  'Enhanced Damage': 'ed',
  'Faster Run/Walk': 'frw',
  'Better Chance': 'mf',
  'Magic Find': 'mf',
  'All Skills': 'allSkills',
  'All Resistances': 'allRes',
  'Faster Cast Rate': 'fcr',
  'Increased Attack Speed': 'ias',
  'Faster Hit Recovery': 'fhr',
  'Strength': 'str',
  'Vitality': 'vit',
  'Dexterity': 'dex',
  'Energy': 'energy',
  'to Life': 'life',
  'to Mana': 'mana',
  'Attacker Takes': 'thorns',
  'Crushing Blow': 'cb',
  'Life Stolen': 'lifeLeech',
  'Mana Stolen': 'manaLeech',
  'Fire Resist': 'fireRes',
  'Cold Resist': 'coldRes',
  'Lightning Resist': 'lightRes',
  'Poison Resist': 'poisonRes',
  'Damage Reduced': 'pdr',
  'All Attributes': 'allAttr',
  'Defense (Based on': 'defense',
  'Defense:': 'defense',
  '+# Defense': 'defense',
  'Damage +': 'addsDmg',
  'Enemy Poison Resist': 'enemyPoisonRes',
  'Enemy Fire Resist': 'enemyFireRes',
  'Enemy Cold Resist': 'enemyColdRes',
  'Enemy Lightning Resist': 'enemyLightRes',
  'Life after each Kill': 'lifePerKill',
  'Mana after each Kill': 'manaPerKill',
  'Absorbs Cold': 'coldAbsorb',
  'Absorbs Fire': 'fireAbsorb',
  'Absorbs Lightning': 'lightAbsorb',
  'Maximum Damage': 'maxDmg',
  'Minimum Damage': 'minDmg',
};

function placeholderToStatKey(placeholder) {
  for (const [keyword, key] of Object.entries(PLACEHOLDER_TO_KEY)) {
    if (placeholder.includes(keyword)) return key;
  }
  return null;
}

function formatPlaceholder(name) {
  // Clean up D2Trader placeholder to readable short label
  return name
    .replace(/\+?\{[^}]*\}/g, '')
    .replace(/\+?#/g, '')
    .replace(/\(Based on Character Level\)/gi, '(레벨비례)')
    .replace(/\s+/g, ' ')
    .replace(/^\s*%?\s*/, '')
    .replace(/\s*%?\s*$/, '')
    .trim() || name;
}

/**
 * Compare user's item stats against local item DB ranges.
 * Returns stat quality comparison and perfect analysis.
 */
function findInItemDb(itemNameEn) {
  if (!itemNameEn) return null;
  // Exact match
  if (itemDb[itemNameEn]) return itemDb[itemNameEn];
  // Case-insensitive match
  const lower = itemNameEn.toLowerCase();
  for (const [name, item] of Object.entries(itemDb)) {
    if (name.toLowerCase() === lower) return item;
  }
  // Partial match for runewords with variants: "Spirit" → "Spirit (Shield)" or "Spirit (Weapon)"
  const candidates = [];
  for (const [name, item] of Object.entries(itemDb)) {
    if (name.startsWith(itemNameEn + ' (') || name.toLowerCase().startsWith(lower + ' (')) {
      candidates.push(item);
    }
  }
  // If multiple variants, prefer armor/shield over weapon (more commonly price-checked)
  if (candidates.length > 0) {
    return candidates.find(c => c.baseName && /shield|monarch|plate|armor/i.test(c.baseName))
      || candidates[0];
  }
  return null;
}

function compareWithLocalDb(itemNameEn, userStats) {
  const item = findInItemDb(itemNameEn);
  if (!item) return null;
  const comparison = [];

  // Check variable magic stats
  for (const dbStat of item.variableStats) {
    const statKey = placeholderToStatKey(dbStat.name);
    if (!statKey || !userStats[statKey]) continue;

    const userVal = userStats[statKey].value;
    if (userVal === undefined) continue;

    const rangeSpan = dbStat.max - dbStat.min;
    const quality = rangeSpan > 0
      ? Math.round(((userVal - dbStat.min) / rangeSpan) * 100)
      : 100;

    comparison.push({
      stat: userStats[statKey].label || STAT_LABELS[statKey] || statKey,
      statKey,
      userValue: userVal,
      min: dbStat.min,
      max: dbStat.max,
      quality: Math.max(0, Math.min(100, quality)),
      isPerfect: userVal >= dbStat.max,
    });
  }

  // Check base stat (defense) if user has it and no variable defense stat already matched
  const hasDefenseComparison = comparison.some(c => c.statKey === 'defense');
  if (userStats.defense && !hasDefenseComparison && item.baseStats.length > 0) {
    const defStat = item.baseStats.find(s => s.name.startsWith('Defense'));
    if (defStat && defStat.min !== defStat.max) {
      const userVal = userStats.defense.value;
      if (userVal !== undefined) {
        const rangeSpan = defStat.max - defStat.min;
        const quality = rangeSpan > 0
          ? Math.round(((userVal - defStat.min) / rangeSpan) * 100)
          : 100;

        comparison.push({
          stat: '방어력',
          statKey: 'defense',
          userValue: userVal,
          min: defStat.min,
          max: defStat.max,
          quality: Math.max(0, Math.min(100, quality)),
          isPerfect: userVal >= defStat.max,
        });
      }
    }
  }

  if (comparison.length === 0) return null;

  // Perfect analysis
  const totalStats = comparison.length;
  const perfectCount = comparison.filter(c => c.isPerfect).length;
  const avgQuality = Math.round(comparison.reduce((sum, c) => sum + c.quality, 0) / totalStats);
  const isPerfect = perfectCount === totalStats && totalStats > 0;

  // Build full stat reference (fixed + variable) for "으뜸 스펙" display
  const perfectSpec = [];
  const hasVariableDefense = item.variableStats.some(s => placeholderToStatKey(s.name) === 'defense');

  // Add base defense at top if variable and no variable defense in allStats
  if (!hasVariableDefense) {
    const baseDef = item.baseStats.find(s => s.name.startsWith('Defense'));
    if (baseDef && baseDef.min !== baseDef.max) {
      perfectSpec.push({
        label: '방어력',
        max: baseDef.max,
        min: baseDef.min,
        varies: true,
        userValue: userStats.defense ? userStats.defense.value : null,
      });
    }
  }

  for (const s of item.allStats) {
    const statKey = placeholderToStatKey(s.name);
    const label = (statKey && STAT_LABELS[statKey]) || formatPlaceholder(s.name);
    perfectSpec.push({
      label,
      max: s.max,
      varies: s.varies,
      userValue: statKey && userStats[statKey] ? userStats[statKey].value : null,
    });
  }

  return {
    comparison,
    perfectAnalysis: {
      itemName: itemNameEn,
      quality: item.quality,
      baseName: item.baseName || null,
      isPerfect,
      avgQuality,
      perfectCount,
      totalStats,
      grade: isPerfect ? '으뜸' : avgQuality >= 90 ? '상' : avgQuality >= 70 ? '중상' : avgQuality >= 50 ? '중' : avgQuality >= 30 ? '중하' : '하',
      perfectSpec,
    },
  };
}

// --- Stat Comparison (D2Trader ranges, fallback) ---

function compareStats(userStats, itemAttrs) {
  const comparison = [];

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
    if (!attr.values?.[0]?.varies) continue;

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
        quality,
        isPerfect: userVal >= range.max,
      });
    }
  }

  return comparison;
}
