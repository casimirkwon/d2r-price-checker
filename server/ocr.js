import Tesseract from 'tesseract.js';
import sharp from 'sharp';

/**
 * Preprocess a D2R screenshot for better OCR accuracy.
 * D2R tooltips have light/gold/blue text on very dark background.
 * Strategy: scale up, boost brightness of text colors, binarize.
 */
async function preprocessImage(buffer) {
  const meta = await sharp(buffer).metadata();
  const scale = meta.width < 400 ? 4 : meta.width < 600 ? 3 : meta.width < 1000 ? 2 : 1;

  // Extract text from tooltip: use the value (brightness) channel from HSV-like approach
  // D2R tooltip text is bright (white, gold, blue) on dark background
  return sharp(buffer)
    .flatten({ background: '#000000' })  // remove alpha channel (clipboard PNG)
    .resize({ width: meta.width * scale, kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .linear(2.5, -100)    // high contrast: push dark pixels darker, light brighter
    .threshold(75)         // binarize: keep bright text
    .negate()              // invert: dark text on white bg (Tesseract prefers this)
    .png()
    .toBuffer();
}

let worker = null;

async function getWorker() {
  if (!worker) {
    console.log('[OCR] Initializing Tesseract worker (kor)...');
    worker = await Tesseract.createWorker('kor', 1, {
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
    console.log('[OCR] Tesseract worker ready.');
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
