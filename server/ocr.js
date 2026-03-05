import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESSDATA_PATH = path.join(__dirname, '..', 'data', 'tessdata');

// ─── D2R vocabulary for dictionary-based OCR correction ───
// Tesseract Korean model confuses visually similar characters (험↔엄, 항↔망, ㅎ↔ㅇ, etc.)
// Instead of patching individual cases, we fuzzy-match OCR'd words against known D2R vocabulary
// and auto-correct within edit distance 1. This handles ALL character confusions systematically.
const D2R_VOCAB = [
  // Primary stats
  '힘', '활력', '민첩', '마력', '에너지',
  // Resources / defense
  '생명력', '마나', '방어력', '내구도',
  // Damage
  '피해', '명중률', '추가', '증가', '감소',
  // Elements
  '화염', '냉기', '번개', '독', '마법',
  // Speed
  '속도', '공격', '시전', '타격', '회복', '막기',
  '달리기', '걷기',
  // Skills
  '모든', '기술', '레벨', '스킬', '능력치',
  // Resistance
  '저항', '최대', '최소',
  // Combat
  '강타', '확률', '치명적', '상처', '악화',
  '적중당', '적중', '훔침',
  '공격자', '관통', '밀쳐내기',
  // Damage qualifiers
  '악마에게', '언데드에게', '주는',
  // Misc stats
  '보너스',
  // Equipment
  '소켓', '착용', '조건', '필요', '요구',
  '파괴', '불가', '무형', '빙결', '않음',
  // Defense types
  '원거리', '근접', '대상', '감속', '둔화',
  // Misc
  '경험치', '획득량', '지구력', '고갈',
  '금화', '골드', '상점', '물품', '가격',
  '재생', '흡수', '시야', '절반', '실명',
  '적', '처치', '괴물', '도주', '안식',
  '받는', '적의', '시간', '지속',
  // Classes
  '아마존', '성기사', '강령술사', '원소술사',
  '야만용사', '암살자', '드루이드',
  '발차기',
  // Item descriptors
  '한손', '양손', '도검', '계열', '매우', '빠른',
  '무기', '방패', '투구', '갑옷', '장갑', '허리띠', '신발',
  '반지', '목걸이',
  // Common item name words prone to OCR errors
  '씁쓸한', '할리퀸', '관모', '여행자', '그리폰',
  '배틀', '크립틱', '소드',
];

// Build index grouped by length for efficient lookup
const VOCAB_BY_LEN = {};
for (const w of D2R_VOCAB) {
  for (const len of [w.length - 1, w.length, w.length + 1]) {
    if (len < 1) continue;
    (VOCAB_BY_LEN[len] ??= []).push(w);
  }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,           // deletion
        dp[i - 1] + 1,       // insertion
        prev + (a[i - 1] === b[j - 1] ? 0 : 1)  // substitution
      );
      prev = tmp;
    }
  }
  return dp[m];
}

/**
 * Decompose a Korean syllable into jamo components (initial, medial, final).
 * Returns [chosung, jungsung, jongsung] indices, or null if not a syllable.
 */
function decomposeJamo(ch) {
  const code = ch.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return null;
  return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28];
}

/**
 * Jamo-level distance between two Korean syllables.
 * Counts how many components (chosung/jungsung/jongsung) differ (0-3).
 */
function jamoDistance(a, b) {
  const ja = decomposeJamo(a);
  const jb = decomposeJamo(b);
  if (!ja || !jb) return 3;
  return (ja[0] !== jb[0] ? 1 : 0) + (ja[1] !== jb[1] ? 1 : 0) + (ja[2] !== jb[2] ? 1 : 0);
}

/**
 * Correct a Korean word using the D2R vocabulary dictionary.
 * - Single char: uses jamo distance (≤1 jamo component diff)
 * - Multi char: uses Levenshtein distance (≤1 character diff)
 */
function correctWord(word) {
  const candidates = VOCAB_BY_LEN[word.length];
  if (!candidates) return word;

  // Check exact match first (fast path)
  if (candidates.includes(word)) return word;

  let bestMatch = null;
  let bestDist = Infinity;

  for (const known of candidates) {
    let dist;
    if (word.length === 1 && known.length === 1) {
      // Single char: use jamo distance (ㅎ↔ㅇ = 1 jamo diff, ㄷ↔ㅎ+ㅗ↔ㅣ = too far)
      dist = jamoDistance(word, known);
    } else {
      dist = levenshtein(word, known);
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = known;
    }
    if (dist === 0) return word;
  }

  // Only accept edit distance ≤ 1
  if (bestDist <= 1 && bestMatch) {
    return bestMatch;
  }
  return word;
}

/**
 * Apply dictionary-based correction to all Korean words in the text.
 * Matches both single-char and multi-char Korean word segments.
 */
function correctKoreanText(text) {
  return text.replace(/[\uAC00-\uD7A3]+/g, match => correctWord(match));
}

// ─── Image preprocessing ───

async function preprocessImage(buffer, scale) {
  const meta = await sharp(buffer).metadata();
  if (!scale) {
    scale = Math.max(2, Math.round(2400 / meta.width));
  }

  return sharp(buffer)
    .flatten({ background: '#000000' })
    .resize({ width: meta.width * scale, kernel: 'lanczos3' })
    .recomb([
      [0.4, 0.4, 0.4],
      [0.4, 0.4, 0.4],
      [0.4, 0.4, 0.4],
    ])
    .grayscale()
    .median(3)
    .normalize()
    .sharpen({ sigma: 1.5 })
    .linear(2.0, -80)
    .threshold(85)
    .negate()
    .png()
    .toBuffer();
}

// ─── Tesseract worker ───

let worker = null;

async function getWorker() {
  if (!worker) {
    console.log('[OCR] Initializing Tesseract worker (kor, best model)...');
    worker = await Tesseract.createWorker('kor', 1, {
      langPath: TESSDATA_PATH,
      logger: m => {
        if (m.status === 'loading tesseract core' || m.status === 'loading language traineddata')
          console.log(`[OCR] ${m.status}: ${Math.round((m.progress || 0) * 100)}%`);
      },
    });
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    console.log('[OCR] Tesseract worker ready (best model).');
  }
  return worker;
}

// ─── Post-processing ───

function postProcess(text) {
  let result = text
    // Symbol-to-Korean substitutions
    .replace(/[|l][|l]술/g, '기술')
    .replace(/7[|l]술/g, '기술')
    .replace(/1[|l]술/g, '기술')
    .replace(/ㄱ[|l]/g, '기')
    .replace(/\*(\d)/g, '+$1')
    .replace(/\*\+/g, '+')
    .replace(/!(\d)/g, '1$1')
    .replace(/!(?=\s|$)/g, '1')
    // Fix | → + before numbers (common OCR confusion with +)
    .replace(/\|(?=\s*\d)/g, '+')
    // Strip noise characters (keep Korean, digits, common stat symbols)
    .split('\n')
    .map(line => line.replace(/[^\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF\d\s+\-/:()%.~,]/g, '').trim())
    .join('\n')
    .trim();

  // Dictionary-based Korean word correction (jamo-aware for single chars)
  result = correctKoreanText(result);

  return result;
}

// ─── Main OCR function ───

export async function runOCR(imageBuffer) {
  console.log(`[OCR] Processing image (${imageBuffer.length} bytes)...`);
  const meta = await sharp(imageBuffer).metadata();

  const primaryScale = Math.max(2, Math.round(2400 / meta.width));
  const processed = await preprocessImage(imageBuffer, primaryScale);
  console.log(`[OCR] Preprocessed (${primaryScale}x, ${meta.width * primaryScale}px), running recognition...`);

  const w = await getWorker();
  const { data: { text, confidence } } = await w.recognize(processed);
  let result = postProcess(text);

  console.log(`[OCR] Primary pass: ${result.length} chars, confidence: ${Math.round(confidence)}`);

  // Fix 9% artifact: Tesseract Korean model sometimes reads % as "9%"
  // at certain scale factors. Verify with a second pass at different scale.
  if (/\d{2,}9%/.test(result)) {
    const altScale = primaryScale <= 2 ? 4 : 2;
    console.log(`[OCR] Detected potential 9%% artifact, verifying at ${altScale}x...`);
    const processed2 = await preprocessImage(imageBuffer, altScale);
    const { data: { text: text2, confidence: conf2 } } = await w.recognize(processed2);
    const result2 = postProcess(text2);
    console.log(`[OCR] Verify pass: confidence ${Math.round(conf2)}`);

    result = result.replace(/(\d{2,})(9%)/g, (match, num, suffix) => {
      const corrected = num + '%';
      if (result2.includes(corrected)) {
        console.log(`[OCR] Fixed artifact: ${match} -> ${corrected}`);
        return corrected;
      }
      return match;
    });
  }

  if (!result) {
    console.warn('[OCR] WARNING: Empty OCR result.');
  }
  return result;
}
