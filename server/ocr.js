import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TESSDATA_PATH = path.join(__dirname, '..', 'data', 'tessdata');

/**
 * Preprocess a D2R screenshot for better OCR accuracy.
 * D2R tooltips have light/gold/blue text on very dark background.
 * Strategy: scale up, color-aware grayscale, denoise, sharpen, binarize.
 */
async function preprocessImage(buffer, scale) {
  const meta = await sharp(buffer).metadata();
  if (!scale) {
    scale = Math.max(2, Math.round(2400 / meta.width));
  }

  return sharp(buffer)
    .flatten({ background: '#000000' })  // remove alpha channel (clipboard PNG)
    .resize({ width: meta.width * scale, kernel: 'lanczos3' })
    // Equal-weight grayscale: standard grayscale (0.21R+0.72G+0.07B) under-weights
    // red and blue channels. D2R text is gold (high R,G), blue (high B), white (all high).
    // Using [0.4, 0.4, 0.4] ensures all colored text stays bright after conversion.
    .recomb([
      [0.4, 0.4, 0.4],
      [0.4, 0.4, 0.4],
      [0.4, 0.4, 0.4],
    ])
    .grayscale()
    .median(3)                    // Remove salt-and-pepper noise
    .normalize()                  // Use full dynamic range
    .sharpen({ sigma: 1.5 })     // Sharpen character edges for clearer glyphs
    .linear(2.0, -80)            // High contrast (slightly less aggressive than before)
    .threshold(85)               // Binarize: keep bright text
    .negate()                    // Invert: dark text on white bg (Tesseract prefers this)
    .png()
    .toBuffer();
}

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
    // PSM 6 = assume a single uniform block of text
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
    console.log('[OCR] Tesseract worker ready (best model).');
  }
  return worker;
}

/**
 * Post-process raw OCR text: fix common artifacts, strip noise.
 */
function postProcess(text) {
  return text
    .replace(/[|l][|l]술/g, '기술')   // ||술 → 기술
    .replace(/7[|l]술/g, '기술')      // 7|술 → 기술
    .replace(/1[|l]술/g, '기술')      // 1|술 → 기술
    .replace(/ㄱ[|l]/g, '기')         // ㄱ| → 기
    .replace(/파괴\s*물가/g, '파괴 불가') // 물가 → 불가
    .replace(/모는\s*기술/g, '모든 기술') // 모는 → 모든
    .replace(/\|(?=\s*\d)/g, '+')     // |N → +N (OCR confuses + with |)
    .replace(/\*(\d)/g, '+$1')        // *N → +N
    .replace(/\*\+/g, '+')            // *+ → +
    .replace(/!(\d)/g, '1$1')         // !N → 1N
    .replace(/!(?=\s|$)/g, '1')       // ! at end → 1
    .split('\n')
    .map(line => line.replace(/[^\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF\d\s+\-/:()%.~,]/g, '').trim())
    .join('\n')
    .trim();
}

export async function runOCR(imageBuffer) {
  console.log(`[OCR] Processing image (${imageBuffer.length} bytes)...`);
  const meta = await sharp(imageBuffer).metadata();

  // Primary pass: target ~2400px wide
  const primaryScale = Math.max(2, Math.round(2400 / meta.width));
  const processed = await preprocessImage(imageBuffer, primaryScale);
  console.log(`[OCR] Preprocessed (${primaryScale}x, ${meta.width * primaryScale}px), running recognition...`);

  const w = await getWorker();
  const { data: { text, confidence } } = await w.recognize(processed);
  let result = postProcess(text);

  console.log(`[OCR] Primary pass: ${result.length} chars, confidence: ${Math.round(confidence)}`);

  // Fix 9% artifact: Tesseract Korean model sometimes reads the % glyph as "9%"
  // at certain scale factors. Detect suspicious N9% values (2+ digits before the 9)
  // and verify with a second OCR pass at a different scale.
  if (/\d{2,}9%/.test(result)) {
    const altScale = primaryScale <= 2 ? 4 : 2;
    console.log(`[OCR] Detected potential 9%% artifact, verifying at ${altScale}x...`);
    const processed2 = await preprocessImage(imageBuffer, altScale);
    const { data: { text: text2, confidence: conf2 } } = await w.recognize(processed2);
    const result2 = postProcess(text2);
    console.log(`[OCR] Verify pass: confidence ${Math.round(conf2)}`);

    // Cross-reference: if primary has N9% and verify pass has N%, the 9 is an artifact
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
    console.warn('[OCR] WARNING: Empty OCR result. Check if language data loaded correctly.');
  }
  return result;
}
