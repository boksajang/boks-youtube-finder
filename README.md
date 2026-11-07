# ⚡ Boks YouTube Finder (유튜브 떡상 레이더)

> **"월 수만 원짜리 유료 툴, 강의팔이들의 프로그램을 완벽히 대체하는 무료 생태계 교란 프로젝트"**  
> 유튜브 떡상 소재 자동 추천 및 아웃라이어 채널 분석 크로스플랫폼 데스크톱 앱

---

## 🎯 기획 의도 & 철학

1. **최소한의 입력, 최대한의 결과**: 키워드 하나만 넣으면 떡상 영상 추출부터 AI 기획안 추천까지 한 번에 끝냅니다.
2. **API 비용 0원 (로컬 CLI 호출)**: 비싼 종량제 LLM API 키 없이, PC에 설치된 **Claude CLI** 또는 **Codex CLI** 세션을 직접 호출합니다.
3. **무결점 다크 모드 UI**: 해상도 변경 시에도 컨트롤 겹침, 잘림, 스크롤 이상이 없는 견고한 반응형 레이아웃을 제공합니다.
4. **빌드 없이 소스로 직행**: 번거로운 패키징 빌드 없이, `npm start` 명령어 하나로 윈도우와 맥에서 즉시 실행됩니다.

---

## 🚀 핵심 기능

### 1. 🔥 떡상 아웃라이어(Outlier) 자동 탐지
- **떡상 배수 공식**: `(영상 조회수 / 채널 구독자 수)`를 실시간으로 계산.
- 구독자 1,000명인데 조회수 5만, 10만이 터진 '알짜배기 떡상 영상'을 핀셋 추출 (3x, 5x, 10x 필터링).

### 2. 🎬 숏폼(Shorts) vs 롱폼 분리 매트릭스
- 영상 재생시간을 실시간 파싱하여 60초 이하 숏폼과 롱폼을 원클릭으로 분리 조회 및 성과 비교.

### 3. 💡 AI 떡상 기획안 자동 추천기 (Claude / Codex CLI)
- 수집된 상위 떡상 영상들의 제목, 태그, 이상치 배수를 로컬 AI 엔진으로 파이프 연결.
- **지금 터지는 후킹 패턴 3가지 요약**
- **초보 부업러 맞춤 추천 기획안 TOP 3 (제목 후보, 썸네일 비주얼 가이드, 10초 오프닝 스크립트 뼈대)**
- **대형 채널과 경쟁을 피하는 블루오션(빈집) 틈새 앵글 제시**

### 4. ⚙️ 크로스플랫폼 환경설정
- **Windows & macOS 완벽 지원**: OS별 CLI 실행 경로(`where` / `which`) 자동 탐색.
- Google Cloud의 무료 YouTube Data API v3 키 로컬 보안 저장.

---

## 🛠️ 시작하기 (Quick Start)

### 필수 요구사항
- [Node.js](https://nodejs.org/) (v18.0 이상 권장)
- YouTube Data API v3 키 ([무료 발급 가이드](https://console.cloud.google.com/apis/library/youtube.googleapis.com))
- Claude CLI (`npm install -g @anthropic-ai/claude-code`) 또는 Codex CLI (선택)

### 실행 방법

```bash
# 1. 저장소 클론
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
├── index.html               # 다크 모드 시맨틱 UI 레이아웃
├── styles.css               # 완벽 반응형 CSS (Flexbox / Grid, No-Overflow)
├── renderer.js              # UI 상태 관리, 검색 파이프라인, AI 기획 렌더링
├── services/
│   ├── config.js            # userData 설정(API 키, CLI 경로) 로컬 관리
│   ├── youtube.js           # YouTube Data API v3 연동 및 떡상 배수 계산
│   └── ai-cli.js            # Claude/Codex CLI 크로스플랫폼 비동기 호출 & 프롬프트 엔진
├── package.json             # Electron 및 프로젝트 설정
└── README.md                # 프로젝트 문서
```

---

## 📜 라이선스
MIT License © 2026 복사장 (Boksajang)
