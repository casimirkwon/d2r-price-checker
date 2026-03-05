import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mappingPath = path.join(__dirname, '..', 'data', 'item-mapping.json');
const rawMapping = JSON.parse(readFileSync(mappingPath, 'utf-8'));

// Clean mapping: strip trailing " *" or "*", exclude affixes (e.g., "of Guarding")
const ko_to_en = {};
for (const [ko, en] of Object.entries(rawMapping.ko_to_en)) {
  // Skip affixes/suffixes that cause false positives with OCR noise
  if (/^(of |the )/.test(en)) continue;
  ko_to_en[ko] = en;
  const cleaned = ko.replace(/\s*\*+$/, '');
  if (cleaned !== ko) ko_to_en[cleaned] = en;
}
const en_to_ko = rawMapping.en_to_ko;

// Supplementary mappings for items missing from D2R localization data
const EXTRA_MAPPINGS = {
  // Special/event items
  '애니힐러스': 'Annihilus',
  '기드의 행운': "Gheed's Fortune",
  '스몰 참': 'Small Charm',
  '라지 참': 'Large Charm',
  '그랜드 참': 'Grand Charm',
  '속죄의 토큰': 'Token of Absolution',
  '스킬 북': 'Book of Skill',
  '저항의 두루마리': 'Scroll of Resistance',

  // Sunder Charms
  '검은 균열': 'Black Cleft',
  '뼈 파괴': 'Bone Break',
  '냉기 파열': 'Cold Rupture',
  '하늘의 균열': 'Crack of the Heavens',
  '화염 균열': 'Flame Rift',
  '부패의 균열': 'Rotting Fissure',
  '잠재된 검은 균열': 'Latent Black Cleft',
  '잠재된 뼈 파괴': 'Latent Bone Break',
  '잠재된 냉기 파열': 'Latent Cold Rupture',
  '잠재된 하늘의 균열': 'Latent Crack of the Heavens',
  '잠재된 화염 균열': 'Latent Flame Rift',
  '잠재된 부패의 균열': 'Latent Rotting Fissure',
  '갱신된 검은 균열': 'Renewed Black Cleft',
  '갱신된 뼈 파괴': 'Renewed Bone Break',
  '갱신된 냉기 파열': 'Renewed Cold Rupture',
  '갱신된 하늘의 균열': 'Renewed Crack of the Heavens',
  '갱신된 화염 균열': 'Renewed Flame Rift',
  '갱신된 부패의 균열': 'Renewed Rotting Fissure',

  // Rainbow Facets
  '무지개 패싯': 'Rainbow Facet',
  '무지개 면': 'Rainbow Facet',

  // Runewords (commonly traded, missing from localization)
  '전투의 부름': 'Call To Arms',
  '보루': 'Bulwark',
  '허슬': 'Hustle',
  '변형': 'Metamorphosis',
  '모자이크': 'Mosaic',

  // Unique items missing from mapping
  '알리 바바의 검': 'Blade Of Ali Baba',
  '뼈톱 파괴자': 'Bonesaw Breaker',
  '공포의 송곳니': 'Dreadfang',
  '악의 세력': 'Bone Break',

  // Alternative D2R Korean names (transliterated vs translated)
  '헬파이어 토치': 'Hellfire Torch',
  '아라크니드 매쉬': 'Arachnid Mesh',
  '아라크니드 그물': 'Arachnid Mesh',
  '마라의 만화경': "Mara's Kaleidoscope",
  '샌드스톰 트렉': 'Sandstorm Trek',
  '워터워크': 'Waterwalk',
  '스킬러': 'Grand Charm',
  '에니그마': 'Enigma',
  '인피니티': 'Infinity',
  '그리프': 'Grief',
  '포티튜드': 'Fortitude',
  '체인즈 오브 아너': "Chains of Honor",
  '하트 오브 더 오크': 'Heart of the Oak',
  '콜 투 암스': 'Call To Arms',
  '드림': 'Dream',
  '스피릿': 'Spirit',
  '인사이트': 'Insight',

  // Gems (perfect/flawless)
  '완벽한 자수정': 'Perfect Amethyst',
  '완벽한 다이아몬드': 'Perfect Diamond',
  '완벽한 에메랄드': 'Perfect Emerald',
  '완벽한 루비': 'Perfect Ruby',
  '완벽한 사파이어': 'Perfect Sapphire',
  '완벽한 해골': 'Perfect Skull',
  '완벽한 토파즈': 'Perfect Topaz',
  '흠 없는 자수정': 'Flawless Amethyst',
  '흠 없는 다이아몬드': 'Flawless Diamond',
  '흠 없는 에메랄드': 'Flawless Emerald',
  '흠 없는 루비': 'Flawless Ruby',
  '흠 없는 사파이어': 'Flawless Sapphire',
  '흠 없는 해골': 'Flawless Skull',
  '흠 없는 토파즈': 'Flawless Topaz',
};
for (const [ko, en] of Object.entries(EXTRA_MAPPINGS)) {
  ko_to_en[ko] = en;
}

// Build an index for fuzzy matching: all Korean item names (min 2 chars)
const koNames = Object.keys(ko_to_en).filter(k => k.length >= 2);

/**
 * Levenshtein distance between two strings.
 */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Find the closest Korean item name match using fuzzy matching.
 * Returns { ko, en, distance } or null if no close match.
 */
function fuzzyMatch(input) {
  const cleaned = input.replace(/[^\uAC00-\uD7A3\s]/g, '').trim();
  if (cleaned.length < 3) return null;

  let best = null;
  let bestDist = Infinity;

  for (const ko of koNames) {
    // Skip very short dictionary entries (too many false positives)
    if (ko.length < 3) continue;
    // Quick length filter: skip if too different in length
    if (Math.abs(ko.length - cleaned.length) > 3) continue;

    const dist = levenshtein(cleaned, ko);
    // Stricter for short names, ~30% error for longer names
    const threshold = ko.length <= 4 ? 1 : Math.floor(ko.length * 0.3);
    if (dist < bestDist && dist <= threshold) {
      bestDist = dist;
      best = { ko, en: ko_to_en[ko], distance: dist };
    }
  }

  return best;
}

// Korean stat patterns from D2R tooltips
// OCR commonly confuses: 기→ㄱ|/ㄱl, 력→럭/럭, 확률→왁률/왁릉, 치→지, O→0, [→1
const STAT_PATTERNS = [
  { pattern: /방[어머버]력[:\s]*(\d+)/,                    key: 'defense',       label: 'Defense' },
  { pattern: /내구도[:\s]*(\d+)\s*\/\s*(\d+)/,            key: 'durability',    label: 'Durability' },
  { pattern: /필[요표]?\s*힘[:\s]*(\d+)/,                 key: 'reqStr',        label: 'Required Strength' },
  { pattern: /[요보]구\s*레벨[:\s]*(\d+)/,                key: 'reqLevel',      label: 'Required Level' },
  // FRW: 달리기/걷기 — OCR often renders 기 as ㄱ|, ㄱl, or similar
  { pattern: /[달담]리\s*[기ㄱ][|l]?\/[걷건곧끝][기ㄱ][|l]?\s*속도\s*[+*](\d+)%/, key: 'frw', label: 'Faster Run/Walk' },
  // ED: 방어력 +XXX% 증가 — OCR may prefix digits with [ or misread ? for digits
  { pattern: /방[어머버]력\s*[+*]\s*[[\]]?(\d[\d?]*\d)%\s*(?:증가|중가)/, key: 'ed', label: 'Enhanced Defense' },
  { pattern: /공격력\s*[+*]\s*[[\]]?(\d[\d?]*\d)%\s*(?:증가|중가)/,      key: 'ed', label: 'Enhanced Damage' },
  // MF: 확률 often OCR'd as 왁률, 학률, 왁릉, or totally garbled
  { pattern: /마법\s*아이템\s*발견\s*[^\d]*?(\d+)%\s*(?:증가|중가)?/, key: 'mf', label: 'Magic Find' },
  // Strength: 힘 +10 — OCR may render 10 as IO, lO, O
  { pattern: /힘\s*[+*]\s*(\d+)/,                         key: 'str',           label: 'Strength' },
  { pattern: /활력\s*[+*]\s*(\d+)/,                        key: 'vit',           label: 'Vitality' },
  { pattern: /민첩\s*[+*]\s*(\d+)/,                        key: 'dex',           label: 'Dexterity' },
  { pattern: /에너지\s*[+*]\s*(\d+)/,                      key: 'energy',        label: 'Energy' },
  // All Skills: 모든 기술/스킬 — OCR may garble 기술 as T=, 12, Td, NE
  { pattern: /모[든는]\s*(?:스킬|기술|NE|T[=d]|[기ㄱ][술슬]|le|[|l]e)\s*[+*](\d+)/, key: 'allSkills', label: 'All Skills' },
  // All Attributes: 모든 능력치 — OCR may render 치 as 지
  { pattern: /모든\s*능력[치지]\s*[+*](\d+)/,              key: 'allAttr',       label: 'All Attributes' },
  { pattern: /모든\s*저항\s*[+*](\d+)/,                    key: 'allRes',        label: 'All Resistances' },
  { pattern: /타격\s*시\s*(\d+)%\s*확률.*치명타/,           key: 'cb',            label: 'Crushing Blow' },
  { pattern: /시전\s*속도\s*[+*](\d+)%/,                   key: 'fcr',           label: 'Faster Cast Rate' },
  { pattern: /공격\s*(?:속도|AE)\s*[+*](\d+)%/,            key: 'ias',           label: 'Increased Attack Speed' },
  { pattern: /적중\s*(?:회복|외복)\s*(?:속도\s*)?[+*](\d+)%/, key: 'fhr',        label: 'Faster Hit Recovery' },
  { pattern: /생명력\s*[+*](\d+)/,                         key: 'life',          label: 'Life' },
  { pattern: /마나\s*[+*](\d+)/,                           key: 'mana',          label: 'Mana' },
  { pattern: /생명력\s*(\d+)%\s*(?:도둑질|EH)/,            key: 'lifeLeech',     label: 'Life Stolen Per Hit' },
  { pattern: /적중당\s*생명력\s*(\d+)%/,                   key: 'lifeLeech',     label: 'Life Stolen Per Hit' },
  { pattern: /마나\s*도둑질\s*(\d+)%/,                     key: 'manaLeech',     label: 'Mana Stolen Per Hit' },
  // Attacker Takes Damage: OCR may garble 피해를 as OSE, etc.
  { pattern: /공격자[가ㄱ]?\s*피해[를]?\s*(\d+)/,          key: 'thorns',        label: 'Attacker Takes Damage' },
  { pattern: /피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ][7ㄱ]?/,  key: 'addsDmg',       label: 'Adds Damage' },
  { pattern: /소켓\s*\((\d+)\)/,                           key: 'sockets',       label: 'Sockets' },
  { pattern: /홈\s*있음\s*\((\d+)\)/,                      key: 'sockets',       label: 'Sockets' },
  { pattern: /지구력.*?(\d+)%\s*감소/,                     key: 'slowerStamina', label: 'Slower Stamina Drain' },
  { pattern: /화염\s*저항\s*[+*](\d+)%/,                   key: 'fireRes',       label: 'Fire Resist' },
  { pattern: /냉기\s*저항\s*[+*](\d+)%/,                   key: 'coldRes',       label: 'Cold Resist' },
  { pattern: /번개\s*저항\s*[+*](\d+)%/,                   key: 'lightRes',      label: 'Lightning Resist' },
  { pattern: /독\s*저항\s*[+*](\d+)%/,                     key: 'poisonRes',     label: 'Poison Resist' },
  { pattern: /[받반]는\s*물리\s*피해\s*(\d+)%\s*감소/,      key: 'pdr',           label: 'Physical Damage Reduced' },
  { pattern: /마법\s*피해\s*(\d+)\s*감소/,                  key: 'mdr',           label: 'Magic Damage Reduced' },
  // Enemy resistance reduction (Griffon's, etc.)
  { pattern: /적의\s*번개\s*저[항깜]\s*-(\d+)%/,            key: 'enemyLightRes', label: 'Enemy Lightning Resist' },
  { pattern: /적의\s*화염\s*저항\s*-(\d+)%/,               key: 'enemyFireRes',  label: 'Enemy Fire Resist' },
  { pattern: /적의\s*냉기\s*저항\s*-(\d+)%/,               key: 'enemyColdRes',  label: 'Enemy Cold Resist' },
  // Skill damage bonus (Griffon's, Facets)
  { pattern: /번개\s*(?:\S*기술\s*)?피해\s*[+*](\d+)%/,     key: 'lightSkillDmg', label: 'Lightning Skill Damage' },
  { pattern: /화염\s*(?:\S*기술\s*)?피해\s*[+*](\d+)%/,     key: 'fireSkillDmg',  label: 'Fire Skill Damage' },
  { pattern: /냉기\s*(?:\S*기술\s*)?피해\s*[+*](\d+)%/,     key: 'coldSkillDmg',  label: 'Cold Skill Damage' },
  // Experience gain (Annihilus)
  { pattern: /경험[치지]?\s*획득[량랑]\s*[+*](\d+)%/,      key: 'expGain',       label: 'Experience Gained' },
];

/**
 * Parse OCR'd Korean text from a D2R item tooltip.
 * Returns identified item info with English mappings.
 */
export function parseItemText(text) {
  // Pre-clean OCR text: fix common OCR artifacts
  let cleaned = text
    .replace(/ㄱ[|l]/g, '기')    // ㄱ| or ㄱl → 기
    .replace(/[|l]술/g, '기술')   // |술 or l술 → 기술
    .replace(/\+O\b/g, '+10')    // +O → +10 (O misread as zero)
    .replace(/\*(\d)/g, '+$1')   // *N → +N
    .replace(/x(\d)/g, '+$1')    // xN → +N (x misread for +)
    .replace(/\[(\d)/g, '$1')    // [9 → 9 (bracket before digit)
    .replace(/(\d)\]/g, '$1')    // 9] → 9
    .replace(/왁[률릉룰]/g, '확률')  // 왁률 → 확률
    .replace(/학률/g, '확률')     // 학률 → 확률
    .replace(/능력지/g, '능력치') // 능력지 → 능력치
    .replace(/방버력/g, '방어력') // 방버력 → 방어력
    .replace(/저앙/g, '저항')     // 저앙 → 저항
    .replace(/저깜/g, '저항')     // 저깜 → 저항
    .replace(/적함/g, '저항')     // 적함 → 저항
    .replace(/[여버][앵행][자차]/g, '여행자') // 여앵자/버앵자 → 여행자
    .replace(/배들/g, '배틀')     // 배들 → 배틀
    .replace(/곧기/g, '걷기')     // 곧기 → 걷기
    .replace(/그리[폰픈]의/g, '그리폰의') // 그리픈의 → 그리폰의
    .replace(/할리[퀸킨][관곤]\s*모/g, '할리퀸 관모') // OCR variants
    .replace(/피애/g, '피해')     // 피애 → 피해
    .replace(/\*\+/g, '+')       // *+ → + (double prefix)
    .replace(/\+[|l](?=\s|$)/g, '+1') // +| or +l at end → +1
    .replace(/\b1기술/g, '기술');  // 1기술 → 기술 (stray digit)

  const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { error: '텍스트가 비어있습니다' };

  let itemNameKo = null;
  let itemNameEn = null;
  let baseTypeKo = null;
  let baseTypeEn = null;
  let itemQuality = 'unknown';
  const stats = {};

  // Try to identify item name and base type from lines
  // For noisy in-game screenshots, scan all lines (not just first 5)
  const maxLines = Math.min(lines.length, 15);
  for (let i = 0; i < maxLines; i++) {
    const line = lines[i];
    // Extract Korean-only text for matching (strip English, numbers, symbols)
    let cleaned = line.replace(/[^\uAC00-\uD7A3\s]/g, '').trim();
    // Strip common prefixes like (고급), (마법) etc. that OCR might partially capture
    cleaned = cleaned.replace(/^고급\s*/, '').trim();

    if (!cleaned || cleaned.length < 2) continue;

    // Try exact match first
    let en = ko_to_en[cleaned];
    let matchedKo = en ? cleaned : null;

    // If not found, try no-space match
    if (!en) {
      const noSpace = cleaned.replace(/\s+/g, '');
      for (const [ko, enName] of Object.entries(ko_to_en)) {
        if (ko.replace(/\s+/g, '') === noSpace) {
          en = enName;
          matchedKo = ko;
          break;
        }
      }
    }

    // If not found, try substring match (prefer longest match)
    // For noisy lines, we allow the item name to be embedded in longer text
    if (!en) {
      let bestLen = 0;
      for (const [ko, enName] of Object.entries(ko_to_en)) {
        if (ko.length < 3) continue; // Skip very short names to avoid false positives
        if (cleaned.includes(ko)) {
          // Item name found inside cleaned text — always accept (no ratio filter)
          if (ko.length > bestLen) {
            bestLen = ko.length;
            en = enName;
            matchedKo = ko;
          }
        } else if (ko.includes(cleaned)) {
          // Cleaned text is a substring of item name — require reasonable ratio
          const ratio = cleaned.length / ko.length;
          if (ratio >= 0.6 && ko.length > bestLen) {
            bestLen = ko.length;
            en = enName;
            matchedKo = ko;
          }
        }
      }
    }

    // If not found, try fuzzy (Levenshtein) match for OCR errors
    // Also try fuzzy on Korean word segments within the line
    if (!en) {
      const fuzzy = fuzzyMatch(cleaned);
      if (fuzzy) {
        en = fuzzy.en;
        matchedKo = fuzzy.ko;
      }
    }

    // For noisy lines with lots of garbage, try extracting Korean word groups
    if (!en && cleaned.length > 8) {
      const koWords = cleaned.split(/\s+/).filter(w => w.length >= 2);
      // Try consecutive word combinations (2-4 words)
      for (let wLen = Math.min(4, koWords.length); wLen >= 2 && !en; wLen--) {
        for (let wStart = 0; wStart <= koWords.length - wLen && !en; wStart++) {
          const segment = koWords.slice(wStart, wStart + wLen).join(' ');
          if (segment.length < 3) continue;
          const segEn = ko_to_en[segment];
          if (segEn) {
            en = segEn;
            matchedKo = segment;
          } else {
            // Try no-space variant
            const segNoSpace = segment.replace(/\s+/g, '');
            for (const [ko, enName] of Object.entries(ko_to_en)) {
              if (ko.replace(/\s+/g, '') === segNoSpace) {
                en = enName;
                matchedKo = ko;
                break;
              }
            }
          }
          if (!en) {
            const fuzzy = fuzzyMatch(segment);
            if (fuzzy) {
              en = fuzzy.en;
              matchedKo = fuzzy.ko;
            }
          }
        }
      }
    }

    if (en) {
      if (!itemNameKo) {
        // First recognized name = item name (unique/set name)
        itemNameKo = matchedKo || cleaned;
        itemNameEn = en;
      } else if (!baseTypeKo) {
        // Second recognized name = base type
        baseTypeKo = matchedKo || cleaned;
        baseTypeEn = en;
      }
    }
  }

  // If we only found one name, try to determine if it's unique/set or base
  if (itemNameEn && !baseTypeEn) {
    // Check if itemNameEn looks like a base type (common words)
    const baseWords = ['Boots', 'Armor', 'Shield', 'Helm', 'Belt', 'Ring', 'Amulet',
      'Sword', 'Axe', 'Mace', 'Staff', 'Bow', 'Crossbow', 'Gloves', 'Circlet'];
    const isBase = baseWords.some(w => itemNameEn.includes(w));
    if (isBase) {
      baseTypeKo = itemNameKo;
      baseTypeEn = itemNameEn;
      itemNameKo = null;
      itemNameEn = null;
    }
  }

  // Extract stats from all lines
  const fullText = lines.join('\n');
  // Helper: parse number that might contain ? for OCR-garbled digits
  const parseNum = (s) => parseInt(s.replace(/\?/g, ''));
  for (const sp of STAT_PATTERNS) {
    const match = fullText.match(sp.pattern);
    if (match) {
      if (sp.key === 'addsDmg') {
        stats[sp.key] = { min: parseNum(match[1]), max: parseNum(match[2]), label: sp.label };
      } else if (sp.key === 'durability') {
        stats[sp.key] = { current: parseNum(match[1]), max: parseNum(match[2]), label: sp.label };
      } else {
        stats[sp.key] = { value: parseNum(match[1]), label: sp.label };
      }
    }
  }

  // Determine item quality
  if (itemNameEn) {
    itemQuality = 'unique'; // If we found a named item, it's likely unique
  }

  // Clean trailing " *" from English names (artifact from D2R localization data)
  const cleanEn = (s) => s ? s.replace(/\s*\*+$/, '') : s;

  return {
    itemNameKo,
    itemNameEn: cleanEn(itemNameEn),
    baseTypeKo,
    baseTypeEn: cleanEn(baseTypeEn),
    itemQuality,
    stats,
    rawLines: lines
  };
}
