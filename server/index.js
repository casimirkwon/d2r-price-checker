import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { runOCR } from './ocr.js';
import { parseItemText } from './itemParser.js';
import { lookupPrice } from './priceLookup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// OCR: receive image, return extracted Korean text
app.post('/api/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '이미지가 없습니다' });
    const text = await runOCR(req.file.buffer);
    res.json({ text });
  } catch (err) {
    console.error('OCR error:', err);
    res.status(500).json({ error: 'OCR 처리 실패: ' + err.message });
  }
});

// Identify: parse Korean text, map to English, extract stats
app.post('/api/identify', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: '텍스트가 없습니다' });
    const item = parseItemText(text);
    res.json(item);
  } catch (err) {
    console.error('Identify error:', err);
    res.status(500).json({ error: '아이템 인식 실패: ' + err.message });
  }
});

// Price: look up price from external sites
app.post('/api/price', async (req, res) => {
  try {
    const { itemNameEn, itemNameKo, baseTypeEn, stats, ladder } = req.body;
    if (!itemNameEn) return res.status(400).json({ error: '아이템 이름이 없습니다' });
    const priceData = await lookupPrice(itemNameEn, baseTypeEn, stats, { ladder: !!ladder, itemNameKo });
    res.json(priceData);
  } catch (err) {
    console.error('Price lookup error:', err);
    res.status(500).json({ error: '시세 조회 실패: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`D2R Price Checker running at http://localhost:${PORT}`);
});
