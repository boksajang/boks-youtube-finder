# ⚡ Boks YouTube Finder (유튜브 떡상 레이더)

> **"월 수만 원짜리 유료 툴, 강의팔이들의 프로그램을 완벽히 대체하는 무료 생태계 교란 프로젝트"**  
> 유튜브 떡상 소재 자동 추천, 아웃라이어 산점도 시각화 및 시장 기회 분석 데스크톱 앱 (Electron + YouTube Data API + Claude/Codex CLI)

---

## 🎯 기획 의도 & 철학

1. **최소한의 입력, 최대의 시각적 결과**: 키워드 하나만 넣으면 떡상 영상 추출, 2D 산점도 차트, 키워드 빈도, 시장 기회 지수, AI 기획안 추천까지 한 번에 끝냅니다.
2. **한국(KR) 최적화 타겟팅**: 아랍·인도 등 불필요한 해외 영상 노출 없이, 한국어 및 대한민국 지역을 기본 필터링하며 글로벌 타겟팅 전환도 지원합니다.
3. **API 비용 0원 (로컬 CLI 호출)**: 비싼 종량제 LLM API 키 없이, PC에 설치된 **Claude CLI** 또는 **Codex CLI** 세션을 직접 호출합니다.
4. **무결점 다크 모드 UI**: 해상도 변경 시에도 컨트롤 겹침, 잘림, 스크롤 이상이 없는 견고한 반응형 레이아웃을 제공합니다.
5. **빌드 없이 소스로 직행**: 번거로운 패키징 빌드 없이, `npm start` 명령어 하나로 윈도우와 맥에서 즉시 실행됩니다.

---

## 🚀 핵심 기능 (유료 툴 완벽 대체)

### 1. 🇰🇷 국가 및 언어 정밀 타겟팅
- **기본값**: 대한민국(`KR`) 및 한국어(`ko`) 우선 정밀 타겟팅.
- 미국(`US`), 일본(`JP`), 글로벌 전체(`ALL`) 즉시 전환 가능.

### 2. 📊 떡상 매트릭스 2D 산점도 차트 (Interactive Scatter Plot)
- **X축(채널 구독자수) vs Y축(영상 조회수)** 로그 스케일 분포 매핑.
- **기준선 지원**: 3배(⚡ 떡상 기준선), 10배(🔥 슈퍼 떡상 기준선) 점선 가이드.
- **인터랙티브 툴팁 & 점프**: 마우스 호버 시 영상 정보 툴팁 노출, 버블 클릭 시 메인 피드의 해당 영상 카드로 자동 스크롤 및 하이라이트!

### 3. 🎯 시장 진입 기회 지수 (Opportunity Score Gauge)
- 상위 40개 영상 중 **'구독자 2만 이하 소형 채널의 점유율과 떡상 비중'**을 종합 분석.
- `🟢 기회 매우 높음 (빈집 털이 최적)`, `🟡 경쟁 보통`, `🔴 대형 채널 독점` 상태를 게이지 바로 시각화.

### 4. 🏷️ 떡상 제목 빈출 키워드 TOP 10 & 요일별 분포
- 상위 떡상 영상들의 제목에서 불용어를 제외한 **핵심 후킹 단어 출현 빈도 바 차트** 제공.
- 키워드 클릭 시 해당 단어가 포함된 영상만 즉시 필터링.
- 떡상 영상들이 주로 업로드된 요일별(월~일) 성과 히트 차트.

### 5. 🔥 떡상 아웃라이어(Outlier) & 속도(Velocity) 추적
- **떡상 배수 공식**: `(영상 조회수 / 채널 구독자 수)`를 실시간 계산 (3x, 5x, 10x 필터).
- **일일 조회수 증가량**: `(조회수 / 게시 후 경과 일수)`로 현재 실시간 터지고 있는 급상승 영상 추적.
- **숏폼(Shorts) vs 롱폼 분리**: 60초 이하 쇼츠 원클릭 분리.

### 6. 💡 AI 떡상 기획안 자동 추천기 (Claude / Codex CLI)
- 수집된 상위 떡상 영상들의 메타데이터를 로컬 AI 엔진으로 파이프 연결.
- **지금 터지는 후킹 패턴 3가지 분석**
- **초보 부업러 맞춤 추천 기획안 TOP 3 (제목 후보, 썸네일 비주얼 가이드, 10초 오프닝 스크립트 뼈대)**
- **대형 채널과 경쟁을 피하는 블루오션(빈집) 틈새 앵글 제시**

### 7. 📥 엑셀 호환 CSV 내보내기
- 수집된 모든 영상의 상세 메트릭(ID, 제목, 채널, 구독자, 조회수, 떡상배수, 일일증가량, URL 등)을 **UTF-8 BOM 인코딩 CSV**로 원클릭 추출 (엑셀 한글 깨짐 없음).

---

## 🛠️ 시작하기 (Quick Start)

### 필수 요구사항
- [Node.js](https://nodejs.org/) (v18.0 이상 권장)
- YouTube Data API v3 키 ([무료 발급 가이드](https://console.cloud.google.com/apis/library/youtube.googleapis.com))
- Claude CLI (`npm install -g @anthropic-ai/claude-code`) 또는 Codex CLI (선택)

### 실행 방법

```bash
# 1. 저장소 클론 (또는 git pull)
git clone https://github.com/boksajang/boks-youtube-finder.git
cd boks-youtube-finder

# 2. 의존성 설치
npm install

# 3. 앱 실행
npm start
```

---

## 📁 프로젝트 구조

```
boks-youtube-finder/
├── main.js                  # Electron 메인 프로세스 (IPC 핸들러 및 윈도우 관리)
├── preload.js               # ContextIsolation 안전 IPC 브릿지
├── index.html               # 다크 모드 시맨틱 UI & 차트 대시보드 레이아웃
├── styles.css               # 완벽 반응형 CSS (Flexbox / Grid, No-Overflow)
├── renderer.js              # UI 상태 관리, Canvas 2D 산점도, 키워드 분석, CSV 추출
├── services/
│   ├── config.js            # userData 설정(API 키, CLI 경로) 로컬 관리
│   ├── youtube.js           # YouTube Data API 연동, 국가/언어 필터링, 시장 기회 지수 계산
│   └── ai-cli.js            # Claude/Codex CLI 크로스플랫폼 비동기 호출 & 프롬프트 엔진
├── package.json             # Electron 및 프로젝트 설정
└── README.md                # 프로젝트 문서
```

---

## 📜 라이선스
MIT License © 2026 복사장 (Boksajang)
