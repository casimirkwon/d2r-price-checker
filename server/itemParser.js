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
// Reference: https://sangminem.tistory.com/794 (D2R item-modifiers.json 한/영 매칭표)
// OCR commonly confuses: 기→ㄱ|/ㄱl, 력→럭, 확률→왁률/왁릉, 치→지, O→0, [→1
const STAT_PATTERNS = [
  // --- Base info ---
  { pattern: /방[어머버]력[:\s]*(\d+)/,                    key: 'defense',       label: 'Defense' },
  { pattern: /내구도[:\s]*(\d+)\s*\/\s*(\d+)/,            key: 'durability',    label: 'Durability' },
  { pattern: /필[요표]?\s*힘[:\s]*(\d+)/,                 key: 'reqStr',        label: 'Required Strength' },
  { pattern: /필[요표]?\s*민[첩침][:\s]*(\d+)/,           key: 'reqDex',        label: 'Required Dexterity' },
  { pattern: /[요보]구\s*레벨[:\s]*(\d+)/,                key: 'reqLevel',      label: 'Required Level' },

  // --- ED: "피해 +N% 증가" / "방어력 +N% 증가" ---
  { pattern: /방[어머버]력\s*[+*]\s*[[\]]?(\d[\d?]*\d?)%\s*(?:증가|중가)/, key: 'ed', label: 'Enhanced Defense' },
  { pattern: /피해\s*[+*]\s*[[\]]?(\d[\d?]*\d?)%\s*(?:증가|중가)/,        key: 'ed', label: 'Enhanced Damage' },

  // --- MF: "마법 아이템 발견 확률 N% 증가" ---
  { pattern: /마법\s*아이템\s*발견\s*[^\d]*?(\d+)%\s*(?:증가|중가)?/, key: 'mf', label: 'Magic Find' },

  // --- Speed ---
  // FRW: "달리기/걷기 속도 +N%" — OCR often renders 기 as ㄱ|, ㄱl
  { pattern: /[달담]리\s*[기ㄱ][|l]?\/[걷건곧끝][기ㄱ][|l]?\s*속도\s*[+*](\d+)%/, key: 'frw', label: 'Faster Run/Walk' },
  // IAS: "공격 속도 +N%"
  { pattern: /공격\s*속도\s*[+*](\d+)%/,                   key: 'ias',           label: 'Increased Attack Speed' },
  // FCR: "시전 속도 +N%"
  { pattern: /시전\s*속도\s*[+*](\d+)%/,                   key: 'fcr',           label: 'Faster Cast Rate' },
  // FHR: "타격 회복 속도 +N%"
  { pattern: /타격\s*회복\s*속도\s*[+*](\d+)%/,            key: 'fhr',           label: 'Faster Hit Recovery' },
  { pattern: /적중\s*(?:회복|외복)\s*(?:속도\s*)?[+*](\d+)%/, key: 'fhr',        label: 'Faster Hit Recovery' },
  // FBR: "막기 속도 +N%"
  { pattern: /막기\s*속도\s*[+*](\d+)%/,                   key: 'fbr',           label: 'Faster Block Rate' },

  // --- Primary stats ---
  { pattern: /힘\s*[+*]\s*(\d+)/,                         key: 'str',           label: 'Strength' },
  { pattern: /활력\s*[+*]\s*(\d+)/,                        key: 'vit',           label: 'Vitality' },
  { pattern: /민첩\s*[+*]\s*(\d+)/,                        key: 'dex',           label: 'Dexterity' },
  // Energy: 게임 내 "마력", OCR에서 "에너지"로 나올 수도 있음
  { pattern: /마력\s*[+*]\s*(\d+)/,                        key: 'energy',        label: 'Energy' },
  { pattern: /에너지\s*[+*]\s*(\d+)/,                      key: 'energy',        label: 'Energy' },

  // --- Skills ---
  // All Skills: "모든 기술 +N" — OCR may garble 기술 as T=, 12, Td, NE
  { pattern: /(?:모[든는]\s*(?:스킬|기술|NE|T[=d]|[기ㄱ][술슬]|le|[|l]e)|ETE|모[든는]\s*le)\s*[+*](\d+)/, key: 'allSkills', label: 'All Skills' },
  // All Attributes: "모든 능력치 +N"
  { pattern: /모든\s*능력[치지]\s*[+*](\d+)/,              key: 'allAttr',       label: 'All Attributes' },
  // All Resistances: "모든 저항 +N"
  { pattern: /모든\s*저항\s*[+*](\d+)/,                    key: 'allRes',        label: 'All Resistances' },

  // --- Life / Mana (avoid matching "적 처치 시 생명력/마나", "생명력 회복", "생명력 N% 훔침") ---
  { pattern: /(?<!처치\s*시\s*)(?<!회복\s*)생명력\s*[+*](\d+)(?!%)/,  key: 'life',   label: 'Life' },
  { pattern: /(?<!처치\s*시\s*)(?<!재생\s*)마나\s*[+*](\d+)(?!%)/,    key: 'mana',   label: 'Mana' },

  // --- Leech: "적중당 생명력 N% 훔침" ---
  { pattern: /적중당\s*생명력\s*(\d+)%/,                   key: 'lifeLeech',     label: 'Life Stolen Per Hit' },
  { pattern: /생명력\s*(\d+)%\s*(?:훔[침칩]|도둑질|EH)/,   key: 'lifeLeech',     label: 'Life Stolen Per Hit' },
  { pattern: /적중당\s*마나\s*(\d+)%/,                     key: 'manaLeech',     label: 'Mana Stolen Per Hit' },
  { pattern: /마나\s*(\d+)%\s*(?:훔[침칩]|도둑질|EH)/,     key: 'manaLeech',     label: 'Mana Stolen Per Hit' },

  // --- Crushing Blow: "강타 확률 N%" ---
  { pattern: /강타\s*확률\s*(\d+)%/,                       key: 'cb',            label: 'Crushing Blow' },
  { pattern: /(\d+)%\s*(?:확률.*?)?(?:강타|분쇄\s*타)/,    key: 'cb',            label: 'Crushing Blow' },

  // --- Deadly Strike: "치명적 공격 N%" ---
  { pattern: /치명적\s*공격\s*(\d+)%/,                     key: 'deadlyStrike',  label: 'Deadly Strike' },
  { pattern: /(\d+)%\s*(?:확률.*?)?치명적\s*공격/,         key: 'deadlyStrike',  label: 'Deadly Strike' },

  // --- Open Wounds: "상처 악화 확률 N%" ---
  { pattern: /상처\s*악화\s*(?:확률\s*)?(\d+)%/,           key: 'openWounds',    label: 'Open Wounds' },
  { pattern: /(\d+)%\s*(?:확률.*?)?상처\s*악화/,           key: 'openWounds',    label: 'Open Wounds' },

  // --- Attacker Takes Damage: "공격자가 피해를 N 받음" ---
  { pattern: /공격자[가ㄱ]?\s*(?:받는\s*)?피해[를]?\s*(\d+)\s*받/,  key: 'thorns',  label: 'Attacker Takes Damage' },
  { pattern: /공격자[가ㄱ]?\s*(?:받는\s*)?피해[를]?\s*(\d+)/,       key: 'thorns',  label: 'Attacker Takes Damage' },

  // --- Adds damage: elemental and generic ---
  { pattern: /화염\s*피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ]/, key: 'addsFireDmg',  label: 'Adds Fire Damage' },
  { pattern: /냉기\s*피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ]/, key: 'addsColdDmg',  label: 'Adds Cold Damage' },
  { pattern: /번개\s*피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ]/, key: 'addsLightDmg', label: 'Adds Lightning Damage' },
  { pattern: /마법\s*피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ]/, key: 'addsMagicDmg', label: 'Adds Magic Damage' },
  { pattern: /독\s*피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ]/,   key: 'addsPoisonDmg', label: 'Adds Poison Damage' },
  { pattern: /피해\s*(\d+)\s*-\s*(\d+)\s*추[가ㄱ][7ㄱ]?/,  key: 'addsDmg',      label: 'Adds Damage' },

  // --- Damage to Demons/Undead: "악마에게 주는 피해 +N%" ---
  { pattern: /악마에게\s*(?:주는\s*)?피해\s*[+*](\d+)%/,    key: 'dmgDemons',    label: 'Damage to Demons' },
  { pattern: /언데드에게\s*(?:주는\s*)?피해\s*[+*](\d+)%/,  key: 'dmgUndead',    label: 'Damage to Undead' },

  // --- Attack Rating: "명중률 +N" ---
  { pattern: /명중률\s*[+*](\d+)/,                         key: 'ar',            label: 'Attack Rating' },
  { pattern: /명중률\s*보너스\s*(\d+)%/,                   key: 'arBonus',       label: 'Bonus to Attack Rating' },
  { pattern: /명중률\s*(\d+)%\s*(?:증가|중가)/,            key: 'arBonus',       label: 'Bonus to Attack Rating' },
  { pattern: /악마에\s*대한\s*명중률\s*[+*](\d+)/,          key: 'arDemons',     label: 'Attack Rating Against Demons' },
  { pattern: /언데드에\s*대한\s*명중률\s*[+*](\d+)/,        key: 'arUndead',     label: 'Attack Rating Against Undead' },

  // --- Min/Max damage ---
  { pattern: /최소\s*피해\s*[+*](\d+)/,                    key: 'minDmg',        label: 'Minimum Damage' },
  { pattern: /최대\s*피해\s*[+*](\d+)/,                    key: 'maxDmg',        label: 'Maximum Damage' },
  { pattern: /^피해\s*[+*](\d+)$/m,                        key: 'flatDmg',       label: 'Damage' },

  // --- Sockets ---
  { pattern: /소켓\s*\((\d+)\)/,                           key: 'sockets',       label: 'Sockets' },
  { pattern: /홈\s*있음\s*\((\d+)\)/,                      key: 'sockets',       label: 'Sockets' },

  // --- Life/Mana recovery ---
  { pattern: /생명력\s*회복\s*[+*](\d+)/,                  key: 'replenishLife', label: 'Replenish Life' },
  { pattern: /마나\s*재생\s*(\d+)%/,                       key: 'regenMana',     label: 'Regenerate Mana' },

  // --- Requirements: "착용 조건 -N%" ---
  { pattern: /착용\s*조건\s*[+-](\d+)%/,                   key: 'reqReduced',    label: 'Requirements' },

  // --- Target Defense: "대상의 방어력 -N%" ---
  { pattern: /대상의?\s*방어력\s*-(\d+)%/,                 key: 'targetDef',     label: 'Target Defense' },

  // --- Slows Target: "대상 감속 N%" ---
  { pattern: /대상\s*(?:감속|둔화)\s*(\d+)%/,              key: 'slowTarget',    label: 'Slows Target' },

  // --- Blocking: "막기 확률 N% 증가" ---
  { pattern: /막기\s*확률\s*(\d+)%\s*(?:증가|중가)/,       key: 'blockChance',   label: 'Increased Chance of Blocking' },

  // --- Stamina ---
  { pattern: /지구력\s*고갈\s*속도\s*(\d+)%\s*감소/,       key: 'slowerStamina', label: 'Slower Stamina Drain' },
  { pattern: /지구력.*?(\d+)%\s*감소/,                     key: 'slowerStamina', label: 'Slower Stamina Drain' },
  { pattern: /최대\s*지구력\s*[+*](\d+)/,                  key: 'maxStamina',    label: 'Maximum Stamina' },

  // --- Resistances ---
  { pattern: /화염\s*저항\s*[+*](\d+)%/,                   key: 'fireRes',       label: 'Fire Resist' },
  { pattern: /냉기\s*저항\s*[+*](\d+)%/,                   key: 'coldRes',       label: 'Cold Resist' },
  { pattern: /번개\s*저항\s*[+*](\d+)%/,                   key: 'lightRes',      label: 'Lightning Resist' },
  { pattern: /독\s*저항\s*[+*](\d+)%/,                     key: 'poisonRes',     label: 'Poison Resist' },

  // --- Damage Reduced: "피해 N 감소" / "마법 피해 N 감소" ---
  { pattern: /마법\s*피해\s*(\d+)\s*감소/,                  key: 'mdr',           label: 'Magic Damage Reduced' },
  { pattern: /피해\s*(\d+)\s*감소/,                        key: 'dr',            label: 'Damage Reduced' },

  // --- Enemy resistance reduction: "적의 화염 저항 -N%" ---
  { pattern: /적의\s*번개\s*저[항깜]\s*-(\d+)%/,            key: 'enemyLightRes', label: 'Enemy Lightning Resist' },
  { pattern: /적의\s*화염\s*저항\s*-(\d+)%/,               key: 'enemyFireRes',  label: 'Enemy Fire Resist' },
  { pattern: /적의\s*냉기\s*저항\s*-(\d+)%/,               key: 'enemyColdRes',  label: 'Enemy Cold Resist' },
  { pattern: /적의\s*독\s*저항\s*-(\d+)%/,                 key: 'enemyPoisonRes', label: 'Enemy Poison Resist' },

  // --- Skill damage bonus: "화염 기술 피해 +N%" ---
  { pattern: /번개\s*(?:기술\s*)?피해\s*[+*](\d+)%/,       key: 'lightSkillDmg', label: 'Lightning Skill Damage' },
  { pattern: /화염\s*(?:기술\s*)?피해\s*[+*](\d+)%/,       key: 'fireSkillDmg',  label: 'Fire Skill Damage' },
  { pattern: /냉기\s*(?:기술\s*)?피해\s*[+*](\d+)%/,       key: 'coldSkillDmg',  label: 'Cold Skill Damage' },
  { pattern: /독\s*(?:기술\s*)?피해\s*[+*](\d+)%/,         key: 'poisonSkillDmg', label: 'Poison Skill Damage' },

  // --- Absorb: "화염 흡수 +N" / "화염 흡수 N%" ---
  { pattern: /냉기\s*흡수\s*[+*](\d+)/,                    key: 'coldAbsorb',    label: 'Cold Absorb' },
  { pattern: /화염\s*흡수\s*[+*](\d+)/,                    key: 'fireAbsorb',    label: 'Fire Absorb' },
  { pattern: /번개\s*흡수\s*[+*](\d+)/,                    key: 'lightAbsorb',   label: 'Lightning Absorb' },
  { pattern: /마법\s*흡수\s*[+*](\d+)/,                    key: 'magicAbsorb',   label: 'Magic Absorb' },
  { pattern: /냉기\s*흡수\s*(\d+)%/,                       key: 'coldAbsorbPct', label: 'Cold Absorb %' },
  { pattern: /화염\s*흡수\s*(\d+)%/,                       key: 'fireAbsorbPct', label: 'Fire Absorb %' },
  { pattern: /번개\s*흡수\s*(\d+)%/,                       key: 'lightAbsorbPct', label: 'Lightning Absorb %' },

  // --- Kill bonuses: "적 처치 시 마나 +N" ---
  { pattern: /적\s*처치\s*시\s*마나\s*[+*](\d+)/,          key: 'manaPerKill',   label: 'Mana after each Kill' },
  { pattern: /적\s*처치\s*시\s*생명력\s*[+*](\d+)/,        key: 'lifePerKill',   label: 'Life after each Kill' },
  { pattern: /악마\s*처치\s*시\s*생명력\s*[+*](\d+)/,      key: 'lifePerDemonKill', label: 'Life after each Demon Kill' },

  // --- Extra Gold: "괴물에게서 얻는 금화 N% 증가" ---
  { pattern: /금화\s*(\d+)%\s*(?:증가|중가)/,              key: 'extraGold',     label: 'Extra Gold from Monsters' },
  { pattern: /골드.*?(\d+)%/,                              key: 'extraGold',     label: 'Extra Gold from Monsters' },

  // --- Damage to Mana: "받는 피해의 N%만큼 마나 회복" ---
  { pattern: /받는\s*피해의\s*(\d+)%.*?마나\s*회복/,       key: 'dmgToMana',     label: 'Damage Taken Goes To Mana' },

  // --- Poison damage ---
  { pattern: /독\s*피해\s*[+*](\d+)/,                      key: 'poisonDmg',     label: 'Poison Damage' },

  // --- Piercing / Knockback ---
  { pattern: /관통\s*공격/,                                key: '_pierce',       label: 'Piercing Attack' },
  { pattern: /밀쳐내기/,                                   key: '_knockback',    label: 'Knockback' },

  // --- Monster flee: "적중 시 괴물 도주 N%" ---
  { pattern: /괴물\s*도주\s*(\d+)%/,                       key: 'flee',          label: 'Hit Causes Monsters to Flee' },
  { pattern: /적중\s*시.*?(\d+)%.*?도주/,                  key: 'flee',          label: 'Hit Causes Monsters to Flee' },

  // --- Light Radius: "시야 +N" ---
  { pattern: /시야\s*[+*](\d+)/,                           key: 'lightRadius',   label: 'Light Radius' },

  // --- Defense vs Missile/Melee: "원거리 공격 방어력 +N" ---
  { pattern: /원거리\s*공격\s*방어력\s*[+*](\d+)/,         key: 'defVsMissile',  label: 'Defense Vs. Missile' },
  { pattern: /근접\s*공격\s*방어력\s*[+*](\d+)/,           key: 'defVsMelee',    label: 'Defense Vs. Melee' },

  // --- Max resist: "최대 화염 저항 +N%" ---
  { pattern: /최대\s*화염\s*저항\s*[+*](\d+)%/,            key: 'maxFireRes',    label: 'Max Fire Resist' },
  { pattern: /최대\s*냉기\s*저항\s*[+*](\d+)%/,            key: 'maxColdRes',    label: 'Max Cold Resist' },
  { pattern: /최대\s*번개\s*저항\s*[+*](\d+)%/,            key: 'maxLightRes',   label: 'Max Lightning Resist' },
  { pattern: /최대\s*독\s*저항\s*[+*](\d+)%/,              key: 'maxPoisonRes',  label: 'Max Poison Resist' },

  // --- Max Life/Mana %: "최대 생명력 N% 증가" ---
  { pattern: /최대\s*생명력\s*(\d+)%\s*(?:증가|중가)/,      key: 'maxLifePct',   label: 'Increase Maximum Life' },
  { pattern: /최대\s*마나\s*(\d+)%\s*(?:증가|중가)/,        key: 'maxManaPct',   label: 'Increase Maximum Mana' },

  // --- Experience: "경험치 획득량 +N%" ---
  { pattern: /경험[치지]?\s*획득[량랑]\s*[+*](\d+)%/,      key: 'expGain',       label: 'Experience Gained' },

  // --- Poison length: "독 지속시간 N% 감소" ---
  { pattern: /독\s*지속\s*시간\s*(\d+)%\s*감소/,            key: 'poisonLenReduced', label: 'Poison Length Reduced' },

  // --- Boolean flags ---
  { pattern: /파괴\s*불가/,                                key: '_indestructible', label: 'Indestructible' },
  { pattern: /빙결되지\s*않음/,                            key: '_cannotFreeze',  label: 'Cannot Be Frozen' },
  { pattern: /대상\s*빙결/,                                key: '_freezeTarget',  label: 'Freezes Target' },
  { pattern: /괴물\s*회복\s*저지/,                         key: '_preventHeal',   label: 'Prevent Monster Heal' },
];

/**
 * Parse OCR'd Korean text from a D2R item tooltip.
 * Returns identified item info with English mappings.
 */
export function parseItemText(text) {
  // Pre-clean OCR text: fix common OCR artifacts
  // Note: |→기, *→+ substitutions are already done in ocr.js
  let cleaned = text
    .replace(/왁[률릉룰]/g, '확률')
    .replace(/학률/g, '확률')
    .replace(/능력지/g, '능력치')
    .replace(/방[버써]력/g, '방어력')  // 방버력/방써력 → 방어력
    .replace(/저앙/g, '저항')
    .replace(/저깜/g, '저항')
    .replace(/적함/g, '저항')
    .replace(/디해/g, '피해')     // 디해 → 피해 (kor-only artifact)
    .replace(/피애/g, '피해')
    .replace(/[여버][앵행][자차]/g, '여행자')
    .replace(/배들/g, '배틀')
    .replace(/곧기/g, '걷기')
    .replace(/그리[폰픈]의/g, '그리폰의')
    .replace(/할리[퀸킨][관곤]\s*모/g, '할리퀸 관모')
    .replace(/\b1기술/g, '기술')  // 1기술 → 기술
    .replace(/[뽀호쁘]구/g, '요구');  // 뽀구/호구/쁘구 → 요구

  // Remove lines that are pure noise (no Korean chars, no useful numbers)
  const lines = cleaned.split('\n')
    .map(l => l.trim())
    .filter(l => {
      if (l.length === 0) return false;
      // Keep lines with Korean characters
      if (/[\uAC00-\uD7A3]/.test(l)) return true;
      // Keep lines with number patterns (stats like "842", "23 / 24")
      if (/\d+\s*[/]\s*\d+|\d{2,}/.test(l)) return true;
      // Drop everything else (pure English/symbol noise)
      return false;
    });
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
    if (stats[sp.key]) continue; // First match wins (more specific patterns listed first)
    const match = fullText.match(sp.pattern);
    if (match) {
      if (sp.key.startsWith('_')) {
        // Boolean flags (no value)
        stats[sp.key] = { value: true, label: sp.label };
      } else if (sp.key === 'addsDmg' || sp.key === 'addsFireDmg' || sp.key === 'addsColdDmg' || sp.key === 'addsLightDmg' || sp.key === 'addsMagicDmg' || sp.key === 'addsPoisonDmg') {
        stats[sp.key] = { min: parseNum(match[1]), max: parseNum(match[2]), label: sp.label };
      } else if (sp.key === 'durability') {
        stats[sp.key] = { current: parseNum(match[1]), max: parseNum(match[2]), label: sp.label };
      } else {
        stats[sp.key] = { value: parseNum(match[1]), label: sp.label };
      }
    }
  }

  // Detect ethereal
  const ethereal = /무형/i.test(fullText);

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
    ethereal,
    stats,
    rawLines: lines
  };
}
