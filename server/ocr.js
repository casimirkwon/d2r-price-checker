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
async function preprocessImage(buffer) {
  const meta = await sharp(buffer).metadata();
  // Aggressive upscaling for small images — clearer character shapes
  const scale = meta.width < 300 ? 5 : meta.width < 500 ? 4 : meta.width < 800 ? 3 : meta.width < 1200 ? 2 : 1;

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

export async function runOCR(imageBuffer) {
  console.log(`[OCR] Processing image (${imageBuffer.length} bytes)...`);
  const processed = await preprocessImage(imageBuffer);
  console.log(`[OCR] Preprocessed image (${processed.length} bytes), running recognition...`);
  const w = await getWorker();
  const { data: { text, confidence } } = await w.recognize(processed);

  // Post-process in order:
  // 1) Symbol-to-Korean substitutions (before stripping)
  // 2) Strip remaining noise characters
  const cleaned = text
    .replace(/[|l][|l]술/g, '기술')   // ||술 → 기술
    .replace(/7[|l]술/g, '기술')      // 7|술 → 기술
    .replace(/1[|l]술/g, '기술')      // 1|술 → 기술
    .replace(/ㄱ[|l]/g, '기')         // ㄱ| → 기
    .replace(/\*(\d)/g, '+$1')        // *N → +N
    .replace(/\*\+/g, '+')            // *+ → +
    .replace(/!(\d)/g, '1$1')         // !N → 1N
    .replace(/!(?=\s|$)/g, '1')       // ! at end → 1
    .split('\n')
    .map(line => line.replace(/[^\uAC00-\uD7A3\u3131-\u3163\u1100-\u11FF\d\s+\-/:()%.~,]/g, '').trim())
    .join('\n')
    .trim();

  console.log(`[OCR] Result: ${cleaned.length} chars, confidence: ${confidence}`);
  if (!cleaned) {
    console.warn('[OCR] WARNING: Empty OCR result. Check if language data loaded correctly.');
  }
  return cleaned;
}
