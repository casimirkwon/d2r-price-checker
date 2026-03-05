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
    worker = await Tesseract.createWorker('kor+eng', 1, {
      // logger: m => console.log(m),
    });
    // PSM 6 = assume a single uniform block of text
    // Prioritize Korean character set recognition
    await worker.setParameters({
      tessedit_pageseg_mode: '6',
      preserve_interword_spaces: '1',
    });
  }
  return worker;
}

export async function runOCR(imageBuffer) {
  const processed = await preprocessImage(imageBuffer);
  const w = await getWorker();
  const { data: { text } } = await w.recognize(processed);
  return text.trim();
}
