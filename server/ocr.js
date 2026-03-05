import OcrModule from '@gutenye/ocr-node';
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';

const Ocr = OcrModule.default || OcrModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'data', 'paddle-models');

const MODELS = [
  {
    name: 'detection (v5)',
    path: path.join(MODELS_DIR, 'detection', 'det-v5.onnx'),
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/detection/v5/det.onnx',
    size: '84MB',
  },
  {
    name: 'recognition (korean)',
    path: path.join(MODELS_DIR, 'korean', 'rec.onnx'),
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/rec.onnx',
    size: '13MB',
  },
  {
    name: 'dictionary (korean)',
    path: path.join(MODELS_DIR, 'korean', 'dict.txt'),
    url: 'https://huggingface.co/monkt/paddleocr-onnx/resolve/main/languages/korean/dict.txt',
    size: '47KB',
  },
];

async function downloadModel(model) {
  const dir = path.dirname(model.path);
  fs.mkdirSync(dir, { recursive: true });
  console.log(`[OCR] Downloading ${model.name} (~${model.size})...`);
  const response = await fetch(model.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  const nodeStream = Readable.fromWeb(response.body);
  await pipeline(nodeStream, createWriteStream(model.path));
  const stat = fs.statSync(model.path);
  console.log(`[OCR] Downloaded ${model.name} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
}

async function ensureModels() {
  for (const model of MODELS) {
    if (!fs.existsSync(model.path)) {
      await downloadModel(model);
    }
  }
}

let ocr = null;

async function getOcr() {
  if (!ocr) {
    console.log('[OCR] Initializing PaddleOCR (Korean)...');
    await ensureModels();
    ocr = await Ocr.create({
      models: {
        detectionPath: MODELS[0].path,
        recognitionPath: MODELS[1].path,
        dictionaryPath: MODELS[2].path,
      },
    });
    console.log('[OCR] PaddleOCR ready.');
  }
  return ocr;
}

export async function runOCR(imageBuffer) {
  console.log(`[OCR] Processing image (${imageBuffer.length} bytes)...`);
  const meta = await sharp(imageBuffer).metadata();

  // Preprocessing: flatten alpha, add padding, upscale very small images
  // Padding helps PaddleOCR detect text near image edges
  const pad = 20;
  let img = sharp(imageBuffer).flatten({ background: '#000000' })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: '#000000' });
  if (meta.width < 300) {
    const scale = Math.max(2, Math.round(600 / meta.width));
    img = img.resize({ width: (meta.width + pad * 2) * scale, kernel: 'lanczos3' });
    console.log(`[OCR] Upscaled ${scale}x (${meta.width}px -> ${meta.width * scale}px)`);
  }
  const processed = await img.png().toBuffer();

  const tmpPath = path.join(os.tmpdir(), `d2r-ocr-${Date.now()}.png`);
  try {
    fs.writeFileSync(tmpPath, processed);
    const engine = await getOcr();
    const result = await engine.detect(tmpPath);
    const items = Array.from(result);

    // Filter noise: stray short text with low confidence
    const filtered = items.filter(item => {
      if (item.text.length <= 1 && item.mean < 0.95) return false;
      if (/^[A-Z]{1,2}$/.test(item.text) && item.mean < 0.90) return false;
      return true;
    });

    // Sort by Y position (top to bottom)
    filtered.sort((a, b) => a.box[0][1] - b.box[0][1]);

    // Clean each line: strip stray Latin chars between Korean/digits (upscale artifact)
    const lines = filtered.map(item =>
      item.text
        .replace(/^[A-Z]\s+(?=[\uAC00-\uD7A3])/, '')   // leading stray "B 힘" → "힘"
        .replace(/([\uAC00-\uD7A3])\s*[A-Z](?=\d)/g, '$1')  // "피해 H15" → "피해15"
    );
    const text = lines.join('\n');
    console.log(`[OCR] Detected ${filtered.length} lines, ${text.length} chars`);

    if (!text) {
      console.warn('[OCR] WARNING: Empty OCR result.');
    }
    return text;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}
