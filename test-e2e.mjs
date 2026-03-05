import { readFileSync } from 'fs';

const BASE = 'http://localhost:3000';

const tests = [
  { file: 'test-images/shako_ko.webp', expected: 'Harlequin Crest', label: 'Shako' },
  { file: 'test-images/griffon_ko.webp', expected: "Griffon's Eye", label: "Griffon's Eye (annotated)" },
  { file: 'test-images/griffon_ko2.webp', expected: "Griffon's Eye", label: "Griffon's Eye (in-game)" },
  { file: 'test-images/wartraveler_ko.webp', expected: 'War Traveler', label: 'War Traveler' },
  { file: 'test-images/annihilus_ko.webp', expected: 'Annihilus', label: 'Annihilus' },
];

for (const t of tests) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`TEST: ${t.label} (${t.file})`);
  console.log('='.repeat(60));

  try {
    // Step 1: OCR
    const imgBuf = readFileSync(t.file);
    const formData = new FormData();
    formData.append('image', new Blob([imgBuf]), 'test.webp');

    const ocrRes = await fetch(`${BASE}/api/ocr`, { method: 'POST', body: formData });
    const ocrData = await ocrRes.json();

    if (ocrData.error) {
      console.log('OCR ERROR:', ocrData.error);
      continue;
    }
    console.log('\n[OCR Result]');
    console.log(ocrData.text);

    // Step 2: Identify
    const identRes = await fetch(`${BASE}/api/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ocrData.text }),
    });
    const item = await identRes.json();

    console.log('\n[Identify Result]');
    console.log('  itemNameKo:', item.itemNameKo || 'N/A');
    console.log('  itemNameEn:', item.itemNameEn || 'N/A');
    console.log('  baseTypeKo:', item.baseTypeKo || 'N/A');
    console.log('  baseTypeEn:', item.baseTypeEn || 'N/A');

    if (item.stats) {
      const statKeys = Object.keys(item.stats);
      if (statKeys.length > 0) {
        console.log('  Stats:');
        for (const k of statKeys) {
          const s = item.stats[k];
          const val = s.value !== undefined ? s.value : s.current !== undefined ? `${s.current}/${s.max}` : `${s.min}-${s.max}`;
          console.log(`    ${s.label}: ${val}`);
        }
      }
    }

    const match = item.itemNameEn === t.expected;
    console.log(`\n  Expected: ${t.expected}`);
    console.log(`  Got:      ${item.itemNameEn || 'N/A'}`);
    console.log(`  Result:   ${match ? 'PASS' : 'FAIL'}`);

  } catch (e) {
    console.log('ERROR:', e.message);
  }
}
