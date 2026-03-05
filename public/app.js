const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const previewImage = document.getElementById('previewImage');
const ocrBtn = document.getElementById('ocrBtn');
const ocrSection = document.getElementById('ocrSection');
const ocrText = document.getElementById('ocrText');
const identifyBtn = document.getElementById('identifyBtn');
const resultSection = document.getElementById('resultSection');
const itemInfo = document.getElementById('itemInfo');
const priceInfo = document.getElementById('priceInfo');
const priceLoading = document.getElementById('priceLoading');
const statComparison = document.getElementById('statComparison');
const statBars = document.getElementById('statBars');
const tradeHistory = document.getElementById('tradeHistory');
const tradeList = document.getElementById('tradeList');
const externalLinks = document.getElementById('externalLinks');
const linkList = document.getElementById('linkList');
const ladderToggle = document.getElementById('ladderToggle');
const modeDisplay = document.getElementById('modeDisplay');

let currentImageBlob = null;

// Ladder toggle
ladderToggle.addEventListener('change', () => {
  modeDisplay.textContent = ladderToggle.checked ? '래더' : '스탠다드';
});

// --- Image Input ---

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleImage(e.target.files[0]);
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) handleImage(e.dataTransfer.files[0]);
});

// Ctrl+V paste
document.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      handleImage(item.getAsFile());
      break;
    }
  }
});

function handleImage(file) {
  currentImageBlob = file;
  const url = URL.createObjectURL(file);
  previewImage.src = url;
  previewImage.classList.remove('hidden');
  dropZone.querySelector('.drop-zone-content').classList.add('hidden');
  ocrBtn.disabled = false;

  // Reset subsequent sections
  ocrSection.classList.add('hidden');
  resultSection.classList.add('hidden');
}

// --- OCR ---

ocrBtn.addEventListener('click', async () => {
  if (!currentImageBlob) return;

  ocrBtn.disabled = true;
  ocrBtn.textContent = '인식 중...';

  try {
    const formData = new FormData();
    formData.append('image', currentImageBlob);

    const res = await fetch('/api/ocr', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.error) throw new Error(data.error);
    if (!data.text) throw new Error('텍스트를 인식하지 못했습니다. 아이템 툴팁이 선명한 이미지를 사용해주세요.');

    ocrText.value = data.text;
    ocrSection.classList.remove('hidden');
  } catch (err) {
    alert('OCR 실패: ' + err.message);
  } finally {
    ocrBtn.disabled = false;
    ocrBtn.textContent = '아이템 인식하기';
  }
});

// --- Identify & Price ---

identifyBtn.addEventListener('click', async () => {
  const text = ocrText.value.trim();
  if (!text) return;

  identifyBtn.disabled = true;
  identifyBtn.textContent = '분석 중...';
  resultSection.classList.remove('hidden');
  priceLoading.classList.remove('hidden');
  statComparison.classList.add('hidden');
  tradeHistory.classList.add('hidden');
  externalLinks.classList.add('hidden');

  try {
    // Step 1: Identify item
    const identRes = await fetch('/api/identify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    const item = await identRes.json();

    if (item.error) throw new Error(item.error);

    renderItemInfo(item);

    if (!item.itemNameEn && !item.baseTypeEn) {
      priceInfo.innerHTML = '<div class="error-msg">아이템을 인식할 수 없습니다. OCR 텍스트를 확인해주세요.</div>';
      priceLoading.classList.add('hidden');
      return;
    }

    // Step 2: Look up price
    const searchName = item.itemNameEn || item.baseTypeEn;
    const priceRes = await fetch('/api/price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemNameEn: searchName,
        itemNameKo: item.itemNameKo || item.baseTypeKo,
        baseTypeEn: item.baseTypeEn,
        stats: item.stats,
        ladder: ladderToggle.checked,
        ethereal: item.ethereal || false,
        sockets: item.stats?.sockets?.value || null,
      }),
    });
    const priceData = await priceRes.json();

    if (priceData.error) throw new Error(priceData.error);

    renderPriceInfo(priceData, searchName);
  } catch (err) {
    priceInfo.innerHTML = `<div class="error-msg">${err.message}</div>`;
  } finally {
    priceLoading.classList.add('hidden');
    identifyBtn.disabled = false;
    identifyBtn.textContent = '아이템 분석 & 시세 조회';
  }
});

// --- Rendering ---

function renderItemInfo(item) {
  let html = '';

  if (item.itemNameKo) {
    html += `<div class="item-name">${item.itemNameKo}</div>`;
    if (item.itemNameEn) html += `<div class="item-name-en">${item.itemNameEn}</div>`;
  }

  if (item.ethereal) {
    html += `<div class="ethereal-badge">무형 (Ethereal)</div>`;
  }

  if (item.baseTypeKo) {
    html += `<div class="base-type">${item.baseTypeKo}${item.baseTypeEn ? ` (${item.baseTypeEn})` : ''}</div>`;
  }

  if (item.stats && Object.keys(item.stats).length > 0) {
    html += '<div class="stat-list">';
    for (const [key, stat] of Object.entries(item.stats)) {
      if (stat.value !== undefined) {
        html += `<div>${stat.label}: <span class="stat-value">${stat.value}</span></div>`;
      } else if (stat.min !== undefined) {
        html += `<div>${stat.label}: <span class="stat-value">${stat.min}-${stat.max}</span></div>`;
      } else if (stat.current !== undefined) {
        html += `<div>${stat.label}: <span class="stat-value">${stat.current}/${stat.max}</span></div>`;
      }
    }
    html += '</div>';
  }

  itemInfo.innerHTML = html;
}

function renderPriceInfo(data, itemName) {
  // Price summary
  const d2io = data.d2io || {};
  const d2trader = data.d2trader || {};
  const cc = data.chaoscube || {};

  let summaryHtml = '';

  if (d2io.priceRange) {
    const pr = d2io.priceRange;
    let priceText = '';
    if (pr.mostCommonPrice) {
      priceText = pr.mostCommonPrice;
    }
    if (pr.minIst !== pr.maxIst) {
      priceText += priceText ? ` (${pr.minIst}~${pr.maxIst} Ist 기준)` : `${pr.minIst}~${pr.maxIst} Ist`;
    }
    summaryHtml += `
      <div class="price-summary">
        <div class="price-range">${priceText || `~${pr.avgIst} Ist`}</div>
        <div class="price-detail">diablo2.io 최근 거래 ${pr.sampleCount}건 기준</div>
      </div>`;
  } else if (d2trader.itemPrice) {
    const ip = d2trader.itemPrice;
    const fg = ip.fg ? `${ip.fg.min}~${ip.fg.max} fg` : '';
    const runes = ip.runes ? `${ip.runes.min_count}~${ip.runes.max_count} ${ip.runes.min_name}` : '';
    summaryHtml += `
      <div class="price-summary">
        <div class="price-range">${runes || fg || '가격 정보 없음'}</div>
        <div class="price-detail">D2Trader.net 기준${fg && runes ? ` (${fg})` : ''}</div>
      </div>`;
  }

  if (cc.priceRange) {
    const pr = cc.priceRange;
    const priceText = pr.minCP === pr.maxCP
      ? `${pr.minCP.toLocaleString()} CP`
      : `${pr.minCP.toLocaleString()}~${pr.maxCP.toLocaleString()} CP`;
    summaryHtml += `
      <div class="price-summary cc-price">
        <div class="price-range">${priceText}</div>
        <div class="price-detail">카오스큐브 ${cc.ladder ? '래더' : '논래더'} 매물 ${pr.count}건 (평균 ${pr.avgCP.toLocaleString()} CP)</div>
      </div>`;
  }

  if (!summaryHtml) {
    summaryHtml = `
      <div class="price-summary no-data">
        <div class="price-range">시세 데이터가 부족합니다</div>
        <div class="price-detail">아래 외부 링크에서 직접 확인해주세요</div>
      </div>`;
  }

  priceInfo.innerHTML = summaryHtml;

  // Stat comparison
  if (data.statComparison && data.statComparison.length > 0) {
    statComparison.classList.remove('hidden');
    let barsHtml = '';
    for (const sc of data.statComparison) {
      const cls = sc.quality >= 100 ? 'perfect' : sc.quality >= 70 ? 'high' : sc.quality >= 40 ? 'mid' : 'low';
      barsHtml += `
        <div class="stat-bar-item">
          <div class="stat-bar-label">
            <span>${sc.stat}: <strong>${sc.userValue}</strong>${sc.isPerfect ? ' (Perfect!)' : ''}</span>
            <span class="range">${sc.min} ~ ${sc.max}</span>
          </div>
          <div class="stat-bar">
            <div class="stat-bar-fill ${cls}" style="width: ${Math.min(100, Math.max(5, sc.quality))}%"></div>
          </div>
        </div>`;
    }
    statBars.innerHTML = barsHtml;
  }

  // Trade history
  if (d2io.trades && d2io.trades.length > 0) {
    tradeHistory.classList.remove('hidden');
    let tradesHtml = '';
    for (const t of d2io.trades.slice(0, 10)) {
      tradesHtml += `
        <div class="trade-item">
          <span class="trade-price">${escapeHtml(t.priceText.substring(0, 80))}</span>
          ${t.date ? `<span class="trade-date">${escapeHtml(t.date)}</span>` : ''}
        </div>`;
    }
    tradeList.innerHTML = tradesHtml;
  }

  // External links
  externalLinks.classList.remove('hidden');
  const encodedName = encodeURIComponent(itemName);
  let linksHtml = '';

  if (d2io.url) {
    linksHtml += `<a href="${d2io.url}" target="_blank" class="link-item">diablo2.io 시세</a>`;
  }
  linksHtml += `<a href="https://diablo2.io/database/?q=${encodedName}" target="_blank" class="link-item">diablo2.io DB</a>`;

  if (d2trader.url) {
    linksHtml += `<a href="${d2trader.url}" target="_blank" class="link-item">D2Trader.net</a>`;
  }

  if (cc.url) {
    linksHtml += `<a href="${cc.url}" target="_blank" class="link-item">카오스큐브</a>`;
  }

  linksHtml += `<a href="https://traderie.com/diablo2resurrected/products?search=${encodedName}" target="_blank" class="link-item">Traderie</a>`;

  linkList.innerHTML = linksHtml;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
