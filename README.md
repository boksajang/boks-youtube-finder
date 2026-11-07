# ⚡ Boks YouTube Finder (유튜브 떡상 레이더)

> **"월 수만~수십만 원짜리 유료 툴, 강의팔이들의 프로그램을 완벽히 대체하는 무료 생태계 교란 프로젝트"**  
> 복사장의 3대 원칙: **메뉴 최소화 · 입력 최소화 · 한 화면에서 끝내는 올인원 대시보드**  
> (Electron + YouTube Data API v3 + Claude/Codex CLI)

---

## 🎯 기획 철학 & 아키텍처

1. **메뉴는 최소한이다**: 복잡하게 분절된 여러 탭을 오갈 필요 없이, **단일 올인원 대시보드(Single-Pane of Glass)**에서 모든 핵심 분석을 끝냅니다.
2. **사용자 입력도 최소한이다**: 검색창에 **키워드 단 하나**만 입력하면 끝입니다. 국가(KR), 언어(ko), 배수 필터(3x ⚡)는 가장 똑똑한 기본값으로 자동 최적화됩니다.
3. **최대한 한 화면에 중요 정보를 한눈에**:
   - **상단 3대 인사이트 트라이어드**: 시장 진입 기회 지수 게이지 + 2D 떡상 매트릭스 산점도 + 제목 치트키 키워드 TOP 8
   - **하단 실전 액션 워크벤치**: [좌측] 떡상 아웃라이어 영상 피드와 [우측] AI 실전 추천 기획안(제목, 썸네일, 10초 훅)이 나란히 배치되어 스크롤 없이 한눈에 파악됩니다.
4. **API 과금 0원 (로컬 CLI 무과금 호출)**: 비싼 종량제 LLM API 키 없이, PC에 설치된 **Claude CLI** 또는 **Codex CLI**를 직접 파이프로 호출합니다.

---

## 🚀 올인원 대시보드 핵심 기능

### 1. 🎯 시장 진입 기회 지수 (Opportunity Score Gauge)
- 상위 영상 중 **'구독자 2만 이하 소형 채널의 침투율과 떡상 비중'**을 종합 분석하여 빈집 털이 시장인지 대형 독점 시장인지 컬러 게이지바로 즉시 진단합니다.

### 2. 📊 컴팩트 2D 떡상 매트릭스 산점도 (Interactive Scatter Plot)
- **X축(구독자수) vs Y축(조회수)** 로그 스케일 분포.
- 3배(⚡) 및 10배(🔥) 기준선 위로 솟아오른 기획력 승부 영상들을 마우스 호버 및 클릭으로 즉시 카드와 연동 하이라이트.

### 3. 🏷️ 제목 치트키 키워드 TOP 8 & 원클릭 필터링
- 상위 떡상 영상들의 제목에서 공통으로 쓰인 빈출 단어를 추출하여 태그 칩으로 제공. 클릭 시 해당 키워드 영상만 즉시 필터링.

### 4. 🔥 떡상 아웃라이어 피드 & 숨은 SEO 태그 복사
- **떡상 배수 공식**: `(조회수 / 구독자 수)` 실시간 정렬 (3배, 5배, 10배).
- **일일 조회수 증가량**: `(조회수 / 게시 후 경과 일수)`로 실시간 급상승 여부 추적.
- **🏷️ 태그 복사 버튼**: 영상에 숨겨진 메타 SEO 태그를 클릭 한 번으로 클립보드에 전체 복사.

### 5. ✨ 실전 AI 떡상 기획안 3종 (우측 패널 상시 노출)
- **떡상 핵심 패턴 3가지 분석**
- **초보 크리에이터 맞춤 추천 기획안 TOP 3 (제목 후보, 썸네일 시각화 컨셉, 10초 오프닝 스크립트 뼈대)**
- **대형 채널을 피하는 블루오션(빈집) 틈새 앵글 제시**

### 6. 📥 엑셀 호환 UTF-8 BOM CSV 내보내기
- 한 번의 클릭으로 모든 분석 메트릭을 엑셀 한글 깨짐 없는 CSV로 즉시 다운로드.

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

# 2. 의존성 설치 (Electron 1개만 설치되므로 수초 내 완료)
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
├── index.html               # 올인원 단일 대시보드 시맨틱 마크업
├── styles.css               # 완벽 반응형 다크 대시보드 CSS (Flexbox / Grid)
├── renderer.js              # 올인원 상태 제어, 2D Canvas 산점도, AI 연동, CSV 추출
├── services/
│   ├── config.js            # userData 설정(API 키, CLI 경로) 지연 평가 안전 관리
│   ├── youtube.js           # YouTube Data API 연동, 배치 최적화, 기회 지수 계산
│   └── ai-cli.js            # Claude/Codex CLI 크로스플랫폼 파이프라인 & 프롬프트 엔진
├── package.json             # 프로젝트 및 Electron 설정
└── README.md                # 프로젝트 문서
```

---

## 📜 라이선스
MIT License © 2026 복사장 (Boksajang)
