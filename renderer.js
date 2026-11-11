// ==========================================================================
// BOKS YOUTUBE FINDER - Dashboard Controller (Renderer)
// ==========================================================================

const $ = (id) => document.getElementById(id);

const state = {
  config: null,
  keyword: '',
  videos: [],
  analytics: null,
  excluded: { live: 0 },
  keywordFilter: '',
  searching: false,
  searchSeq: 0,
  aiSeq: 0,
  aiRunning: false,
  aiReport: null,
  format: 'all',      // 마지막으로 검색한 형식(검색 조건)
  feedView: 'all',    // 전체 검색일 때 목록에서 볼 형식
  tab: 'feed',        // 왼쪽 패널 탭: feed | trends
  trends: null,
  openTags: new Set(), // 태그 패널을 펼친 영상 id
  searched: false,     // 한 번이라도 검색했는지(키워드 없이 검색할 수 있어 keyword 로는 판단할 수 없음)
  label: '',           // 화면·AI에 쓰는 검색 이름(키워드 또는 "대한민국 인기 영상" 같은 조건 이름)
  // 검색 조건 중 툴바 밖(국가·언어 팝오버)에서 고르는 값
  region: 'KR',
  language: 'ko',
  langOnly: true,
  category: '0',       // 카테고리 목록을 받기 전에 복원할 값
  customFrom: '',
  customTo: '',
  regions: [],
  categories: [],
  activePreset: '',
  source: 'search',    // 마지막 결과의 출처: search(검색) | chart(YouTube 인기 차트)
  lastRequest: null,   // 마지막 검색 요청({ query, opts }) — [다시 시도]·[새로 검색]에 쓴다
  cachedAt: 0,         // 지금 결과가 저장된 결과면 그 시각(ms)
  saving: false,       // 설정 저장 중(모달 닫기 막음)
  searchInfo: null,    // 마지막 결과의 검색 정보(검색 횟수·출처)
  pendingRerun: null,  // 검색 중에 조건이 바뀌면 { label, chartOk } — 끝난 뒤 다시 검색
  keyCheck: null,      // 설정 창에서 [키 확인]으로 확인한 키와 시각
  settingsReturnFocus: null, // 설정 창을 닫으면 포커스를 돌려줄 요소
  clearCacheTimer: 0,  // [캐시 비우기] 두 번 누르기 대기 타이머
  aiModels: null,      // 설정 창을 열 때 CLI 에서 받은 모델·추론 수준 목록 { claude, codex }
  modelsReq: 0         // 모델 목록 요청 번호(늦게 도착한 이전 응답 무시)
};

const LANGS = [
  ['ko', '한국어'], ['en', '영어'], ['ja', '일본어'], ['zh-Hans', '중국어(간체)'], ['zh-Hant', '중국어(번체)'],
  ['es', '스페인어'], ['fr', '프랑스어'], ['de', '독일어'], ['pt', '포르투갈어'], ['vi', '베트남어'],
  ['th', '태국어'], ['id', '인도네시아어'], ['hi', '힌디어'], ['ru', '러시아어']
];
const LANG_NAME = Object.fromEntries(LANGS);
const FORMAT_NAME = { all: '영상', long: '롱폼', shorts: '쇼츠' };
const SEARCH_COST = { all: '3~6회', long: '2~4회', shorts: '1~3회' };

// 빠른 시작: 키워드 없이 조건만으로 인기 영상 분석
//   source 'chart'  = YouTube 인기 차트(국가·주제별 지금 인기 영상, 검색 한도 0회 · 조회 2 유닛). 기간 조건 없음
//   source 'search' = 조회수순 검색(쇼츠는 인기 차트에 거의 오르지 않아 검색으로 찾는다)
const PRESETS = [
  { id: 'popular', source: 'chart', title: r => `${r} 인기 영상`, desc: '인기 차트 · 쇼츠·롱폼', format: 'all', category: '0' },
  { id: 'shorts', source: 'search', title: () => '지금 뜨는 쇼츠', desc: '최근 24시간 · 쇼츠', format: 'shorts', period: '24h', category: '0' },
  { id: 'long', source: 'chart', title: () => '인기 롱폼', desc: '인기 차트 · 롱폼', format: 'long', category: '0' },
  { id: 'ent', source: 'chart', title: () => '엔터테인먼트', desc: '인기 차트 · 엔터테인먼트', format: 'all', category: '24' },
  { id: 'music', source: 'chart', title: () => '음악', desc: '인기 차트 · 음악', format: 'all', category: '10' },
  { id: 'game', source: 'chart', title: () => '게임', desc: '인기 차트 · 게임', format: 'all', category: '20' }
];

// 상단 검색 조건 기억(키워드 제외). 브라우저 저장소는 app-data/electron 안에 있다.
// 시작 조건 = 설정의 검색 기본값. [마지막 검색 조건 이어서 쓰기]가 켜져 있으면 저장된 조건으로 덮어쓴다.
// v2: 목록 배수 필터 기본값 '전체'(목록 = 분석 대상), 검색 기준 추가 / 이후 국가·언어·직접 기간·결과 필터 추가
const PREFS_KEY = 'boks.prefs.v2';
const LEGACY_PREFS_KEY = 'boks.prefs.v1';
const LIST_DEFAULTS = { minRatio: '0', minViews: '0', subsRange: 'all', sort: 'ratio' };

function searchDefaults(c = state.config || {}) {
  return {
    format: c.defaultFormat || 'all', period: c.defaultPeriod || '7d', order: c.defaultOrder || 'viewCount', category: '0',
    region: c.region || 'KR', language: c.language || 'ko', langOnly: c.langOnly !== false, customFrom: '', customTo: ''
  };
}

function loadPrefs() {
  const base = { ...searchDefaults(), ...LIST_DEFAULTS };
  const read = key => {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  };
  try {
    // 목록 필터·정렬은 항상 이어 쓰고, 검색 조건은 설정에 따라 이어 쓴다
    let cur = read(PREFS_KEY);
    if (!cur) {
      const old = read(LEGACY_PREFS_KEY);
      if (old) { const { minRatio, ...rest } = old; cur = rest; } // 예전 기본값 '3배 이상'은 가져오지 않는다
    }
    if (!cur) return base;
    const list = Object.fromEntries(Object.keys(LIST_DEFAULTS).filter(k => k in cur).map(k => [k, cur[k]]));
    const search = state.config?.rememberLast === false ? {} : cur;
    return { ...base, ...search, ...list };
  } catch { /* 손상 → 기본값 */ }
  return base;
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      format: selectedFormat(), period: selectedPeriod(), order: selectedOrder(), category: selectedCategory(),
      region: state.region, language: state.language, langOnly: state.langOnly, customFrom: state.customFrom, customTo: state.customTo,
      minRatio: el.outlierFilter.value, minViews: el.viewsFilter.value, subsRange: el.subsFilter.value, sort: el.sortSelect.value
    }));
  } catch { /* 저장소를 쓸 수 없으면 이번 실행에서만 유지 */ }
}

function setSegment(group, attr, value) {
  const btns = [...group.querySelectorAll('.seg-btn')];
  const target = btns.find(b => b.dataset[attr] === value) || btns.find(b => b.dataset[attr] === 'all') || btns[0];
  btns.forEach(b => b.classList.toggle('active', b === target));
  return target.dataset[attr];
}

function setSelect(select, value) {
  if ([...select.options].some(o => o.value === value)) select.value = value;
}

function applyPrefs(p) {
  setSegment(el.formatToggle, 'format', p.format);
  // 직접 지정 기간은 날짜가 있어야 쓸 수 있다
  const custom = p.period === 'custom' && p.customFrom && p.customTo;
  setSegment(el.periodToggle, 'period', p.period === 'custom' && !custom ? '7d' : p.period);
  setSegment(el.orderToggle, 'order', p.order);
  state.region = /^[A-Z]{2}$/.test(p.region) ? p.region : 'KR';
  state.language = LANG_NAME[p.language] ? p.language : 'ko';
  state.langOnly = p.langOnly !== false;
  state.customFrom = p.customFrom || '';
  state.customTo = p.customTo || '';
  state.category = String(p.category || '0');
  setSelect(el.categoryFilter, state.category);
  setSelect(el.outlierFilter, String(p.minRatio));
  setSelect(el.viewsFilter, String(p.minViews));
  setSelect(el.subsFilter, String(p.subsRange));
  setSelect(el.sortSelect, String(p.sort));
  updateConditionLabels();
}

const selectedFormat = () => el.formatToggle.querySelector('.seg-btn.active')?.dataset.format || 'all';
const selectedPeriod = () => el.periodToggle.querySelector('.seg-btn.active')?.dataset.period || 'all';
const selectedOrder = () => el.orderToggle.querySelector('.seg-btn.active')?.dataset.order || 'viewCount';
// 카테고리 목록을 아직 못 받았으면 복원할 값을 그대로 쓴다
const selectedCategory = () => (state.categories.length ? el.categoryFilter.value : state.category);

const OUTLIER = 3;
const MEGA = 10;
const BASELINE_FLOOR = 1000; // services/youtube.js 와 동일: 평소 조회수 하한
const EXAMPLES = ['AI 부업', '쇼츠 자동화', '재테크 초보', '자취 요리'];
const regionName = (id = state.region) => (state.regions.find(r => r.id === id) || {}).name || (id === 'KR' ? '대한민국' : id);
const categoryName = (id = selectedCategory()) => (state.categories.find(c => c.id === id) || {}).name || '';

const el = {
  searchForm: $('search-form'), searchInput: $('search-input'), searchBtn: $('search-btn'),
  formatToggle: $('format-toggle'), orderToggle: $('order-toggle'), outlierFilter: $('outlier-filter'), categoryFilter: $('category-filter'),
  periodToggle: $('period-toggle'), sortSelect: $('sort-select'), sortField: $('sort-field'),
  leftTabs: $('left-tabs'), trendView: $('trend-view'), feedFormat: $('feed-format'), filterKw: $('filter-kw'), filterNote: $('filter-note'),
  usageMeter: $('usage-meter'), usageHint: $('usage-hint'), legendShorts: $('legend-shorts'),
  btnSettings: $('btn-open-settings'), settingsAlert: $('settings-alert'),
  insights: $('insights'), gaugeLevel: $('gauge-level'), gaugeScore: $('gauge-score'), gaugeFill: $('gauge-fill'),
  metricSmallShare: $('metric-small-share'), metricSmallOutliers: $('metric-small-outliers'), gaugeAdvice: $('gauge-advice'),
  scatterBox: $('scatter-box'), scatterCanvas: $('scatter-canvas'), scatterTooltip: $('scatter-tooltip'), scatterNote: $('scatter-note'),
  keywordChips: $('keyword-chips'), keywordBasis: $('keyword-basis'),
  kpiOutliers: $('kpi-outliers'), kpiMax: $('kpi-max'), kpiAvgViews: $('kpi-avg-views'), kpiMedianSubs: $('kpi-median-subs'),
  feed: $('video-feed'), feedCount: $('feed-count'), filterBar: $('filter-bar'), filterWord: $('filter-word'), filterClear: $('filter-clear'),
  aiBody: $('ai-body'), aiEnginePill: $('ai-engine-pill'), btnAiRun: $('btn-ai-run'), btnAiStop: $('btn-ai-stop'),
  modal: $('settings-modal'), apiKey: $('setting-api-key'), btnToggleKey: $('btn-toggle-key'), keyStorageHint: $('key-storage-hint'),
  engineToggle: $('engine-toggle'), claudePath: $('setting-claude-path'), codexPath: $('setting-codex-path'),
  detectClaudeStatus: $('detect-claude-status'), detectCodexStatus: $('detect-codex-status'),
  saveBtn: $('save-settings-btn'), cancelBtn: $('btn-cancel-settings'), closeBtn: $('btn-close-settings'), saveFeedback: $('save-feedback'),
  toastHost: $('toast-host'), winMax: $('win-max'),
  customLabel: $('custom-label'), btnAdvanced: $('btn-advanced'), advSummary: $('adv-summary'), advPopover: $('adv-popover'),
  regionSelect: $('region-select'), langSelect: $('lang-select'), langOnly: $('lang-only'), customFrom: $('custom-from'), customTo: $('custom-to'),
  advFeedback: $('adv-feedback'), advCancel: $('adv-cancel'), advApply: $('adv-apply'), presets: $('presets'),
  viewsFilter: $('views-filter'), subsFilter: $('subs-filter'),
  keyCheckStatus: $('key-check-status'), btnCheckKey: $('btn-check-key'),
  defRegion: $('def-region'), defLang: $('def-lang'), defFormat: $('def-format'), defPeriod: $('def-period'), defOrder: $('def-order'),
  defLangOnly: $('def-lang-only'), defRemember: $('def-remember'), defIncludeReligion: $('def-include-religion'),
  setSearchLimit: $('set-search-limit'), setUnitLimit: $('set-unit-limit'), setCacheTtl: $('set-cache-ttl'), setResultCache: $('set-result-cache'),
  btnRefresh: $('btn-refresh'), cacheAge: $('cache-age'),
  btnClearCache: $('btn-clear-cache'), cacheStats: $('cache-stats'), btnResetDefaults: $('btn-reset-defaults'),
  aiModelsStatus: $('ai-models-status'), btnRefreshModels: $('btn-refresh-models'),
  model: {
    claude: { model: $('set-claude-model'), effort: $('set-claude-effort'), custom: $('set-claude-model-custom') },
    codex: { model: $('set-codex-model'), effort: $('set-codex-effort'), custom: $('set-codex-model-custom') }
  }
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function toast(message, type = 'info', action = null) {
  const node = document.createElement('div');
  node.className = `toast ${type}`;
  node.innerHTML = `${icon(type === 'error' ? 'alert' : type === 'success' ? 'check' : 'info')}<span></span>`;
  node.querySelector('span').textContent = message;
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'link-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', () => { action.onClick(); node.remove(); });
    node.appendChild(btn);
  }
  el.toastHost.appendChild(node);
  setTimeout(() => node.remove(), action ? 6000 : 2800);
}

async function copyText(text, okMessage = '클립보드에 복사했습니다.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(okMessage, 'success');
    return true;
  } catch {
    toast('클립보드에 복사하지 못했습니다.', 'error');
    return false;
  }
}

function axisLabel(n) {
  const map = { 1: '1', 10: '10', 100: '100', 1000: '1천', 10000: '1만', 100000: '10만', 1000000: '100만', 10000000: '1천만', 100000000: '1억', 1000000000: '10억' };
  return map[n] || String(n);
}

function engineLabel() {
  return state.config?.aiEngine === 'codex' ? 'Codex' : 'Claude';
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  const res = await window.api.getConfig();
  state.config = res.ok ? res.data : { youtubeApiKey: '', aiEngine: 'claude', claudeCliPath: '', codexCliPath: '' };
  if (!res.ok) toast(res.error.message, 'error');
  if (state.config.keyNeedsReentry) {
    toast('저장된 API 키를 이 PC에서 복호화하지 못했습니다. [설정]에서 키를 다시 입력해 주세요.', 'error', { label: '설정 열기', onClick: openSettings });
  }

  const langItems = LANGS.map(([id, name]) => ({ id, name }));
  fillSelect(el.langSelect, langItems, 'ko');
  fillSelect(el.defLang, langItems, state.config.language || 'ko');
  applyPrefs(loadPrefs());
  setupWindowControls();
  setupEvents();
  setupScatter();
  refreshConfigUI();
  renderFeed();
  renderAiIdle();
  refreshUsage();
  el.searchInput.focus();
  // 국가·카테고리 목록(30일 캐시, 키가 없으면 기본 목록)
  loadRegions();
  loadCategories();
}

/**
 * @param snapshot 사용량(없으면 현재 키 기준으로 받아 온다)
 * @param opts.hintOnly 설정 창 안내에만 표시(저장 전 후보 키 — 타이틀바는 저장된 키 기준 유지)
 */
async function refreshUsage(snapshot, { hintOnly = false } = {}) {
  let u = snapshot;
  if (!u) {
    const res = await window.api.getUsage();
    if (!res.ok) return;
    u = res.data;
  }
  const n = x => x.toLocaleString('ko-KR');
  const reset = u.resetAt ? new Date(u.resetAt).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }) : '오후 4~5시';
  if (el.usageHint) el.usageHint.textContent = `오늘 ${hintOnly ? '확인한 키' : '이 키'} 사용량: 검색 ${n(u.search)}/${n(u.searchLimit)}회 · 조회 ${n(u.units)}/${n(u.unitLimit)} 유닛 · 한국 시간 ${reset}에 초기화`;
  if (hintOnly) return;
  el.usageMeter.hidden = false;
  el.usageMeter.textContent = `오늘 API 검색 ${n(u.search)}/${n(u.searchLimit)} · 조회 ${n(u.units)}/${n(u.unitLimit)}`;
  el.usageMeter.classList.toggle('warn', u.search >= u.searchLimit * 0.8 || u.units >= u.unitLimit * 0.8);
  el.usageMeter.title = `이 PC에서 오늘(태평양 시간 ${u.day}) 이 API 키로 쓴 YouTube API 사용량입니다(키마다 따로 셉니다). 한국 시간 ${reset}에 초기화됩니다. 한도는 [설정]에서 바꿀 수 있습니다. 같은 Google Cloud 프로젝트의 키를 다른 곳에서도 쓰면 실제 사용량은 더 많을 수 있습니다.`;
}

async function setupWindowControls() {
  const res = await window.api.window.state();
  if (res.ok && res.data.platform === 'darwin') document.body.classList.add('is-mac');
  const setMax = (maximized) => {
    el.winMax.innerHTML = icon(maximized ? 'restore' : 'max');
    el.winMax.title = maximized ? '이전 크기로' : '최대화';
    el.winMax.setAttribute('aria-label', el.winMax.title);
  };
  if (res.ok) setMax(res.data.maximized);
  window.api.window.onMaximizedChange(setMax);
  $('win-min').addEventListener('click', () => window.api.window.minimize());
  el.winMax.addEventListener('click', () => window.api.window.toggleMaximize());
  $('win-close').addEventListener('click', () => window.api.window.close());
  // 타이틀바 더블클릭 최대화는 OS가 드래그 영역에서 직접 처리한다.
}

function refreshConfigUI() {
  const hasKey = !!state.config.youtubeApiKey;
  el.settingsAlert.hidden = hasKey;
  const eng = state.config.aiEngine === 'codex' ? 'codex' : 'claude';
  const model = state.config[`${eng}Model`] || '';
  const effort = state.config[`${eng}Effort`] || '';
  el.aiEnginePill.textContent = `${engineLabel()} CLI${model ? ` · ${model}` : ''}`;
  el.aiEnginePill.title = `모델: ${model || 'CLI 기본값'} · 추론 수준: ${effort ? effortLabel(effort) : '기본값'}`;
}

function setupEvents() {
  el.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch();
  });

  // chartOk: 인기 차트 결과를 보고 있을 때 이 조건(형식·주제·국가)만 바뀌면 차트로 다시 받는다(검색 0회)
  const rerun = (label, chartOk = false) => {
    savePrefs();
    state.activePreset = '';
    renderPresets();
    if (!state.searched && !state.searching) return;
    if (state.searching) {
      // 진행 중인 검색이 끝나면 다시 검색(여러 번 바꾸면 차트로 받을 수 있는 변경만 있었을 때만 차트 유지)
      const prev = state.pendingRerun;
      state.pendingRerun = { label, chartOk: chartOk && (!prev || prev.chartOk) };
      toast(`${label} 조건을 바꿨습니다. 지금 검색이 끝나면 이 조건으로 다시 검색합니다.`);
      return;
    }
    rerunSearch(label, chartOk);
  };
  const segHandler = (group, attr, label, chartOk) => group.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.classList.contains('active')) return;
    setSegment(group, attr, btn.dataset[attr]);
    rerun(label, chartOk);
  });
  // 형식·기간·주제는 검색 조건 → 바뀌면 다시 검색
  segHandler(el.formatToggle, 'format', '형식', true);
  // '직접'은 바로 바꾸지 않고 날짜를 고르는 창을 연다
  el.periodToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn && btn.dataset.period === 'custom') { e.stopImmediatePropagation(); openAdvanced(true); }
  }, true);
  segHandler(el.periodToggle, 'period', '기간', false);
  segHandler(el.orderToggle, 'order', '검색 기준', false);
  el.categoryFilter.addEventListener('change', () => { state.category = el.categoryFilter.value; rerun('주제', true); });
  // 저장된 결과를 보고 있을 때: 새로 검색
  el.btnRefresh.addEventListener('click', () => {
    if (state.searching || !state.lastRequest) return;
    handleSearch(state.lastRequest.query, { ...state.lastRequest.opts, fresh: true });
  });
  // 배율이 다른 모니터로 옮기면 CSS 크기는 같아도 산점도를 새 배율로 다시 그린다
  const watchDpr = () => {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { drawScatter(); watchDpr(); }, { once: true });
  };
  watchDpr();
  // 국가·언어·직접 기간
  el.btnAdvanced.addEventListener('click', () => (el.advPopover.hidden ? openAdvanced(false) : closeAdvanced()));
  el.advCancel.addEventListener('click', closeAdvanced);
  el.advApply.addEventListener('click', applyAdvanced);
  window.addEventListener('resize', () => { if (!el.advPopover.hidden) positionAdvanced(); });
  [el.customFrom, el.customTo].forEach(inp => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyAdvanced(); }));
  document.addEventListener('mousedown', (e) => {
    if (el.advPopover.hidden) return;
    if (el.advPopover.contains(e.target) || el.btnAdvanced.contains(e.target) || e.target.closest('[data-period="custom"]')) return;
    closeAdvanced();
  });
  // 빠른 시작
  el.presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.preset[data-preset]');
    if (btn && !btn.disabled) runPreset(btn.dataset.preset);
  });
  // 결과 필터(할당량 사용 없음)
  el.viewsFilter.addEventListener('change', () => { savePrefs(); onClientFilterChange(); });
  el.subsFilter.addEventListener('change', () => { savePrefs(); onClientFilterChange(); });
  // 배수·정렬은 화면 필터 → 다시 그리기만
  el.outlierFilter.addEventListener('change', () => { savePrefs(); onClientFilterChange(); });
  el.sortSelect.addEventListener('change', () => { savePrefs(); renderFeed(); });
  el.feedFormat.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    state.feedView = setSegment(el.feedFormat, 'view', btn.dataset.view);
    onClientFilterChange();
  });
  el.leftTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) setTab(tab.dataset.tab);
  });
  el.trendView.addEventListener('click', onTrendClick);
  // 파일을 창에 떨어뜨려도 페이지가 바뀌지 않도록 차단
  ['dragover', 'drop'].forEach(type => document.addEventListener(type, e => e.preventDefault()));

  el.btnSettings.addEventListener('click', openSettings);
  el.btnAiRun.addEventListener('click', runAi);
  el.btnAiStop.addEventListener('click', () => stopAi());
  el.filterClear.addEventListener('click', () => setKeywordFilter(''));

  // Keyword chips (delegated)
  el.keywordChips.addEventListener('click', (e) => {
    const chip = e.target.closest('.kw-item[data-word]');
    if (chip) setKeywordFilter(state.keywordFilter === chip.dataset.word ? '' : chip.dataset.word);
  });

  // Feed actions (delegated)
  el.feed.addEventListener('click', onFeedClick);
  // 제목(role=link)은 Enter 로도 연다
  el.feed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.vtitle[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  el.feed.addEventListener('error', (e) => {
    if (e.target.tagName === 'IMG') e.target.classList.add('broken');
  }, true);

  // AI panel actions (delegated)
  el.aiBody.addEventListener('click', onAiClick);

  // Settings modal
  el.closeBtn.addEventListener('click', closeSettings);
  el.cancelBtn.addEventListener('click', closeSettings);
  el.modal.addEventListener('mousedown', (e) => { if (e.target === el.modal) closeSettings(); });
  el.saveBtn.addEventListener('click', saveSettings);
  el.apiKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveSettings(); } });
  el.btnCheckKey.addEventListener('click', checkKey);
  el.btnClearCache.addEventListener('click', clearCache);
  el.btnResetDefaults.addEventListener('click', resetSettingDefaults);
  el.btnToggleKey.addEventListener('click', () => {
    const show = el.apiKey.type === 'password';
    el.apiKey.type = show ? 'text' : 'password';
    el.btnToggleKey.textContent = show ? '숨기기' : '보기';
  });
  el.engineToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (btn) setEngineToggle(btn.dataset.engine);
  });
  document.querySelectorAll('.btn-detect').forEach(btn => btn.addEventListener('click', () => detectCli(btn)));
  AI_ENGINES.forEach(e => el.model[e].model.addEventListener('change', () => onModelSelectChange(e)));
  el.btnRefreshModels.addEventListener('click', loadAiModels);
  $('btn-open-console').addEventListener('click', () => window.api.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com'));

  document.addEventListener('keydown', (e) => {
    // 설정 창이 열려 있으면 Esc 는 설정 창만 닫고, 뒤 화면 단축키는 쓰지 않는다
    if (!el.modal.hidden) {
      if (e.key === 'Escape') closeSettings();
      return;
    }
    if (e.key === 'Escape' && !el.advPopover.hidden) { closeAdvanced(); el.btnAdvanced.focus(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      el.searchInput.focus();
      el.searchInput.select();
    }
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function setSearching(on) {
  state.searching = on;
  renderPresets();
  el.searchBtn.disabled = on;
  el.searchBtn.classList.toggle('is-loading', on);
  el.searchBtn.querySelector('.btn-label').textContent = on ? '분석 중' : '분석하기';
  updateAiButton();
}

// 키워드 없이 검색할 때의 이름: "대한민국 인기 영상", "대한민국 게임 인기 쇼츠"
function autoLabel() {
  const cat = selectedCategory() !== '0' ? categoryName() : '';
  return `${regionName()} ${cat ? cat + ' ' : ''}인기 ${FORMAT_NAME[selectedFormat()]}`;
}

// 조건을 바꿔 다시 검색: 검색창에 보이는 키워드로(입력만 하고 제출하지 않은 키워드도 지우지 않고 그대로 쓴다).
// 인기 차트를 보고 있었고 차트로 받을 수 있는 조건(형식·주제·국가)만 바뀌었으면 차트로 다시 받는다.
function rerunSearch(label, chartOk, fromChart = state.source === 'chart') {
  const query = el.searchInput.value.trim();
  const useChart = chartOk && fromChart && !query;
  toast(useChart ? `${label} 조건을 바꿔 인기 차트를 다시 받습니다(검색 0회).`
    : fromChart ? `${label} 조건은 인기 차트에 없어 조회수순 검색으로 바꿉니다(검색 ${SEARCH_COST[selectedFormat()]} 사용).`
    : `${label} 조건을 바꿔 다시 검색합니다.`);
  handleSearch(query, useChart ? { source: 'chart' } : {});
}

/**
 * @param forcedQuery 키워드(비우면 조건에 맞는 인기 영상 전체)
 * @param opts.preset 빠른 시작으로 실행한 경우 그 id, opts.label 표시 이름
 * @param opts.source 'chart' 면 YouTube 인기 차트(키워드·기간 없음, 검색 0회)
 * @param opts.fresh  true 면 저장된 결과를 쓰지 않고 새로 검색
 */
async function handleSearch(forcedQuery, opts = {}) {
  const chart = opts.source === 'chart';
  const query = chart ? '' : (forcedQuery ?? el.searchInput.value).trim();
  if (!chart && selectedPeriod() === 'custom' && !(state.customFrom && state.customTo)) {
    toast('직접 지정할 기간(시작일·종료일)을 먼저 골라 주세요.');
    openAdvanced(true);
    return;
  }
  if (!state.config.youtubeApiKey) {
    toast('YouTube API 키를 먼저 등록해 주세요.', 'error');
    openSettings();
    return;
  }
  if (state.searching) return;

  const seq = ++state.searchSeq;
  el.searchInput.value = query;
  const label = query || opts.label || autoLabel();
  state.lastRequest = { query, opts: { source: opts.source, preset: opts.preset, label: opts.label } };
  state.activePreset = query ? '' : (opts.preset || '');
  setSearching(true);
  stopAi('검색이 끝나면 [기획안 생성]으로 기획안을 만들 수 있습니다.');
  // 검색하는 동안에는 이전 결과의 필터 줄·형식 버튼을 숨긴다(필터를 바꿔 이전 목록이 다시 그려지지 않도록)
  el.filterBar.hidden = true;
  el.btnRefresh.hidden = true;
  el.feed.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
  el.feedCount.textContent = '';

  const res = await window.api.searchYouTube({
    source: chart ? 'chart' : 'search',
    fresh: !!opts.fresh,
    query,
    videoCategoryId: selectedCategory(),
    publishedPeriod: selectedPeriod(),
    customFrom: state.customFrom,
    customTo: state.customTo,
    format: selectedFormat(),
    order: selectedOrder(),
    region: state.region,
    language: state.language,
    langOnly: state.langOnly
  });
  if (seq !== state.searchSeq) return;
  setSearching(false);
  refreshUsage(res.ok ? res.data.usage : undefined);

  // 검색 중에 주제·기간이 바뀌었으면 결과를 버리고 새 조건으로 다시 검색
  if (state.pendingRerun) {
    const p = state.pendingRerun;
    state.pendingRerun = null;
    rerunSearch(p.label || '검색', !!p.chartOk, chart);
    return;
  }

  if (!res.ok) {
    resetResults();
    setTab('feed'); // 트렌드 탭에 있어도 오류 안내가 보이도록
    renderFeedError(res.error);
    renderAiIdle('검색이 완료되면 기획안을 만들 수 있습니다.');
    return;
  }

  state.keyword = query;
  state.label = label;
  state.searched = true;
  state.source = chart ? 'chart' : 'search';
  state.cachedAt = res.data.cached ? res.data.cached.at : 0;
  state.videos = res.data.videos;
  state.analytics = res.data.analytics;
  state.trends = res.data.trends;
  state.format = res.data.format || 'all';
  state.excluded = res.data.excluded || { live: 0 };
  state.searchInfo = res.data.searchInfo || null;
  state.keywordFilter = '';
  state.aiReport = null;
  updateAiButton();
  state.feedView = setSegment(el.feedFormat, 'view', 'all');
  state.openTags.clear();

  if (state.videos.length === 0) {
    el.insights.hidden = true;
    setTab('feed');
    renderFeed();
    renderTrends();
    renderAiIdle('분석할 영상이 없습니다.');
    return;
  }

  renderInsights();
  renderFeed();
  renderTrends();
  const b = res.data.baseline;
  if (b && b.channelFailed) {
    toast('채널 정보를 받지 못해 구독자 수·채널 평소 조회수 없이 표시합니다. 잠시 후 같은 조건으로 다시 검색해 보세요.', 'info');
  } else if (b && b.quotaHit) {
    toast('API 사용 한도 때문에 일부 채널의 평소 조회수를 확인하지 못했습니다. 해당 영상은 구독자 대비 배수로 추정해 표시합니다.', 'info');
  }
  // AI 기획안은 [기획안 생성]을 눌렀을 때만 만든다(CLI 토큰 절약)
  renderAiReady();
}

// 저장된 결과를 보여 주고 있으면 목록 위에 "n분 전 결과 · 새로 검색"을 띄운다
function renderCacheChip() {
  const at = state.cachedAt;
  el.btnRefresh.hidden = !at;
  if (!at) return;
  const min = Math.max(0, Math.round((Date.now() - at) / 60000));
  const ago = min < 1 ? '방금' : min < 60 ? `${min}분 전` : `${Math.floor(min / 60)}시간 ${min % 60 ? `${min % 60}분 ` : ''}전`;
  el.cacheAge.textContent = `${ago} 결과 · 새로 검색`;
  el.btnRefresh.title = `${new Date(at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}에 받은 결과를 다시 보여 주고 있습니다(할당량 0). 누르면 지금 다시 검색합니다.`;
}

function resetResults() {
  stopAi();
  state.keyword = '';
  state.label = '';
  state.searched = false;
  state.videos = [];
  state.analytics = null;
  state.trends = null;
  state.keywordFilter = '';
  state.aiReport = null;
  state.cachedAt = 0;
  state.activePreset = '';
  state.openTags.clear();
  el.insights.hidden = true;
  // 이전 결과의 필터 줄·형식 버튼·안내가 오류 화면 위에 남지 않도록
  el.filterBar.hidden = true;
  el.feedFormat.hidden = true;
  el.filterNote.textContent = '';
  el.btnRefresh.hidden = true;
  renderPresets();
  renderTrends();
  updateAiButton();
}

// ---------------------------------------------------------------------------
// Conditions: 국가·언어·직접 기간·빠른 시작
// ---------------------------------------------------------------------------

const kstToday = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const shortDate = d => { const p = String(d).split('-'); return p.length === 3 ? `${+p[1]}.${+p[2]}` : d; };

// 목록에 현재값이 없으면(기본 목록만 받은 경우 등) 그 값을 항목으로 넣어, 조용히 첫 항목으로 바뀌지 않게 한다
function fillSelect(select, items, value) {
  const list = value && !items.some(it => it.id === value) ? [...items, { id: value, name: value }] : items;
  select.innerHTML = list.map(it => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join('');
  setSelect(select, value);
}

function updateConditionLabels() {
  const lang = LANG_NAME[state.language] || state.language;
  el.advSummary.textContent = `${regionName()} · ${lang}${state.langOnly ? '' : ' 외'}`;
  el.btnAdvanced.title = `국가 ${regionName()} · 언어 ${lang} · ${state.langOnly ? `${lang} 영상만 분석` : '다른 언어 영상도 분석'} · 기간 직접 지정`;
  const custom = state.customFrom && state.customTo;
  el.customLabel.textContent = custom ? `${shortDate(state.customFrom)}~${shortDate(state.customTo)}` : '직접';
  renderPresets();
}

async function loadRegions() {
  const res = await window.api.getRegions();
  // YouTube 국가 이름은 '한국'이라 화면에서는 '대한민국'으로 쓴다
  if (res.ok) state.regions = res.data.items.map(r => (r.id === 'KR' ? { ...r, name: '대한민국' } : r));
  const list = [...state.regions].sort((a, b) => (b.id === 'KR') - (a.id === 'KR'));
  fillSelect(el.regionSelect, list, state.region);
  fillSelect(el.defRegion, list, state.config.region || 'KR');
  updateConditionLabels();
  if (res.ok && res.data.source === 'api') refreshUsage(); // 처음 받을 때 1 유닛 사용
}

async function loadCategories(region = state.region, { resetOnFail = false } = {}) {
  const res = await window.api.getCategories(region);
  if (region !== state.region) return; // 그사이 국가가 바뀌었으면 버림
  if (!res.ok) {
    // 시작할 때는 복원할 주제(state.category)를 그대로 두고, 국가를 바꾼 경우에는 '전체'로 되돌린다
    if (resetOnFail) {
      state.categories = [];
      state.category = '0';
      el.categoryFilter.innerHTML = '<option value="0">전체</option>';
      renderPresets();
    }
    return;
  }
  state.categories = res.data.items;
  const want = state.category;
  el.categoryFilter.innerHTML = '<option value="0">전체</option>' + state.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  setSelect(el.categoryFilter, want);
  state.category = el.categoryFilter.value; // 이 국가에 없는 주제면 '전체'
  renderPresets();
  if (res.ok && res.data.source === 'api') refreshUsage();
}

function renderPresets() {
  if (!el.presets) return;
  const r = regionName();
  // 다시 그려도 키보드 포커스가 사라지지 않도록 포커스가 있던 버튼을 기억했다가 되돌린다
  const focused = el.presets.contains(document.activeElement) ? document.activeElement.dataset.preset : '';
  el.presets.innerHTML = PRESETS.map(p => {
    const missing = p.category !== '0' && state.categories.length > 0 && !state.categories.some(c => c.id === p.category);
    const how = p.source === 'chart'
      ? 'YouTube 인기 차트(지금 인기 영상, 기간 조건 없음) · 검색 0회 · 조회 약 100~300 유닛(채널 캐시가 있으면 더 적음)'
      : `조회수순 검색 · 검색 ${SEARCH_COST[p.format]}`;
    const tip = `${p.title(r)} · ${p.desc} · 키워드 없이 분석 · ${how}${missing ? ' · 이 국가에서는 쓸 수 없는 주제입니다' : ''}`;
    return `<button type="button" class="preset${state.activePreset === p.id ? ' active' : ''}" data-preset="${p.id}" title="${esc(tip)}" aria-disabled="${missing || state.searching}"${missing ? ' disabled' : ''}><strong>${esc(p.title(r))}</strong><span>${esc(p.desc)}</span></button>`;
  }).join('');
  if (focused) {
    const btn = el.presets.querySelector(`[data-preset="${focused}"]`);
    if (btn && !btn.disabled) btn.focus();
  }
}

function runPreset(id) {
  const p = PRESETS.find(x => x.id === id);
  if (!p || state.searching) return;
  el.searchInput.value = '';
  setSegment(el.formatToggle, 'format', p.format);
  // 인기 차트는 기간·검색 기준이 없으므로 툴바의 기간·검색 기준은 그대로 둔다
  if (p.source !== 'chart') {
    setSegment(el.periodToggle, 'period', p.period);
    setSegment(el.orderToggle, 'order', 'viewCount');
  }
  state.category = p.category;
  setSelect(el.categoryFilter, p.category);
  savePrefs();
  handleSearch('', { preset: p.id, label: p.title(regionName()), source: p.source });
}

function openAdvanced(focusDates = false) {
  setSelect(el.regionSelect, state.region);
  setSelect(el.langSelect, state.language);
  el.langOnly.checked = state.langOnly;
  el.customFrom.value = state.customFrom;
  el.customTo.value = state.customTo;
  el.customFrom.max = el.customTo.max = kstToday();
  el.advFeedback.textContent = '';
  el.advFeedback.className = 'form-hint';
  el.advPopover.hidden = false;
  positionAdvanced();
  el.btnAdvanced.setAttribute('aria-expanded', 'true');
  (focusDates ? el.customFrom : el.regionSelect).focus();
}

// 버튼 아래, 창 안쪽에 맞춰 띄운다(툴바가 줄바꿈되면 버튼 위치가 바뀌므로 열 때마다 계산)
function positionAdvanced() {
  const r = el.btnAdvanced.getBoundingClientRect();
  const w = el.advPopover.offsetWidth;
  const h = el.advPopover.offsetHeight;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  const below = r.bottom + 6;
  const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
  el.advPopover.style.left = `${Math.round(left)}px`;
  el.advPopover.style.top = `${Math.round(top)}px`;
}

function closeAdvanced() {
  el.advPopover.hidden = true;
  el.btnAdvanced.setAttribute('aria-expanded', 'false');
}

async function applyAdvanced() {
  const from = el.customFrom.value;
  const to = el.customTo.value;
  const fail = msg => { el.advFeedback.className = 'form-hint err'; el.advFeedback.textContent = msg; };
  if ((from && !to) || (!from && to)) return fail('기간을 직접 지정하려면 시작일과 종료일을 모두 골라 주세요. 쓰지 않으려면 둘 다 비우세요.');
  if (from && to && from > to) return fail('시작일이 종료일보다 늦습니다.');
  if (from && from > kstToday()) return fail('시작일이 오늘보다 늦습니다.');
  const before = JSON.stringify([state.region, state.language, state.langOnly, state.customFrom, state.customTo, selectedPeriod()]);
  const periodBefore = selectedPeriod();
  const region = el.regionSelect.value || state.region;
  const regionChanged = region !== state.region;
  state.region = region;
  state.language = el.langSelect.value || state.language;
  state.langOnly = el.langOnly.checked;
  state.customFrom = from;
  state.customTo = to;
  if (from && to) setSegment(el.periodToggle, 'period', 'custom');
  else if (selectedPeriod() === 'custom') setSegment(el.periodToggle, 'period', '7d');
  closeAdvanced();
  const changed = before !== JSON.stringify([state.region, state.language, state.langOnly, state.customFrom, state.customTo, selectedPeriod()]);
  if (!changed) return;
  state.activePreset = '';
  updateConditionLabels();
  if (regionChanged) {
    state.category = selectedCategory();
    // 새 국가의 주제 목록을 못 받으면 이전 국가의 주제가 남지 않도록 '전체'로 되돌린다
    await loadCategories(state.region, { resetOnFail: true });
  }
  savePrefs();
  // 다른 조건 변경과 같은 규칙: 이미 검색한 결과가 있을 때만 다시 검색(기간이 그대로면 인기 차트는 차트로 다시 받음)
  if (!state.searched && !state.searching) { toast('조건을 바꿨습니다. [분석하기]나 [빠른 시작]을 누르면 이 조건으로 검색합니다.'); return; }
  const chartOk = selectedPeriod() === periodBefore;
  if (state.searching) {
    const prev = state.pendingRerun;
    state.pendingRerun = { label: '국가·언어·기간', chartOk: chartOk && (!prev || prev.chartOk) };
    toast('조건을 바꿨습니다. 지금 검색이 끝나면 이 조건으로 다시 검색합니다.');
    return;
  }
  rerunSearch('국가·언어·기간', chartOk);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function currentFilters() {
  return {
    // 전체 검색일 때만 목록 안에서 쇼츠/롱폼을 나눠 본다(검색 형식이 한 가지면 이미 그 형식뿐)
    format: state.format === 'all' ? state.feedView : 'all',
    minRatio: parseFloat(el.outlierFilter.value) || 0,
    minViews: parseInt(el.viewsFilter.value, 10) || 0,
    subs: parseRange(el.subsFilter.value),
    keyword: state.keywordFilter
  };
}

// 'lo-hi' → { lo, hi }(lo 이상 hi 미만, hi 비면 상한 없음). 'all' → null
function parseRange(v) {
  const m = /^(\d+)-(\d*)$/.exec(String(v || ''));
  return m ? { lo: Number(m[1]), hi: m[2] === '' ? Infinity : Number(m[2]) } : null;
}

function passesFilters(v, f = currentFilters()) {
  if (f.format === 'long' && v.isShorts) return false;
  if (f.format === 'shorts' && !v.isShorts) return false;
  // 배수 필터는 떡상 판정 대상(조회수 하한선 통과) 영상에만 적용
  if (f.minRatio > 0 && !(v.qualifies && v.score >= f.minRatio)) return false;
  if (f.minViews > 0 && v.viewCount < f.minViews) return false;
  // 구독자 범위: 구독자 비공개 채널은 범위를 알 수 없어 뺀다
  if (f.subs && (v.subscriberCount === null || v.subscriberCount === undefined || v.subscriberCount < f.subs.lo || v.subscriberCount >= f.subs.hi)) return false;
  if (f.keyword && !v.title.toLowerCase().includes(f.keyword.toLowerCase())) return false;
  return true;
}

function onClientFilterChange() {
  renderFeed();
  drawScatter();
}

// 목록 필터(형식·배수·조회수·구독자·제목 키워드)를 모두 '전체'로(할당량 사용 없음)
function resetListFilters() {
  el.outlierFilter.value = '0';
  el.viewsFilter.value = '0';
  el.subsFilter.value = 'all';
  state.keywordFilter = '';
  state.feedView = setSegment(el.feedFormat, 'view', 'all');
  savePrefs();
  renderKeywordChips();
  onClientFilterChange();
}

function setKeywordFilter(word) {
  state.keywordFilter = word;
  renderKeywordChips();
  renderFeed();
  drawScatter();
  el.feed.scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

function renderInsights() {
  const a = state.analytics;
  if (!a) return;
  el.insights.hidden = false;

  el.gaugeLevel.textContent = a.opportunityLevel;
  el.gaugeLevel.className = `pill tone-${a.opportunityTone === 'good' ? 'good' : a.opportunityTone === 'bad' ? 'bad' : 'mid'}`;
  el.gaugeScore.textContent = a.opportunityScore;
  el.gaugeFill.style.width = `${a.opportunityScore}%`;
  // 그라데이션이 채움 길이가 아니라 전체 트랙 기준으로 보이도록 확대
  el.gaugeFill.style.backgroundSize = a.opportunityScore > 0 ? `${10000 / a.opportunityScore}% 100%` : '100% 100%';
  el.metricSmallShare.textContent = `${a.smallChannelShare}% (${a.smallChannelCount}/${a.sizedCount}개)`;
  el.metricSmallOutliers.textContent = `${a.smallOutlierCount}개 (${a.smallOutlierShare}%)`;
  el.gaugeAdvice.textContent = a.opportunityAdvice;

  el.kpiOutliers.textContent = `${a.outlierCount}개`;
  el.kpiMax.textContent = a.maxMultiplierFormatted || '-';
  el.kpiAvgViews.textContent = a.avgViewsFormatted;
  el.kpiMedianSubs.textContent = a.medianSubscribersFormatted;

  el.keywordBasis.textContent = a.keywordBasis === 'outliers'
    ? `떡상 영상 ${a.keywordBasisCount}개 제목 기준`
    : `전체 ${a.keywordBasisCount}개 제목 기준`;
  renderKeywordChips();

  const notes = [];
  const unplotted = state.videos.filter(v => v.scoreBasis !== 'baseline').length;
  if (unplotted > 0) notes.push(`평소 조회수 미확인 ${unplotted}개 제외`);
  el.legendShorts.hidden = state.format !== 'all';
  el.scatterNote.textContent = [`점선: 채널 평소의 1·3·10배 · 조회수 ${minViewsLabel()} 미만은 회색${state.format === 'all' ? ' · 속 빈 점은 쇼츠' : ''} · 점을 누르면 영상으로 이동`, ...notes].join(' · ');

  requestAnimationFrame(drawScatter);
}

function renderKeywordChips() {
  const kws = state.analytics?.topKeywords || [];
  if (kws.length === 0) {
    el.keywordChips.innerHTML = '<span class="chips-empty">여러 제목에 반복된 키워드가 없습니다.</span>';
    return;
  }
  const max = Math.max(...kws.map(k => k.count));
  el.keywordChips.innerHTML = kws.map(k => `
    <button type="button" class="kw-item ${state.keywordFilter === k.word ? 'active' : ''}" data-word="${esc(k.word)}" data-ratio="${k.count / max}"
      title="눌러서 제목에 '${esc(k.word)}' 포함 영상만 보기">
      <span class="kw-word">#${esc(k.word)}</span><span class="kw-bar"><i></i></span><span class="kw-count">${k.count}개</span>
    </button>`).join('');
  // CSP(style-src 'self') 때문에 막대 길이는 CSSOM 으로 지정
  el.keywordChips.querySelectorAll('.kw-item').forEach(b => {
    b.querySelector('.kw-bar i').style.width = `${Math.round(Number(b.dataset.ratio) * 100)}%`;
  });
}

// ---------------------------------------------------------------------------
// Feed
// ---------------------------------------------------------------------------

function sortVideos(list) {
  const key = el.sortSelect.value;
  const score = v => (v.score ?? -1);
  const subs = v => (v.subsRatio ?? -1);
  const minViews = state.analytics?.minOutlierViews || 10000;
  const enough = v => (v.viewCount >= minViews ? 1 : 0);
  const sorters = {
    // 하한선을 넘은 영상이 항상 먼저, 그 안에서 배수순
    ratio: (a, b) => (b.qualifies - a.qualifies) || score(b) - score(a) || b.viewCount - a.viewCount,
    subs: (a, b) => (enough(b) - enough(a)) || subs(b) - subs(a) || b.viewCount - a.viewCount,
    views: (a, b) => b.viewCount - a.viewCount,
    velocity: (a, b) => b.viewsPerDay - a.viewsPerDay,
    recent: (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)
  };
  return list.sort(sorters[key] || sorters.ratio);
}

function excludedNote() {
  const x = state.excluded || {};
  const parts = [];
  if (x.spam) parts.push(`해시태그 도배 ${x.spam}개`);
  if (x.language) parts.push(`해외·외국어 ${x.language}개`);
  if (x.offtopic) parts.push(`키워드 무관 ${x.offtopic}개`);
  if (x.live) parts.push(`라이브·예정 ${x.live}개`);
  if (x.format) parts.push(`다른 형식 ${x.format}개`);
  if (x.religion) parts.push(`종교 ${x.religion}개`);
  const total = (x.spam || 0) + (x.language || 0) + (x.offtopic || 0) + (x.live || 0) + (x.format || 0) + (x.religion || 0);
  return { total, parts, religion: x.religion || 0 };
}

// 목록 상단 기준 안내: 분석 대상(= 목록 전체 = 지표·트렌드·AI 기준)과 분석에서 뺀 영상 수
function scopeNote(shown) {
  const n = state.videos.length;
  const outliers = state.analytics ? state.analytics.outlierCount : 0;
  const ex = excludedNote();
  const lines = [
    `분석 대상 ${n}개: 목록 전체이며 시장 지표·트렌드 분석·AI 기획안이 모두 이 ${n}개만 기준으로 계산됩니다.`,
    `떡상 ${outliers}개: 조회수 ${minViewsLabel()} 이상이면서 채널 평소의 3배 이상인 영상입니다.`
  ];
  if (ex.total) {
    lines.push(`제외 ${ex.total}개(${ex.parts.join(' · ')})는 목록·지표·트렌드·AI 어디에도 넣지 않습니다.`,
      '해시태그만 나열한 스팸, 선택한 언어 글자가 거의 없는 해외 영상, 제목·태그·설명·채널명 어디에도 키워드가 없는 영상을 걸러냅니다.',
      ...(ex.religion ? ['종교 영상(CCM·찬양·설교 등)은 [설정] → 검색 기본값에서 포함할 수 있습니다. 글자로 판별해 100% 정확하지 않습니다.'] : []));
  }
  const si = state.searchInfo;
  if (si && si.source === 'chart') {
    lines.push(`출처: YouTube 인기 차트(${regionName()}${state.category !== '0' && categoryName() ? ` · ${categoryName()}` : ''}) · 지금 인기 영상이라 기간 조건은 쓰지 않습니다 · 검색 0회`);
  } else if (si) {
    lines.push(`검색 기준: ${si.order === 'relevance' ? '관련도순' : '조회수순'} · 검색 ${si.calls}회 사용${si.topupStopped ? ' · 사용 한도 때문에 보충 검색을 일부 못 했습니다' : ''}`);
  }
  if (state.cachedAt) lines.push(`${new Date(state.cachedAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}에 받은 결과를 다시 보여 주고 있습니다(할당량 0).`);
  if (shown !== n) lines.push(`지금 목록은 필터로 ${shown}개만 보여 주고 있습니다. 지표는 분석 대상 ${n}개 기준입니다.`);
  return {
    text: `${si && si.source === 'chart' ? '인기 차트 · ' : ''}분석 대상 ${n}개 · 떡상 ${outliers}개${ex.total ? ` · 제외 ${ex.total}개` : ''}`,
    title: lines.join('\n')
  };
}

function renderFeed() {
  // 검색 중에는 로딩 화면을 유지한다(정렬·설정 저장 등으로 이전 결과·안내 화면이 다시 그려지지 않도록)
  if (state.searching) return;
  const hasVideos = state.videos.length > 0;
  const showFormat = hasVideos && state.format === 'all';
  el.feedFormat.hidden = !showFormat;
  if (showFormat) {
    const n = { all: state.videos.length, shorts: state.videos.filter(v => v.isShorts).length };
    n.long = n.all - n.shorts;
    el.feedFormat.querySelectorAll('.seg-btn').forEach(b => {
      b.textContent = `${{ all: '전체', shorts: '쇼츠', long: '롱폼' }[b.dataset.view]} ${n[b.dataset.view]}`;
    });
  }
  el.filterKw.hidden = !state.keywordFilter;
  el.filterWord.textContent = state.keywordFilter ? `#${state.keywordFilter}` : '';
  el.filterBar.hidden = !hasVideos;
  renderCacheChip();

  if (!hasVideos) {
    el.feedCount.textContent = '';
    el.filterNote.textContent = '';
    el.feed.innerHTML = state.searched ? noResultHtml() : onboardingHtml();
    return;
  }

  const f = currentFilters();
  const list = sortVideos(state.videos.filter(v => passesFilters(v, f)));
  const filtered = list.length !== state.videos.length;
  const note = scopeNote(list.length);
  el.filterNote.textContent = note.text;
  el.filterNote.title = note.title;
  el.outlierFilter.classList.toggle('is-on', f.minRatio > 0);
  el.viewsFilter.classList.toggle('is-on', f.minViews > 0);
  el.subsFilter.classList.toggle('is-on', !!f.subs);
  el.feedCount.textContent = filtered ? `${list.length}/${state.videos.length}` : `${list.length}`;
  el.feedCount.title = filtered ? `필터로 ${list.length}개만 표시 중 · 분석 대상 ${state.videos.length}개` : `분석 대상 ${list.length}개`;

  if (list.length === 0) {
    el.feed.innerHTML = `
      <div class="state">
        <div class="state-icon">${icon('search')}</div>
        <h3>조건에 맞는 영상이 없습니다</h3>
        <p>배수·조회수·구독자 필터를 '전체'로 바꾸거나 형식·키워드 필터를 해제해 보세요.</p>
        <div class="actions">
          ${(f.minViews > 0 || f.subs) ? '<button type="button" class="btn btn-ghost btn-sm" data-act="reset-list-filters">목록 필터 모두 해제</button>' : ''}
          ${f.minRatio > 0 ? '<button type="button" class="btn btn-ghost btn-sm" data-act="ratio-all">배수 전체 보기</button>' : ''}
          ${f.keyword ? '<button type="button" class="btn btn-ghost btn-sm" data-act="clear-keyword">키워드 필터 해제</button>' : ''}
          ${f.format !== 'all' ? '<button type="button" class="btn btn-ghost btn-sm" data-act="format-all">형식 전체 보기</button>' : ''}
        </div>
      </div>`;
    return;
  }

  el.feed.innerHTML = list.map(videoRowHtml).join('');
}

function ratioClass(v) {
  const x = v.score;
  if (x === null || x === undefined) return 'ratio-none';
  const est = v.scoreBasis === 'subs' ? ' ratio-est' : '';
  if (!v.qualifies) return `ratio-low${est}`;
  if (x >= MEGA) return `ratio-mega${est}`;
  if (x >= OUTLIER) return `ratio-high${est}`;
  return `ratio-norm${est}`;
}

function scoreTitle(v) {
  if (v.score === null || v.score === undefined) {
    if (/\s-\sTopic$/.test(v.channelTitle || '')) return 'YouTube가 자동으로 만든 음악 채널(- Topic)이라 구독자 수로 배수를 추정하지 않습니다. 채널 평소 조회수도 확인하지 못했습니다.';
    return v.subscriberCount === null
      ? '채널 평소 조회수와 구독자 수를 모두 확인하지 못해 배수를 계산할 수 없습니다'
      : '채널 평소 조회수를 확인하지 못했고 구독자도 0명이라 배수를 계산할 수 없습니다';
  }
  const low = v.qualifies ? '' : ` 다만 조회수가 ${minViewsLabel()} 미만이라 떡상으로 보지 않습니다.`;
  if (v.scoreBasis === 'baseline') {
    return `이 채널의 최근 ${v.isShorts ? '쇼츠' : '롱폼'} ${v.baselineSampleSize}개 조회수 중앙값(${v.channelBaselineFormatted}회)의 ${v.scoreFormatted}입니다.${low}`;
  }
  const floorNote = v.subscriberCount !== null && v.subscriberCount < BASELINE_FLOOR ? ` 구독자가 ${BASELINE_FLOOR.toLocaleString('ko-KR')}명 미만이라 ${BASELINE_FLOOR.toLocaleString('ko-KR')}명으로 계산했습니다(실제 구독자 대비 ${v.subsRatioFormatted}).` : '';
  return `채널의 최근 영상이 부족해 평소 조회수를 계산하지 못했습니다. 대신 구독자 수 대비 배수(${v.scoreFormatted})로 추정했습니다.${floorNote}${low}`;
}

function minViewsLabel() {
  return `${((state.analytics?.minOutlierViews || 10000) / 10000).toLocaleString('ko-KR')}만 회`;
}

function videoRowHtml(v) {
  const tagCount = v.tags ? v.tags.length : 0;
  const tagsOpen = tagCount > 0 && state.openTags.has(v.id);
  const badgeText = v.score === null
    ? '배수 -'
    : `${v.scoreBasis === 'subs' ? '추정 ' : '평소 '}${v.scoreFormatted}`;
  const subsTitle = v.subsRatio === null
    ? (v.subscriberCount === null ? '구독자 수가 비공개입니다' : '구독자가 0명입니다')
    : `조회수가 구독자 수(${v.subscriberCountFormatted})의 ${v.subsRatioFormatted}입니다`;
  return `
    <article class="vrow" id="v-${esc(v.id)}" data-id="${esc(v.id)}">
      <button type="button" class="thumb" data-act="open" title="YouTube에서 보기" aria-label="YouTube에서 보기">
        ${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">` : ''}
        ${v.isShorts ? '<span class="badge badge-shorts">쇼츠</span>' : ''}
        ${v.durationFormatted ? `<span class="badge badge-duration">${esc(v.durationFormatted)}</span>` : ''}
      </button>
      <div class="vinfo">
        <div class="vtop">
          <span class="ratio ${ratioClass(v)}" title="${esc(scoreTitle(v))}">${esc(badgeText)}</span>
          <span class="ratio-sub" title="${esc(subsTitle)}">구독자 대비 <b>${esc(v.subsRatioFormatted)}</b></span>
          <span class="vcat">${esc(v.categoryName)}</span>
          <div class="vactions">
            <button type="button" class="vbtn" data-act="open" title="YouTube에서 보기">${icon('external')}YouTube</button>
            <button type="button" class="vbtn" data-act="copy-title" title="제목 복사">${icon('copy')}제목</button>
            <button type="button" class="vbtn ${tagsOpen ? 'on' : ''}" data-act="tags" ${tagCount ? '' : 'disabled'} aria-expanded="${tagsOpen}" title="${tagCount ? '태그 펼쳐 보기' : '공개된 태그가 없습니다'}">${icon('tag')}태그 ${tagCount}</button>
          </div>
        </div>
        <h3 class="vtitle" data-act="open" role="link" tabindex="0" title="${esc(v.title)} · 눌러서 YouTube에서 보기">${esc(v.title)}</h3>
        <div class="vmeta">
          ${v.channelId
            ? `<button type="button" class="vchan vchan-link" data-act="open-channel" title="${esc(v.channelTitle)} · 눌러서 채널 열기">${esc(v.channelTitle)}</button>`
            : `<span class="vchan" title="${esc(v.channelTitle)}">${esc(v.channelTitle)}</span>`}
          <span>구독자 <b>${esc(v.subscriberCountFormatted)}</b></span>
          <span>조회수 <b>${esc(v.viewCountFormatted)}</b></span>
          <span title="같은 형식 최근 영상 조회수 중앙값">채널 평소 <b>${esc(v.channelBaseline === null ? '-' : v.channelBaselineFormatted)}</b></span>
          <span>하루 평균 <b>${esc(v.viewsPerDayFormatted)}</b></span>
          ${v.likeRate !== null && v.likeRate !== undefined ? `<span title="좋아요 ÷ 조회수">좋아요율 <b>${v.likeRate}%</b></span>` : ''}
          ${v.commentCount > 0 ? `<span>댓글 <b>${esc(fmtCount(v.commentCount))}</b></span>` : ''}
          <span>${esc(v.publishedAtRelative)}</span>
        </div>
      </div>
      ${tagsOpen ? tagPanelHtml(v) : ''}
    </article>`;
}

function fmtCount(n) {
  if (!n || n <= 0) return '0';
  if (n >= 100000000) return `${(n / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  return n.toLocaleString('ko-KR');
}

function tagPanelHtml(v) {
  return `
    <div class="vtags">
      <div class="vtags-head">
        <span>공개 태그 ${v.tags.length}개 · 쉼표 구분</span>
        <button type="button" class="vbtn" data-act="copy-tags" title="태그를 쉼표로 구분해 복사">${icon('copy')}복사</button>
      </div>
      <p class="vtags-text">${esc(v.tags.join(', '))}</p>
    </div>`;
}

function onboardingHtml() {
  const hasKey = !!state.config?.youtubeApiKey;
  return `
    <div class="state">
      <div class="state-icon">${icon('trend')}</div>
      <h3>빠른 시작을 누르거나 키워드로 떡상 영상을 찾아보세요</h3>
      <p>그 채널의 평소 조회수보다 크게 터진 영상을 골라내고, AI가 바로 만들 수 있는 기획안을 제안합니다. 키워드를 비우면 국가·주제·기간 조건에 맞는 인기 영상 전체를 분석합니다.</p>
      <ol class="steps">
        <li class="${hasKey ? 'done' : ''}"><span class="n">${hasKey ? '✓' : '1'}</span>YouTube API 키 등록${hasKey ? ' 완료' : ''}
          ${hasKey ? '' : '<button type="button" class="btn btn-primary btn-sm" data-act="open-settings">설정 열기</button>'}</li>
        <li><span class="n">2</span>위의 [빠른 시작]을 누르거나, 검색창에 키워드를 입력하고 Enter</li>
      </ol>
      ${hasKey ? `<div class="actions"><span class="field-label">예시로 바로 분석</span>${EXAMPLES.map(k => `<button type="button" class="chip" data-act="example" data-word="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
    </div>`;
}

function noResultHtml() {
  return `
    <div class="state">
      <div class="state-icon">${icon('search')}</div>
      <h3>검색 결과가 없습니다</h3>
      <p>"${esc(state.label)}"에 맞는 영상을 찾지 못했습니다. 주제·기간 조건을 넓히거나${state.langOnly ? ' [국가·언어]에서 \'선택한 언어 영상만\'을 끄거나' : ''} 다른 키워드로 검색해 보세요.</p>
      <div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="reset-server-filters">주제·기간 초기화 후 다시 검색</button></div>
    </div>`;
}

function renderFeedError(err) {
  const keyIssue = ['NO_API_KEY', 'KEY_INVALID', 'API_DISABLED', 'FORBIDDEN', 'QUOTA_LOCAL', 'QUOTA_BUDGET'].includes(err.code);
  const rangeIssue = err.code === 'BAD_RANGE';
  el.feedCount.textContent = '';
  el.feed.innerHTML = `
    <div class="state">
      <div class="state-icon is-error">${icon('alert')}</div>
      <h3>검색하지 못했습니다</h3>
      <p>${esc(err.message)}</p>
      <div class="actions">
        ${keyIssue ? '<button type="button" class="btn btn-primary btn-sm" data-act="open-settings">설정 열기</button>' : ''}
        ${rangeIssue ? '<button type="button" class="btn btn-primary btn-sm" data-act="open-advanced">기간 다시 지정</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-act="retry-search">다시 시도</button>
      </div>
      ${err.detail ? `<details class="details"><summary>자세한 오류 정보</summary><pre>${esc(err.detail)}</pre></details>` : ''}
    </div>`;
}

async function onFeedClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const row = btn.closest('.vrow');
  const video = row ? state.videos.find(v => v.id === row.dataset.id) : null;

  if (act === 'open' && video) {
    // 제목 글자를 드래그해 고르는 중이면 열지 않는다
    // (키보드 Enter 로 연 경우는 e.detail 이 0 이므로 검사하지 않고, 제목 안의 선택만 본다)
    const sel = window.getSelection();
    if (btn.classList.contains('vtitle') && e.detail !== 0 && sel && String(sel).trim() && sel.containsNode(btn, true)) return;
    const res = await window.api.openExternal(video.url);
    if (!res.ok) toast(res.error.message, 'error');
  } else if (act === 'open-channel' && video && /^UC[\w-]{22}$/.test(video.channelId)) {
    const res = await window.api.openExternal(`https://www.youtube.com/channel/${video.channelId}`);
    if (!res.ok) toast(res.error.message, 'error');
  } else if (act === 'copy-title' && video) {
    copyText(video.title, '제목을 복사했습니다.');
  } else if (act === 'tags' && video) {
    // 펼쳐서 태그를 먼저 보여 주고, 복사는 패널의 [복사] 버튼으로
    if (state.openTags.has(video.id)) state.openTags.delete(video.id);
    else state.openTags.add(video.id);
    row.outerHTML = videoRowHtml(video);
    // 다시 그린 행의 [태그] 버튼으로 키보드 포커스를 되돌린다
    const again = el.feed.querySelector(`.vrow[data-id="${CSS.escape(video.id)}"] [data-act="tags"]`);
    if (again) again.focus();
  } else if (act === 'copy-tags' && video) {
    if (await copyText(video.tags.join(', '), `태그 ${video.tags.length}개를 복사했습니다.`)) {
      btn.classList.add('done');
      setTimeout(() => btn.classList.remove('done'), 1600);
    }
  } else if (act === 'open-settings') {
    openSettings();
  } else if (act === 'example') {
    el.searchInput.value = btn.dataset.word;
    handleSearch();
  } else if (act === 'retry-search') {
    // 마지막 요청(빠른 시작의 인기 차트 포함)을 그대로 다시
    const last = state.lastRequest;
    if (last) handleSearch(last.query, last.opts);
    else handleSearch();
  } else if (act === 'ratio-all') {
    el.outlierFilter.value = '0';
    savePrefs();
    onClientFilterChange();
  } else if (act === 'reset-list-filters') {
    resetListFilters();
  } else if (act === 'open-advanced') {
    openAdvanced(true);
  } else if (act === 'clear-keyword') {
    setKeywordFilter('');
  } else if (act === 'format-all') {
    state.feedView = setSegment(el.feedFormat, 'view', 'all');
    onClientFilterChange();
  } else if (act === 'reset-server-filters') {
    el.categoryFilter.value = '0';
    state.category = '0';
    setSegment(el.periodToggle, 'period', 'all');
    savePrefs();
    rerunSearch('주제·기간', true);
  }
}

// ---------------------------------------------------------------------------
// AI strategy
// ---------------------------------------------------------------------------

function setAiRunning(on) {
  state.aiRunning = on;
  el.btnAiStop.hidden = !on;
  updateAiButton();
}

// 헤더 버튼: 기획안이 없으면 [기획안 생성](강조), 있으면 [다시 생성]
function updateAiButton() {
  const ready = !state.searching && state.videos.length > 0;
  el.btnAiRun.disabled = state.aiRunning || !ready;
  el.btnAiRun.hidden = state.aiRunning;
  const fresh = !state.aiReport;
  el.btnAiRun.querySelector('span').textContent = fresh ? '기획안 생성' : '다시 생성';
  el.btnAiRun.querySelector('use').setAttribute('href', fresh ? '#i-spark' : '#i-refresh');
  el.btnAiRun.classList.toggle('btn-primary', fresh && ready);
  el.btnAiRun.classList.toggle('btn-ghost', !(fresh && ready));
}

// 검색은 끝났고 기획안은 아직 만들지 않은 상태
function renderAiReady() {
  setAiRunning(false);
  const n = state.videos.length;
  const outliers = state.analytics?.outlierCount || 0;
  el.aiBody.innerHTML = `
    <div class="state">
      <div class="state-icon">${icon('spark')}</div>
      <h3>AI 기획안</h3>
      <p>분석 대상 ${n}개(떡상 ${outliers}개)로 ${esc(engineLabel())} CLI가 제목 후보·썸네일 구성·첫 10초 대본을 제안합니다. 30~90초 걸리고 CLI 사용량이 들어, 필요할 때만 만듭니다.</p>
      <div class="actions"><button type="button" class="btn btn-primary btn-sm" data-act="run-ai">${icon('spark')}기획안 생성</button></div>
    </div>`;
}

function renderAiIdle(message) {
  setAiRunning(false);
  el.aiBody.innerHTML = `
    <div class="state">
      <div class="state-icon">${icon('spark')}</div>
      <h3>AI 기획안</h3>
      <p>${esc(message || `검색한 뒤 [기획안 생성]을 누르면 PC에 설치된 ${engineLabel()} CLI가 떡상 영상을 분석해 제목 후보, 썸네일 구성, 첫 10초 대본을 제안합니다.`)}</p>
    </div>`;
}

async function runAi() {
  if (state.videos.length === 0) return;
  const seq = ++state.aiSeq;
  const outlierCount = state.analytics?.outlierCount || 0;
  setAiRunning(true);

  const started = Date.now();
  el.aiBody.innerHTML = `
    <div class="progress">
      <div class="spinner"></div>
      <p>${esc(engineLabel())} CLI가 ${{ all: '쇼츠·롱폼', long: '롱폼', shorts: '쇼츠' }[state.format]} ${outlierCount >= 5 ? '떡상 영상' : '떡상·조회수 상위 영상'}과 트렌드 통계를 분석하고 있습니다 · <span id="ai-elapsed">0초</span></p>
      <small>${state.format === 'all' ? '쇼츠·롱폼 기획안을 함께' : '상세 구성안까지'} 만드느라 보통 30~90초 걸립니다. 그동안 왼쪽 목록과 트렌드 분석을 살펴보셔도 됩니다.</small>
    </div>`;
  const timer = setInterval(() => {
    const node = $('ai-elapsed');
    if (node) node.textContent = `${Math.round((Date.now() - started) / 1000)}초`;
  }, 1000);

  // 키워드 없이 찾은 경우 AI에는 조건 이름을 넘긴다
  const keyword = state.keyword || `${state.label} (키워드 없이 조건으로 찾은 인기 영상)`;
  const res = await window.api.generateStrategy({ keyword, videos: state.videos, format: state.format });
  clearInterval(timer);
  if (seq !== state.aiSeq) return; // 더 최신 요청이 있음
  setAiRunning(false);

  if (res.ok) {
    state.aiReport = res.data;
    updateAiButton();
    renderAiReport(res.data);
  } else if (res.error.code === 'CANCELLED') {
    renderAiIdle('AI 분석을 중지했습니다. [기획안 생성]으로 다시 시작할 수 있습니다.');
  } else {
    renderAiError(res.error);
  }
}

// 진행 중인 AI 요청을 무효화하고 중단한다. 결과가 늦게 와도 aiSeq 가 달라 무시된다.
function stopAi(message) {
  if (!state.aiRunning) return;
  state.aiSeq++;
  window.api.cancelStrategy();
  renderAiIdle(message || 'AI 분석을 중지했습니다. [기획안 생성]으로 다시 시작할 수 있습니다.');
}

function renderAiError(err) {
  const cliIssue = ['CLI_NOT_FOUND', 'CLI_SPAWN'].includes(err.code);
  el.aiBody.innerHTML = `
    <div class="state">
      <div class="state-icon is-error">${icon('alert')}</div>
      <h3>기획안을 만들지 못했습니다</h3>
      <p>${esc(err.message)}</p>
      <div class="actions">
        ${cliIssue ? '<button type="button" class="btn btn-primary btn-sm" data-act="open-settings">설정 열기</button>' : ''}
        <button type="button" class="btn btn-ghost btn-sm" data-act="retry-ai">다시 시도</button>
      </div>
      ${err.detail ? `<details class="details"><summary>CLI 출력 보기</summary><pre>${esc(err.detail)}</pre></details>` : ''}
    </div>`;
}

const hookLabel = rec => (rec.format === '쇼츠' ? '첫 1~2초 훅' : '첫 30초 오프닝');
const outlineLabel = rec => (rec.format === '쇼츠' ? '장면 구성' : '영상 구성안');

function planText(rec, i) {
  const lines = [`[기획안 ${i + 1}] ${rec.format}${rec.targetLength ? ` · ${rec.targetLength}` : ''}`, `제목: ${rec.title}`];
  if (rec.altTitles.length) lines.push(`다른 제목 후보: ${rec.altTitles.join(' / ')}`);
  if (rec.targetViewer) lines.push(`대상 시청자: ${rec.targetViewer}`);
  if (rec.thumbnailConcept) lines.push(`썸네일: ${rec.thumbnailConcept}`);
  if (rec.hookIntro) lines.push(`${hookLabel(rec)}: ${rec.hookIntro}`);
  if (rec.outline.length) lines.push(`${outlineLabel(rec)}:`, ...rec.outline.map((s, k) => `  ${k + 1}. ${s}`));
  if (rec.keyPoints.length) lines.push('시청 유지 포인트:', ...rec.keyPoints.map(s => `  - ${s}`));
  if (rec.tags.length) lines.push(`태그: ${rec.tags.join(', ')}`);
  if (rec.reference) lines.push(`근거: ${rec.reference}`);
  return lines.join('\n');
}

function planHtml(rec, i, rankLabel) {
  return `
    <article class="plan ${rankLabel ? 'top' : ''}">
      <div class="plan-head">
        <span class="pill ${rec.format === '쇼츠' ? 'pill-shorts' : 'pill-long'}">${esc(rec.format)}</span>
        ${rec.targetLength ? `<span class="pill pill-muted" title="권장 길이">${esc(rec.targetLength)}</span>` : ''}
        ${rankLabel ? `<span class="plan-rank">${esc(rankLabel)}</span>` : ''}
        <button type="button" class="vbtn" data-act="copy-plan" data-index="${i}" title="이 기획안 전체 복사">${icon('copy')}복사</button>
      </div>
      <h4 class="plan-title">${esc(rec.title)}</h4>
      ${rec.altTitles.length ? `<ul class="plan-alts">${rec.altTitles.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      ${rec.targetViewer ? `<div class="plan-field"><span>대상 시청자</span><p>${esc(rec.targetViewer)}</p></div>` : ''}
      ${rec.thumbnailConcept ? `<div class="plan-field"><span>${rec.format === '쇼츠' ? '첫 화면(커버)' : '썸네일 구성'}</span><p>${esc(rec.thumbnailConcept)}</p></div>` : ''}
      ${rec.hookIntro ? `<div class="plan-field"><span>${hookLabel(rec)}</span><p>${esc(rec.hookIntro)}</p></div>` : ''}
      ${rec.outline.length ? `<div class="plan-field"><span>${outlineLabel(rec)}</span><ol class="plan-outline">${rec.outline.map(s => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
      ${rec.keyPoints.length ? `<div class="plan-field"><span>시청 유지 포인트</span><ul class="plan-points">${rec.keyPoints.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      ${rec.tags.length ? `<div class="plan-field"><span>추천 태그 <button type="button" class="link-btn" data-act="copy-plan-tags" data-index="${i}">${icon('copy')}태그 복사</button></span><p class="plan-tags">${rec.tags.map(t => `<span class="tag-chip">${esc(t)}</span>`).join('')}</p></div>` : ''}
      ${rec.reference ? `<p class="plan-ref">근거: ${esc(rec.reference)}</p>` : ''}
    </article>`;
}

function listBlock(title, items, cls = '') {
  if (!items || !items.length) return '';
  return `<section class="ai-block ${cls}"><h4>${esc(title)}</h4><ul>${items.map(a => `<li>${esc(a)}</li>`).join('')}</ul></section>`;
}

function renderAiReport(r) {
  const recs = r.recommendations;
  let plans;
  if (r.format === 'all') {
    const group = (fmt) => {
      const items = recs.map((rec, i) => ({ rec, i })).filter(x => x.rec.format === fmt);
      if (!items.length) return '';
      return `<div class="ai-section-title"><span class="pill ${fmt === '쇼츠' ? 'pill-shorts' : 'pill-long'}">${fmt}</span> 기획안 ${items.length}개</div>
        ${items.map((x, k) => planHtml(x.rec, x.i, k === 0 ? `${fmt} 추천 1순위` : '')).join('')}`;
    };
    const other = recs.map((rec, i) => ({ rec, i })).filter(x => x.rec.format !== '쇼츠' && x.rec.format !== '롱폼');
    plans = group('쇼츠') + group('롱폼') + other.map(x => planHtml(x.rec, x.i, '')).join('');
  } else {
    plans = `<div class="ai-section-title">바로 만들 수 있는 ${r.format === 'shorts' ? '쇼츠' : '롱폼'} 기획안 ${recs.length}개</div>
      ${recs.map((rec, i) => planHtml(rec, i, i === 0 ? '추천 1순위' : '')).join('')}`;
  }

  const basis = r.format === 'all'
    ? `쇼츠 ${r.basisShorts}개 · 롱폼 ${r.basisLong}개`
    : `${r.format === 'shorts' ? '쇼츠' : '롱폼'} ${r.basisCount}개`;
  el.aiBody.innerHTML = `
    <div class="ai-basis">"${esc(state.label)}" ${basis}${r.basisSupplemented ? '(떡상이 적어 조회수 상위 포함)' : ''}와 트렌드 통계 기반 · ${esc(r.engine)} CLI</div>
    <section class="ai-block">
      <h4>떡상 패턴 요약</h4>
      <p>${esc(r.summary)}</p>
      ${r.hookingAngles.length ? `<ol>${r.hookingAngles.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
    </section>
    ${r.formatStrategy ? `<section class="ai-block"><h4>쇼츠·롱폼 운영 전략</h4><p>${esc(r.formatStrategy)}</p></section>` : ''}
    ${listBlock('제목 공식', r.titleFormulas)}
    ${listBlock('썸네일·첫 화면 공통 요소', r.thumbnailPatterns)}
    ${r.blueOceanInsight ? `<section class="ai-block alt"><h4>틈새 공략 각도</h4><p>${esc(r.blueOceanInsight)}</p></section>` : ''}
    ${plans}`;
}

function onAiClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'open-settings') openSettings();
  else if (btn.dataset.act === 'retry-ai' || btn.dataset.act === 'run-ai') { if (!state.searching && !state.aiRunning) runAi(); }
  else if (btn.dataset.act === 'copy-plan' && state.aiReport) {
    const i = Number(btn.dataset.index);
    copyText(planText(state.aiReport.recommendations[i], i), `기획안 ${i + 1}번을 복사했습니다.`);
  } else if (btn.dataset.act === 'copy-plan-tags' && state.aiReport) {
    const rec = state.aiReport.recommendations[Number(btn.dataset.index)];
    copyText(rec.tags.join(', '), `추천 태그 ${rec.tags.length}개를 복사했습니다.`);
  }
}

// ---------------------------------------------------------------------------
// Trend analysis tab
// ---------------------------------------------------------------------------

const C_SHORTS = '#d95926';
const C_LONG = '#3987e5';
const C_OUT = '#f5b942';
const C_REST = '#4a4a4a';
const TIER_COLORS = { micro: '#9ec5f4', small: '#6da7ec', mid: '#3987e5', large: '#1c5cab', hidden: '#6b6b6b' };

function setTab(tab) {
  state.tab = tab === 'trends' ? 'trends' : 'feed';
  el.leftTabs.querySelectorAll('.tab').forEach(t => {
    const on = t.dataset.tab === state.tab;
    t.classList.toggle('active', on);
    t.setAttribute('aria-selected', String(on));
  });
  const trends = state.tab === 'trends';
  el.feed.hidden = trends;
  el.trendView.hidden = !trends;
  el.sortField.hidden = trends;
  el.filterBar.classList.toggle('is-hidden', trends);
  if (trends) applyBarWidths(el.trendView);
}

// CSP(style-src 'self') 때문에 막대 길이·색은 CSSOM 으로 지정한다
function applyBarWidths(root) {
  root.querySelectorAll('[data-w]').forEach(n => { n.style.width = `${Math.max(0, Math.min(100, Number(n.dataset.w)))}%`; });
  root.querySelectorAll('[data-h]').forEach(n => { n.style.height = `${Math.max(0, Math.min(100, Number(n.dataset.h)))}%`; });
  root.querySelectorAll('[data-c]').forEach(n => { n.style.background = n.dataset.c; });
}

const fmtX = x => (x === null || x === undefined ? '-' : x >= 100 ? `${Math.round(x).toLocaleString('ko-KR')}배` : `${x}배`);
const fmtPct = x => (x === null || x === undefined ? '-' : `${x}%`);
function fmtDur(sec) {
  if (!sec) return '-';
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분${sec % 60 ? ` ${sec % 60}초` : ''}`;
}

function card(title, sub, body, cls = '') {
  return `<section class="tcard ${cls}"><div class="tcard-head"><h3>${esc(title)}</h3>${sub ? `<span>${esc(sub)}</span>` : ''}</div>${body}</section>`;
}

// 가로 막대: 떡상(금색) + 그 외(회청색) 누적, 길이는 최대 개수 기준
function stackRows(groups, { emptyText = '데이터 없음', extra } = {}) {
  const max = Math.max(1, ...groups.map(g => g.count));
  if (groups.every(g => g.count === 0)) return `<p class="tempty">${emptyText}</p>`;
  return `<div class="hrows">${groups.map(g => `
    <div class="hrow" title="${esc(`${g.label}: ${g.count}개 · 떡상 ${g.outlierCount}개(${g.outlierRate}%) · 평소 대비 중앙값 ${fmtX(g.medianScore)}`)}">
      <span class="hlabel">${esc(g.label)}</span>
      <span class="htrack"><i class="seg" data-c="${C_OUT}" data-w="${(g.outlierCount / max) * 100}"></i><i class="seg" data-c="${C_REST}" data-w="${((g.count - g.outlierCount) / max) * 100}"></i></span>
      <span class="hval">${g.count}개${extra ? ` · ${extra(g)}` : ''}</span>
    </div>`).join('')}</div>`;
}

function scoreRows(groups) {
  const ok = groups.filter(g => g.count > 0);
  if (!ok.length) return '<p class="tempty">데이터 없음</p>';
  const max = Math.max(1, ...ok.map(g => g.medianScore || 0));
  const best = ok.filter(g => g.count >= 3).reduce((a, b) => ((b.medianScore || 0) > (a?.medianScore || 0) ? b : a), null);
  return `<div class="hrows">${groups.map(g => `
    <div class="hrow ${g === best ? 'best' : ''}" title="${esc(`${g.label}: ${g.count}개 · 평소 대비 중앙값 ${fmtX(g.medianScore)} · 떡상 ${g.outlierRate}% · 조회수 중앙값 ${fmtCount(g.medianViews)}`)}">
      <span class="hlabel">${esc(g.label)}</span>
      <span class="htrack"><i class="seg" data-c="${g === best ? C_OUT : C_LONG}" data-w="${g.count ? ((g.medianScore || 0) / max) * 100 : 0}"></i></span>
      <span class="hval">${g.count ? `${fmtX(g.medianScore)} · ${g.count}개` : '없음'}</span>
    </div>`).join('')}</div>`;
}

function columnBars(groups) {
  const max = Math.max(1, ...groups.map(g => g.count));
  return `<div class="vcols">${groups.map(g => `
    <div class="vcol" title="${esc(`${g.label}: ${g.count}개 · 떡상 ${g.outlierCount}개 · 평소 대비 중앙값 ${fmtX(g.medianScore)}`)}">
      <span class="vnum">${g.count || ''}</span>
      <span class="vtrack"><i class="vseg" data-c="${C_REST}" data-h="${((g.count - g.outlierCount) / max) * 100}"></i><i class="vseg" data-c="${C_OUT}" data-h="${(g.outlierCount / max) * 100}"></i></span>
      <span class="vlabel">${esc(g.label)}</span>
    </div>`).join('')}</div>`;
}

function donutSvg(slices, total) {
  const R = 42;
  const C = 2 * Math.PI * R;
  let acc = 0;
  const gap = slices.filter(s => s.value > 0).length > 1 ? 1.2 : 0;
  const arcs = slices.filter(s => s.value > 0).map(s => {
    const len = (s.value / total) * C;
    const dash = Math.max(0.5, len - gap);
    const out = `<circle r="${R}" cx="55" cy="55" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${dash} ${C - dash}" stroke-dashoffset="${-acc}" transform="rotate(-90 55 55)"><title>${esc(`${s.label}: ${s.value}개 (${Math.round((s.value / total) * 100)}%)`)}</title></circle>`;
    acc += len;
    return out;
  }).join('');
  return `<svg class="donut" viewBox="0 0 110 110" role="img" aria-label="채널 규모 분포">${arcs}<text x="55" y="52" text-anchor="middle" class="donut-num">${total}</text><text x="55" y="67" text-anchor="middle" class="donut-cap">영상</text></svg>`;
}

function renderTrends() {
  const t = state.trends;
  if (!t || !t.totals || t.totals.count === 0) {
    el.trendView.innerHTML = `<div class="state"><div class="state-icon">${icon('chart')}</div><h3>트렌드 분석</h3><p>검색하면 형식·채널 규모·영상 길이·업로드 요일과 시간·제목 패턴·태그·상위 채널을 한눈에 정리합니다.</p></div>`;
    return;
  }
  const tt = t.totals;
  const fmtLabel = { all: '쇼츠·롱폼', long: '롱폼', shorts: '쇼츠' }[t.format];

  const kpis = [
    ['분석 영상', `${tt.count}개`, excludedNote().total ? `제외 ${excludedNote().total}개는 미포함` : fmtLabel],
    ['떡상 비율', `${tt.outlierRate}%`, `${tt.outlierCount}개가 평소의 3배 이상`],
    ['조회수 중앙값', fmtCount(tt.medianViews), '절반이 이 조회수 이상'],
    ['평소 대비 중앙값', fmtX(tt.medianScore), '1배 = 채널 평소 수준'],
    ['좋아요율 중앙값', fmtPct(tt.medianLikeRate), '좋아요 ÷ 조회수'],
    ['하루 조회수 중앙값', fmtCount(tt.medianViewsPerDay), '게시 후 하루 평균'],
    ['최근 30일 영상', `${tt.recent30Share}%`, '높을수록 지금 뜨는 주제'],
    ['상위 5개 채널 점유', `${t.top5Share}%`, '전체 조회수 중 비중']
  ].map(([k, v, s]) => `<div class="kpi"><span>${k}</span><strong>${v}</strong><small>${s}</small></div>`).join('');

  const findings = t.findings.length
    ? `<ul class="findings">${t.findings.map(f => `<li>${icon('check')}<span>${esc(f.text)}</span></li>`).join('')}</ul>`
    : '<p class="tempty">결론을 낼 만큼 표본이 충분하지 않습니다.</p>';

  let formatCard = '';
  if (t.format === 'all') {
    const s = t.formatSplit.shorts;
    const l = t.formatSplit.long;
    const row = (label, a, b) => `<tr><th>${label}</th><td>${a}</td><td>${b}</td></tr>`;
    const topLine = (x, label) => (x.top ? `<button type="button" class="link-btn top-link" data-act="focus" data-id="${esc(x.top.id)}" title="${esc(x.top.title)}">${label} 최고: ${esc(x.top.title)} (${fmtX(x.top.score)})</button>` : '');
    formatCard = card('쇼츠 vs 롱폼', '전체 검색일 때만', `
      <div class="split">
        <div class="split-row"><span>영상 수</span><span class="strack"><i class="seg" data-c="${C_SHORTS}" data-w="${s.share}"></i><i class="seg" data-c="${C_LONG}" data-w="${l.share}"></i></span></div>
        <div class="split-row"><span>조회수 비중</span><span class="strack"><i class="seg" data-c="${C_SHORTS}" data-w="${s.viewsShare}"></i><i class="seg" data-c="${C_LONG}" data-w="${l.viewsShare}"></i></span></div>
        <div class="legend-row"><span><i data-c="${C_SHORTS}"></i>쇼츠 ${s.share}% · 조회수 ${s.viewsShare}%</span><span><i data-c="${C_LONG}"></i>롱폼 ${l.share}% · 조회수 ${l.viewsShare}%</span></div>
      </div>
      <table class="ttable"><thead><tr><th></th><th>쇼츠</th><th>롱폼</th></tr></thead><tbody>
        ${row('영상 수', `${s.count}개`, `${l.count}개`)}
        ${row('떡상 비율', `${s.outlierRate}% (${s.outlierCount}개)`, `${l.outlierRate}% (${l.outlierCount}개)`)}
        ${row('평소 대비 중앙값', fmtX(s.medianScore), fmtX(l.medianScore))}
        ${row('조회수 중앙값', fmtCount(s.medianViews), fmtCount(l.medianViews))}
        ${row('하루 조회수 중앙값', fmtCount(s.medianViewsPerDay), fmtCount(l.medianViewsPerDay))}
        ${row('좋아요율 중앙값', fmtPct(s.medianLikeRate), fmtPct(l.medianLikeRate))}
        ${row('길이 중앙값', fmtDur(s.medianDurationSec), fmtDur(l.medianDurationSec))}
      </tbody></table>
      <div class="top-links">${topLine(s, '쇼츠')}${topLine(l, '롱폼')}</div>`, 'span2');
  }

  const tiers = t.channelTiers;
  const tierCard = card('채널 규모별 분포', '구독자 수 기준', `
    <div class="donut-wrap">
      ${donutSvg(tiers.map(x => ({ label: x.label, value: x.count, color: TIER_COLORS[x.key] })), tt.count)}
      <table class="ttable compact tiers"><thead><tr><th>구독자</th><th>영상</th><th>떡상률</th><th>평소 대비</th></tr></thead><tbody>
        ${tiers.map(x => `<tr><th><i class="dot" data-c="${TIER_COLORS[x.key]}"></i>${esc(x.label)}</th><td>${x.count} (${x.share}%)</td><td>${x.count ? `${x.outlierRate}%` : '-'}</td><td>${fmtX(x.medianScore)}</td></tr>`).join('')}
      </tbody></table>
    </div>`);

  const durBody = t.format === 'all'
    ? `<div class="sub-title"><span class="pill pill-shorts">쇼츠</span></div>${scoreRows(t.durations.shorts)}<div class="sub-title"><span class="pill pill-long">롱폼</span></div>${scoreRows(t.durations.long)}`
    : scoreRows(t.format === 'shorts' ? t.durations.shorts : t.durations.long);
  const durCard = card('영상 길이별 성과', '평소 대비 중앙값 · 금색 = 최고(3개 이상)', durBody);

  const legendOut = `<div class="legend-row"><span><i data-c="${C_OUT}"></i>떡상</span><span><i data-c="${C_REST}"></i>그 외</span></div>`;
  const dayCard = card('업로드 요일', '한국 시간', columnBars(t.weekday) + legendOut);
  const hourCard = card('업로드 시간대', '한국 시간', stackRows(t.hours, { extra: g => `떡상 ${g.outlierCount}` }) + legendOut);
  const recencyCard = card('게시 시기', '지금 기준', stackRows(t.recency, { extra: g => `하루 ${fmtCount(g.medianViewsPerDay)}` }) + legendOut);

  const tp = t.titlePatterns;
  const titleCard = card('제목 패턴', `떡상 ${tp.outlierCount}개 vs 그 외 ${tp.otherCount}개`, tp.outlierCount === 0
    ? '<p class="tempty">떡상 영상이 없어 비교할 수 없습니다.</p>'
    : `<div class="hrows pair">${tp.features.map(f => `
        <div class="hrow" title="${esc(`${f.label}: 떡상 영상 ${f.outlierPct}% · 그 외 ${f.otherPct}%`)}">
          <span class="hlabel">${esc(f.label)}</span>
          <span class="pairbars"><span class="htrack thin"><i class="seg" data-c="${C_OUT}" data-w="${f.outlierPct}"></i></span><span class="htrack thin"><i class="seg" data-c="${C_REST}" data-w="${f.otherPct}"></i></span></span>
          <span class="hval">${f.outlierPct}% / ${f.otherPct}%</span>
        </div>`).join('')}</div>
      <p class="tnote">제목 길이 중앙값: 떡상 ${tp.outlierTitleLength ?? '-'}자 · 그 외 ${tp.otherTitleLength ?? '-'}자</p>
      <div class="legend-row"><span><i data-c="${C_OUT}"></i>떡상 영상</span><span><i data-c="${C_REST}"></i>그 외</span></div>`);

  const tagCard = card('자주 쓰인 태그', `태그 공개 영상 ${t.taggedVideos}개 기준`, t.topTags.length
    ? `<div class="tag-cloud">${t.topTags.map(x => `<span class="tag-chip ${x.outlierCount ? 'hot' : ''}" title="${esc(`${x.count}개 영상 · 떡상 영상 ${x.outlierCount}개`)}">${esc(x.tag)}<b>${x.count}</b></span>`).join('')}</div>
       <div class="tcard-foot"><span class="tnote">금색 테두리 = 떡상 영상에도 쓰인 태그</span><button type="button" class="vbtn" data-act="copy-top-tags">${icon('copy')}태그 ${t.topTags.length}개 복사</button></div>`
    : '<p class="tempty">두 개 이상 영상에서 겹친 태그가 없습니다.</p>');

  const chCard = card('조회수 상위 채널', `채널 ${t.channelCount}개 중`, `
    <table class="ttable compact channels"><thead><tr><th>채널</th><th>영상</th><th>조회수 합</th><th>최고 배수</th></tr></thead><tbody>
      ${t.topChannels.map(c => `<tr><th class="ellipsis" title="${esc(c.channelTitle)}">${esc(c.channelTitle)}<small>구독자 ${c.subscriberCount === null || c.subscriberCount === undefined ? '비공개' : fmtCount(c.subscriberCount)}</small></th><td>${c.count}개${c.outlierCount ? `<small>떡상 ${c.outlierCount}</small>` : ''}</td><td>${fmtCount(c.totalViews)}<small>${c.viewsShare}%</small></td><td>${fmtX(c.bestScore)}</td></tr>`).join('')}
    </tbody></table>`);

  el.trendView.innerHTML = `
    <div class="kpi-grid">${kpis}</div>
    ${card('한눈에 보는 결론', '데이터에서 바로 계산한 내용', findings, 'span2 findings-card')}
    <div class="tgrid">
      ${formatCard}
      ${tierCard}
      ${chCard}
      ${dayCard}
      ${hourCard}
      ${durCard}
      ${recencyCard}
      ${titleCard}
      ${tagCard}
    </div>`;
  applyBarWidths(el.trendView);
}

function onTrendClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'focus') {
    // 목록 필터에 가려져 있으면 이동할 수 없으므로 모두 해제하고 이동
    const v = state.videos.find(x => x.id === btn.dataset.id);
    if (v && !passesFilters(v)) resetListFilters();
    setTab('feed');
    focusVideo(btn.dataset.id);
  } else if (btn.dataset.act === 'copy-top-tags' && state.trends) {
    copyText(state.trends.topTags.map(x => x.tag).join(', '), `태그 ${state.trends.topTags.length}개를 복사했습니다.`);
  }
}

// ---------------------------------------------------------------------------
// Scatter chart
// ---------------------------------------------------------------------------

let chartPoints = [];
let hoverId = null;

function setupScatter() {
  new ResizeObserver(() => drawScatter()).observe(el.scatterBox);
  el.scatterCanvas.addEventListener('mousemove', onScatterMove);
  el.scatterCanvas.addEventListener('mouseleave', () => {
    el.scatterTooltip.hidden = true;
    if (hoverId) { hoverId = null; drawScatter(); }
  });
  el.scatterCanvas.addEventListener('click', onScatterClick);
}

function hitTest(e) {
  const rect = el.scatterCanvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let best = null;
  let bestD = Infinity;
  for (const p of chartPoints) {
    const d = (mx - p.x) ** 2 + (my - p.y) ** 2;
    if (d <= (p.r + 4) ** 2 && d < bestD) { best = p; bestD = d; }
  }
  return { hit: best, mx, my, rect };
}

function onScatterMove(e) {
  const { hit, mx, my, rect } = hitTest(e);
  el.scatterCanvas.style.cursor = hit ? 'pointer' : 'default';
  const id = hit ? hit.video.id : null;
  if (id !== hoverId) { hoverId = id; drawScatter(); }
  if (!hit) { el.scatterTooltip.hidden = true; return; }

  const v = hit.video;
  el.scatterTooltip.innerHTML = `
    <strong>${esc(v.title)}</strong>
    ${v.isShorts ? '쇼츠' : '롱폼'} · ${esc(v.channelTitle)}<br>
    채널 평소 ${esc(v.channelBaselineFormatted)} · 조회수 ${esc(v.viewCountFormatted)} · <span class="t-gold">평소 ${esc(v.scoreFormatted)}</span><br>
    구독자 ${esc(v.subscriberCountFormatted)} · 구독자 대비 ${esc(v.subsRatioFormatted)}
    ${hit.dim ? '<div class="tt-note">현재 필터에서 숨겨진 영상입니다</div>' : ''}`;
  el.scatterTooltip.hidden = false;
  const tw = el.scatterTooltip.offsetWidth;
  const th = el.scatterTooltip.offsetHeight;
  let left = mx + 14;
  if (left + tw > rect.width - 4) left = mx - tw - 14;
  let top = my - th / 2;
  top = Math.max(4, Math.min(top, rect.height - th - 4));
  el.scatterTooltip.style.left = `${Math.max(4, left)}px`;
  el.scatterTooltip.style.top = `${top}px`;
}

function onScatterClick(e) {
  const { hit } = hitTest(e);
  if (!hit) return;
  if (hit.dim) {
    toast('현재 필터에 숨겨진 영상입니다.', 'info', {
      label: '필터 모두 해제',
      onClick: () => {
        resetListFilters();
        setTab('feed');
        focusVideo(hit.video.id);
      }
    });
    return;
  }
  setTab('feed');
  focusVideo(hit.video.id);
}

function focusVideo(id) {
  requestAnimationFrame(() => {
    const row = document.getElementById(`v-${id}`);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1800);
  });
}

function drawScatter() {
  const canvas = el.scatterCanvas;
  if (state.searching || el.insights.hidden || state.videos.length === 0) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 10 || rect.height < 10) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const W = rect.width;
  const H = rect.height;
  const pad = { top: 12, right: 14, bottom: 24, left: 42 };
  const pw = W - pad.left - pad.right;
  const ph = H - pad.top - pad.bottom;

  // x = 채널 평소 조회수(같은 형식 최근 영상 중앙값), y = 영상 조회수. 추정(구독자 대비) 영상은 그리지 않는다.
  const pts = state.videos.filter(v => v.scoreBasis === 'baseline' && v.channelBaseline !== null);
  if (pts.length === 0) {
    ctx.fillStyle = '#8c8c8c';
    ctx.font = '12px Malgun Gothic, sans-serif';
    ctx.fillText('채널 평소 조회수를 확인할 수 있는 영상이 없습니다.', pad.left, H / 2);
    chartPoints = [];
    return;
  }

  const lg = x => Math.log10(Math.max(1, x));
  const subs = pts.map(v => Math.max(1, v.channelBaseline));
  const views = pts.map(v => Math.max(1, v.viewCount));
  const xMin = Math.max(0, Math.floor(lg(Math.min(...subs))));
  const xMax = Math.max(xMin + 2, Math.ceil(lg(Math.max(...subs))));
  const yMin = Math.max(0, Math.floor(lg(Math.min(...views))));
  const yMax = Math.max(yMin + 2, Math.ceil(lg(Math.max(...views))));
  const X = s => pad.left + ((lg(s) - xMin) / (xMax - xMin)) * pw;
  const Y = v => pad.top + ph - ((lg(v) - yMin) / (yMax - yMin)) * ph;

  ctx.font = '10.5px Malgun Gothic, sans-serif';
  ctx.lineWidth = 1;

  // grid & labels
  ctx.textBaseline = 'middle';
  for (let e = yMin; e <= yMax; e++) {
    const y = Math.round(Y(10 ** e)) + 0.5;
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#8c8c8c';
    ctx.textAlign = 'right';
    ctx.fillText(axisLabel(10 ** e), pad.left - 6, y);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let e = xMin; e <= xMax; e++) {
    const x = Math.round(X(10 ** e)) + 0.5;
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke();
    ctx.fillStyle = '#8c8c8c';
    ctx.fillText(axisLabel(10 ** e), x, pad.top + ph + 6);
  }
  // reference lines: 조회수 = max(평소, 하한) × k. 하한(1,000회) 아래 구간은 수평선이 된다.
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.left, pad.top, pw, ph); ctx.clip();
  const refs = [[1, 'rgba(170,170,170,0.3)'], [OUTLIER, 'rgba(142,162,255,0.7)'], [MEGA, 'rgba(245,185,66,0.75)']];
  const s0 = 10 ** xMin;
  const s1 = 10 ** xMax;
  const knee = Math.min(s1, Math.max(s0, BASELINE_FLOOR));
  const floorOf = s => Math.max(s, BASELINE_FLOOR);
  ctx.setLineDash([4, 4]);
  for (const [k, color] of refs) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(X(s0), Y(floorOf(s0) * k));
    ctx.lineTo(X(knee), Y(floorOf(knee) * k));
    ctx.lineTo(X(s1), Y(floorOf(s1) * k));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // points: dim → normal → high → mega → hovered
  const f = currentFilters();
  chartPoints = pts.map(v => {
    const x = v.score;
    const tier = !v.qualifies ? 1 : x >= MEGA ? 3 : x >= OUTLIER ? 2 : 1;
    return { video: v, x: X(Math.max(1, v.channelBaseline)), y: Y(Math.max(1, v.viewCount)), r: tier === 3 ? 5.5 : tier === 2 ? 4.5 : 3.5, tier, dim: !passesFilters(v, f) };
  });
  const order = p => (p.video.id === hoverId ? 9 : p.dim ? 0 : p.tier);
  const drawList = [...chartPoints].sort((a, b) => order(a) - order(b));
  const colors = { 1: '#8a8a8a', 2: '#8ea2ff', 3: '#f5b942' };
  // 전체 검색에서는 쇼츠를 속 빈 원으로 그려 롱폼과 구분한다(색은 배수 등급 그대로)
  const ringShorts = state.format === 'all';
  for (const p of drawList) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    const color = p.dim ? '#3a3a3a' : colors[p.tier];
    if (ringShorts && p.video.isShorts) {
      ctx.fillStyle = 'rgba(15,15,15,0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      if (p.video.id === hoverId) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 2.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      continue;
    }
    ctx.fillStyle = color;
    ctx.fill();
    if (p.video.id === hoverId) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    } else if (!p.dim) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(15,15,15,0.9)';
      ctx.stroke();
    }
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function setEngineToggle(engine) {
  el.engineToggle.querySelectorAll('.seg-btn').forEach(b => {
    const on = b.dataset.engine === engine;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// 설정 창이 열려 있는 동안 뒤 화면은 포커스·클릭을 받지 않게 한다(Tab 이 뒤로 나가 Enter 로 검색되는 것 방지)
const BACKGROUND_SELECTORS = ['.toolbar', '.presets-bar', '.dashboard'];
function setBackgroundInert(on) {
  BACKGROUND_SELECTORS.forEach(sel => document.querySelectorAll(sel).forEach(n => { n.inert = on; }));
}

function openSettings() {
  if (!el.modal.hidden) return;
  closeAdvanced();
  state.settingsReturnFocus = document.activeElement;
  const c = state.config;
  el.apiKey.value = c.youtubeApiKey || '';
  el.apiKey.type = 'password';
  el.btnToggleKey.textContent = '보기';
  el.claudePath.value = c.claudeCliPath || '';
  el.codexPath.value = c.codexCliPath || '';
  setEngineToggle(c.aiEngine || 'claude');
  el.detectClaudeStatus.textContent = '';
  el.detectCodexStatus.textContent = '';
  el.detectClaudeStatus.className = el.detectCodexStatus.className = 'form-hint';
  el.saveFeedback.textContent = '';
  el.keyStorageHint.textContent = c.encryptionAvailable
    ? 'API 키는 OS 보호 저장소로 암호화해 앱 폴더(app-data) 안에만 저장합니다.'
    : '이 PC에서는 OS 암호화를 쓸 수 없어 API 키를 앱 폴더(app-data)에 평문으로 저장합니다.';
  state.keyCheck = null;
  setKeyStatus(c.keyCheckedAt
    ? `마지막 확인: ${new Date(c.keyCheckedAt).toLocaleString('ko-KR')} · 정상 동작`
    : (c.youtubeApiKey ? '아직 확인하지 않은 키입니다. [키 확인]으로 동작 여부를 볼 수 있습니다(조회 1 유닛).' : ''), c.keyCheckedAt ? 'ok' : '');
  fillSettingFields(c);
  // 이전에 받은 목록(있으면)으로 바로 채우고, CLI 에서 최신 목록을 새로 받는다
  AI_ENGINES.forEach(e => { fillModelSelect(e, c[`${e}Model`] || ''); fillEffortSelect(e, c[`${e}Effort`] || ''); });
  loadAiModels();
  el.btnClearCache.textContent = '캐시 비우기';
  el.btnClearCache.classList.remove('is-confirm');
  refreshCacheStats();
  refreshUsage();
  el.modal.hidden = false;
  setBackgroundInert(true);
  (c.youtubeApiKey ? el.saveBtn : el.apiKey).focus();
}

function closeSettings() {
  if (el.modal.hidden) return;
  // 저장 중에는 닫지 않는다(결과·오류를 볼 수 있도록)
  if (state.saving) { toast('설정을 저장하는 중입니다. 잠시만 기다려 주세요.'); return; }
  el.modal.hidden = true;
  setBackgroundInert(false);
  // 저장하지 않은 후보 키를 확인했을 수 있으므로 저장된 키 기준 사용량으로 되돌린다
  refreshUsage();
  const back = state.settingsReturnFocus;
  state.settingsReturnFocus = null;
  if (back && document.contains(back) && typeof back.focus === 'function') back.focus();
}

async function detectCli(btn) {
  const engine = btn.dataset.engine;
  const status = engine === 'codex' ? el.detectCodexStatus : el.detectClaudeStatus;
  const input = engine === 'codex' ? el.codexPath : el.claudePath;
  btn.disabled = true;
  status.className = 'form-hint';
  status.textContent = '찾는 중…';
  const res = await window.api.detectCliPath(engine);
  btn.disabled = false;
  if (res.ok && res.data.found) {
    input.value = res.data.path;
    status.className = 'form-hint ok';
    status.textContent = '찾았습니다. 저장을 눌러 적용하세요.';
    loadAiModels();
  } else {
    status.className = 'form-hint err';
    status.textContent = engine === 'codex'
      ? 'Codex CLI를 찾지 못했습니다. 설치(npm i -g @openai/codex) 후 다시 시도하거나 경로를 직접 입력하세요.'
      : 'Claude CLI를 찾지 못했습니다. Claude Code를 설치한 뒤 다시 시도하거나 경로를 직접 입력하세요.';
  }
}

// 설정 화면의 검색 기본값·한도·캐시 칸 채우기
function fillSettingFields(c) {
  setSelect(el.defRegion, c.region || 'KR');
  setSelect(el.defLang, c.language || 'ko');
  setSelect(el.defFormat, c.defaultFormat || 'all');
  setSelect(el.defPeriod, c.defaultPeriod || '7d');
  setSelect(el.defOrder, c.defaultOrder || 'viewCount');
  el.defLangOnly.checked = c.langOnly !== false;
  el.defRemember.checked = c.rememberLast !== false;
  el.defIncludeReligion.checked = c.includeReligion === true;
  el.setSearchLimit.value = c.searchLimit ?? 100;
  el.setUnitLimit.value = c.unitLimit ?? 10000;
  setSelect(el.setCacheTtl, String(c.cacheTtlHours ?? 24));
  setSelect(el.setResultCache, String(c.resultCacheMinutes ?? 60));
}

// --- AI 모델·추론 수준 ---
// 목록은 설정 창을 열 때마다 설치된 CLI 에서 새로 받는다. '' = CLI 기본값(각 CLI 의 자체 설정을 따름)
const AI_ENGINES = ['claude', 'codex'];
const MODEL_RE = /^[A-Za-z0-9._:[\]-]{1,80}$/;
const CUSTOM_MODEL = '__custom__';
const EFFORT_LABEL = { minimal: '최소', low: '낮음 · 빠름', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대 · 느림', ultra: '울트라 · 가장 느림' };
const effortLabel = e => EFFORT_LABEL[e] || e;

function addOption(select, value, text, title = '') {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  if (title) o.title = title;
  select.appendChild(o);
}

function readModel(engine) {
  const f = el.model[engine];
  return f.model.value === CUSTOM_MODEL ? f.custom.value.trim() : f.model.value;
}

function fillModelSelect(engine, saved = '') {
  const f = el.model[engine];
  const info = state.aiModels?.[engine];
  const cur = info?.current?.model || '';
  f.model.textContent = '';
  addOption(f.model, '', `CLI 기본값${cur ? ` (현재: ${cur})` : ''}`, '각 CLI에 설정된 모델을 그대로 씁니다');
  const ids = new Set(['']);
  for (const m of info?.models || []) {
    addOption(f.model, m.id, m.label, `${m.id}${m.desc ? ` — ${m.desc}` : ''}`);
    ids.add(m.id);
  }
  // 목록을 받기 전에는 저장된 값을 그대로 보여 준다(받은 뒤 목록에 없으면 '직접 입력'으로 옮긴다)
  if (!info && saved) { addOption(f.model, saved, saved); ids.add(saved); }
  addOption(f.model, CUSTOM_MODEL, '직접 입력…');
  const custom = !!saved && !ids.has(saved);
  f.model.value = custom ? CUSTOM_MODEL : saved;
  f.custom.value = custom ? saved : '';
  f.custom.hidden = !custom;
}

/** 엔진·모델별로 고를 수 있는 추론 수준과 기본 수준. 목록을 아직 못 받았으면 null */
function effortsFor(engine) {
  const info = state.aiModels?.[engine];
  if (!info) return null;
  const curEffort = info.current?.effort || '';
  if (engine === 'claude') return { list: info.efforts || [], def: curEffort };
  const id = readModel(engine) || info.current?.model || '';
  const m = (info.models || []).find(x => x.id === id);
  if (m) return { list: m.efforts, def: curEffort || m.defaultEffort };
  // 목록에 없는 모델(직접 입력)은 모든 모델의 수준을 합쳐 보여 준다
  const all = new Map();
  (info.models || []).forEach(x => x.efforts.forEach(e => all.set(e.id, e)));
  return { list: [...all.values()], def: curEffort };
}

function fillEffortSelect(engine, saved = '') {
  const f = el.model[engine];
  const e = effortsFor(engine);
  const list = e?.list || [];
  f.effort.textContent = '';
  addOption(f.effort, '', `기본값${e?.def ? ` (${effortLabel(e.def)})` : ''}`, 'CLI 설정 또는 모델 기본 수준을 씁니다');
  list.forEach(x => addOption(f.effort, x.id, x.label));
  let value = saved;
  if (value && !list.some(x => x.id === value)) {
    if (!e) addOption(f.effort, value, effortLabel(value)); // 목록 받기 전
    else value = ''; // 이 모델이 지원하지 않는 수준은 기본값으로
  }
  f.effort.value = value;
}

function setModelsStatus(text, tone = '') {
  el.aiModelsStatus.textContent = text;
  el.aiModelsStatus.className = `form-hint grow${tone ? ' ' + tone : ''}`;
}

async function loadAiModels() {
  const req = ++state.modelsReq;
  el.btnRefreshModels.disabled = true;
  setModelsStatus('설치된 CLI에서 모델 목록을 받는 중…');
  const res = await window.api.getAiModels({ claudePath: el.claudePath.value.trim(), codexPath: el.codexPath.value.trim() });
  if (req !== state.modelsReq) return;
  el.btnRefreshModels.disabled = false;
  if (el.modal.hidden) return;
  if (!res.ok) { setModelsStatus(`모델 목록을 받지 못했습니다: ${res.error.message}`, 'err'); return; }
  // 지금 고른 값은 유지하고 목록만 바꾼다
  const keep = Object.fromEntries(AI_ENGINES.map(e => [e, { model: readModel(e), effort: el.model[e].effort.value }]));
  state.aiModels = res.data;
  AI_ENGINES.forEach(e => { fillModelSelect(e, keep[e].model); fillEffortSelect(e, keep[e].effort); });
  const part = (name, i) => {
    if (!i.found && !i.models.length) return `${name} CLI 없음`;
    if (!i.found) return `${name} CLI 없음(저장된 목록 ${i.models.length}개)`;
    return `${name} 모델 ${i.models.length}개${i.source === 'cache' ? '(CLI 저장 목록)' : ''}`;
  };
  const time = new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  setModelsStatus(`${part('Claude', res.data.claude)} · ${part('Codex', res.data.codex)} — ${time} 기준 최신 목록`, 'ok');
}

function onModelSelectChange(engine) {
  const f = el.model[engine];
  const custom = f.model.value === CUSTOM_MODEL;
  f.custom.hidden = !custom;
  if (custom) f.custom.focus();
  // Codex 는 모델마다 쓸 수 있는 추론 수준이 다르다
  if (engine === 'codex') fillEffortSelect(engine, f.effort.value);
}

/** 저장할 모델·추론 값. 잘못된 직접 입력이면 { error, focus } */
function readAiModelSettings() {
  const out = {};
  for (const e of AI_ENGINES) {
    const f = el.model[e];
    const m = readModel(e);
    if (f.model.value === CUSTOM_MODEL && !MODEL_RE.test(m)) {
      return { error: `${e === 'codex' ? 'Codex' : 'Claude'} 모델 이름을 확인해 주세요(영문·숫자와 . - _ : [ ] 만, 80자 이내).`, focus: f.custom };
    }
    out[`${e}Model`] = m;
    out[`${e}Effort`] = f.effort.value;
  }
  return { values: out };
}

function setKeyStatus(text, tone = '') {
  el.keyCheckStatus.textContent = text;
  el.keyCheckStatus.className = `form-hint${tone ? ' ' + tone : ''}`;
}

const KEY_FATAL = ['KEY_FORMAT', 'KEY_INVALID', 'API_DISABLED', 'FORBIDDEN'];

async function checkKey() {
  const key = el.apiKey.value.trim();
  if (!key) { setKeyStatus('확인할 API 키를 입력해 주세요.', 'err'); el.apiKey.focus(); return; }
  el.btnCheckKey.disabled = true;
  setKeyStatus('확인 중…');
  const res = await window.api.validateApiKey(key);
  el.btnCheckKey.disabled = false;
  if (res.ok) {
    state.keyCheck = { key, at: res.data.checkedAt };
    const u = res.data.usage;
    const changed = key !== (state.config.youtubeApiKey || '');
    setKeyStatus(changed
      ? `정상 동작하는 키입니다. 이 키의 오늘 사용량은 검색 ${u.search}회 · 조회 ${u.units} 유닛입니다. 저장을 누르면 이 키 기준으로 한도를 셉니다.`
      : '정상 동작하는 키입니다(조회 1 유닛 사용).', 'ok');
    // 확인한 키의 사용량을 바로 보여 준다(사용량은 키별로 따로 센다). 저장 전 후보 키면 설정 창 안내에만 표시
    refreshUsage(u, { hintOnly: changed });
  } else {
    state.keyCheck = null;
    setKeyStatus(res.error.message, 'err');
    refreshUsage();
  }
}

async function refreshCacheStats() {
  const res = await window.api.getCacheStats();
  if (!res.ok) { el.cacheStats.textContent = ''; return; }
  const st = res.data;
  const kb = st.bytes >= 1048576 ? `${(st.bytes / 1048576).toFixed(1)}MB` : `${Math.max(0, Math.round(st.bytes / 1024))}KB`;
  const oldest = st.oldest ? ` · 가장 오래된 항목 ${new Date(st.oldest).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : '';
  el.cacheStats.textContent = `지금 저장된 채널 ${st.channels.toLocaleString('ko-KR')}개 · ${kb}${oldest} · 최근 검색 결과 ${(st.results || 0).toLocaleString('ko-KR')}개`;
}

// 두 번 눌러야 비운다(실수 방지). 지우는 것은 다시 받을 수 있는 캐시뿐이다.
async function clearCache() {
  if (!el.btnClearCache.classList.contains('is-confirm')) {
    el.btnClearCache.classList.add('is-confirm');
    el.btnClearCache.textContent = '한 번 더 눌러 비우기';
    clearTimeout(state.clearCacheTimer);
    state.clearCacheTimer = setTimeout(() => { el.btnClearCache.classList.remove('is-confirm'); el.btnClearCache.textContent = '캐시 비우기'; }, 4000);
    return;
  }
  clearTimeout(state.clearCacheTimer);
  el.btnClearCache.classList.remove('is-confirm');
  el.btnClearCache.textContent = '캐시 비우기';
  const res = await window.api.clearCache();
  if (!res.ok) return toast(res.error.message, 'error');
  refreshCacheStats();
  state.cachedAt = 0;
  renderCacheChip();
  toast('캐시를 비웠습니다. 다음 검색부터 채널 평소 조회수와 검색 결과를 새로 받습니다.', 'success');
}

async function resetSettingDefaults() {
  const res = await window.api.getConfigDefaults();
  if (!res.ok) return toast(res.error.message, 'error');
  fillSettingFields(res.data);
  el.saveFeedback.className = 'form-feedback';
  el.saveFeedback.textContent = '기본값을 채웠습니다. [저장]을 눌러야 적용됩니다.';
}

async function saveSettings() {
  // Enter 를 빠르게 두 번 눌러도 키 확인·저장을 한 번만 한다
  if (state.saving || el.saveBtn.disabled) return;
  state.saving = true;
  try {
    await doSaveSettings();
  } finally {
    state.saving = false;
    el.saveBtn.disabled = false;
  }
}

async function doSaveSettings() {
  const key = el.apiKey.value.trim();
  const fail = (msg, focus) => {
    el.saveFeedback.className = 'form-feedback err';
    el.saveFeedback.textContent = msg;
    if (focus) focus.focus();
  };
  if (key && !/^AIza[0-9A-Za-z_-]{35}$/.test(key)) return fail('API 키 형식이 아닙니다. AIza로 시작하는 39자리인지 확인해 주세요.', el.apiKey);
  const searchLimit = Math.round(Number(el.setSearchLimit.value));
  const unitLimit = Math.round(Number(el.setUnitLimit.value));
  if (!(searchLimit >= 1 && searchLimit <= 100000)) return fail('하루 검색 한도는 1~100,000 사이로 입력해 주세요.', el.setSearchLimit);
  if (!(unitLimit >= 100 && unitLimit <= 10000000)) return fail('하루 조회 한도는 100~10,000,000 사이로 입력해 주세요.', el.setUnitLimit);
  const ai = readAiModelSettings();
  if (ai.error) return fail(ai.error, ai.focus);

  el.saveBtn.disabled = true;
  // 키를 바꿨으면 저장 전에 실제로 동작하는지 확인(1 유닛). 키 자체가 잘못된 경우만 막고, 일시적인 실패는 저장한다.
  let keyCheckedAt;
  let warn = '';
  const keyChanged = key && key !== state.config.youtubeApiKey;
  if (keyChanged) {
    if (state.keyCheck && state.keyCheck.key === key) {
      keyCheckedAt = state.keyCheck.at;
    } else {
      el.saveFeedback.className = 'form-feedback';
      el.saveFeedback.textContent = '키 확인 중…';
      const v = await window.api.validateApiKey(key);
      if (v.ok) keyCheckedAt = v.data.checkedAt;
      else if (KEY_FATAL.includes(v.error.code)) { el.saveBtn.disabled = false; setKeyStatus(v.error.message, 'err'); return fail('API 키를 확인하지 못해 저장하지 않았습니다.', el.apiKey); }
      else warn = ` 다만 키를 확인하지 못했습니다(${v.error.message}).`;
    }
  }
  const payload = {
    youtubeApiKey: key,
    aiEngine: el.engineToggle.querySelector('.seg-btn.active')?.dataset.engine || 'claude',
    claudeCliPath: el.claudePath.value.trim(),
    codexCliPath: el.codexPath.value.trim(),
    ...ai.values,
    region: el.defRegion.value || state.config.region || 'KR',
    language: el.defLang.value || state.config.language || 'ko',
    langOnly: el.defLangOnly.checked,
    defaultFormat: el.defFormat.value,
    defaultPeriod: el.defPeriod.value,
    defaultOrder: el.defOrder.value,
    rememberLast: el.defRemember.checked,
    includeReligion: el.defIncludeReligion.checked,
    searchLimit,
    unitLimit,
    cacheTtlHours: Number(el.setCacheTtl.value),
    resultCacheMinutes: Number(el.setResultCache.value)
  };
  if (!keyChanged && key && state.keyCheck && state.keyCheck.key === key) keyCheckedAt = state.keyCheck.at;
  if (keyCheckedAt) payload.keyCheckedAt = keyCheckedAt;
  const res = await window.api.saveConfig(payload);
  el.saveBtn.disabled = false;
  if (!res.ok) return fail(res.error.message);
  state.config = { ...state.config, ...res.data };
  refreshConfigUI();
  state.saving = false;
  closeSettings();
  toast(`설정을 저장했습니다.${warn}`, warn ? 'info' : 'success');
  // 키를 처음 넣었거나 바꿨으면 국가·카테고리 목록을 실제 목록으로 다시 받는다
  if (keyChanged) { loadRegions(); loadCategories(); }
  if (state.videos.length === 0 && !state.searched) renderFeed();
  if (!state.aiRunning && !state.aiReport && state.videos.length === 0) renderAiIdle();
}

window.addEventListener('DOMContentLoaded', init);
