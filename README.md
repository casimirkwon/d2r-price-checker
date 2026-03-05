# D2R 아이템 시세 조회기

디아블로 2 레저렉션(D2R) 게임 스크린샷에서 아이템을 인식하고 시세를 조회하는 웹 앱.

## 기능

- **OCR 아이템 인식** — 한국어 D2R 스크린샷에서 아이템명/스탯 자동 추출
- **아이템 식별** — 한국어 → 영어 아이템명 매핑, 스탯 파싱
- **시세 조회** — 3개 소스에서 가격 수집
  - [diablo2.io](https://diablo2.io) — 실시간 거래 내역 및 룬 가격
  - [D2Trader.net](https://d2trader.net) — 아이템 가격 및 스탯 범위
  - [카오스큐브](https://www.chaoscube.co.kr) — 한국 거래소 CP 시세
- **스탯 품질 분석** — 내 아이템 스탯이 최소~최대 범위 중 어디인지 시각화
- **래더/스탠다드** 전환 지원

## 설치 및 실행

### 요구사항

- **Node.js 18** 이상 ([다운로드](https://nodejs.org/))

### 설치

```bash
git clone https://github.com/casimirkwon/d2r-price-checker.git
cd d2r-price-checker
npm install
npm start
```

> **주의:** `package-lock.json`을 삭제하지 마세요. 의존성 버전이 고정되어 있어 삭제 후 재설치하면 Node 18에서 호환되지 않는 버전이 설치될 수 있습니다.

브라우저에서 http://localhost:3000 접속.

### 개발 모드 (파일 변경 시 자동 재시작)

```bash
npm run dev
```

## 사용법

1. 브라우저에서 http://localhost:3000 접속
2. D2R 게임 스크린샷을 **Ctrl+V** 붙여넣기, 드래그&드롭, 또는 파일 선택
3. **아이템 인식하기** 클릭 → OCR 결과 확인 (필요시 수정 가능)
4. **아이템 분석 & 시세 조회** 클릭 → 아이템 정보 및 시세 표시

## 프로젝트 구조

```
├── server/
│   ├── index.js          # Express 서버 (API 엔드포인트)
│   ├── ocr.js            # Tesseract.js OCR 처리
│   ├── itemParser.js     # 아이템 텍스트 파싱 (한→영 매핑, 스탯 추출)
│   └── priceLookup.js    # 외부 사이트 시세 조회
├── public/
│   ├── index.html        # 프론트엔드 HTML
│   ├── style.css         # 스타일시트
│   └── app.js            # 프론트엔드 로직
├── data/
│   ├── item-mapping.json # 한국어↔영어 아이템명 매핑 데이터
│   └── d2io-topics.json  # diablo2.io 아이템 ID 캐시
├── package.json
└── test-e2e.mjs          # E2E 테스트
```

## API 엔드포인트

| 엔드포인트 | 메서드 | 설명 |
|---|---|---|
| `/api/ocr` | POST | 이미지 → OCR 텍스트 (multipart/form-data, `image` 필드) |
| `/api/identify` | POST | OCR 텍스트 → 아이템 정보 (`{ text }`) |
| `/api/price` | POST | 아이템 시세 조회 (`{ itemNameEn, itemNameKo, baseTypeEn, stats, ladder }`) |

## 환경 변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 서버 포트 |
