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
  openTags: new Set() // 태그 패널을 펼친 영상 id
};

// 상단 검색 조건 기억(키워드 제외). 브라우저 저장소는 app-data/electron 안에 있다.
// v2: 목록 배수 필터 기본값을 '전체'로 바꾸고(목록 = 분석 대상) 검색 기준(조회수순/관련도순)을 추가했다.
const PREFS_KEY = 'boks.prefs.v2';
const LEGACY_PREFS_KEY = 'boks.prefs.v1';
const PREF_DEFAULTS = { format: 'all', period: 'all', category: '0', order: 'viewCount', minRatio: '0', sort: 'ratio' };

function loadPrefs() {
  const read = key => {
    const raw = JSON.parse(localStorage.getItem(key) || 'null');
    return raw && typeof raw === 'object' ? raw : null;
  };
  try {
    const cur = read(PREFS_KEY);
    if (cur) return { ...PREF_DEFAULTS, ...cur };
    // 이전 버전 조건은 이어 쓰되, 예전 기본값이던 '3배 이상' 목록 필터는 가져오지 않는다
    const old = read(LEGACY_PREFS_KEY);
    if (old) { const { minRatio, ...rest } = old; return { ...PREF_DEFAULTS, ...rest }; }
  } catch { /* 손상 → 기본값 */ }
  return { ...PREF_DEFAULTS };
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      format: selectedFormat(), period: selectedPeriod(), order: selectedOrder(),
      category: el.categoryFilter.value, minRatio: el.outlierFilter.value, sort: el.sortSelect.value
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
  setSegment(el.periodToggle, 'period', p.period);
  setSegment(el.orderToggle, 'order', p.order);
  setSelect(el.categoryFilter, String(p.category));
  setSelect(el.outlierFilter, String(p.minRatio));
  setSelect(el.sortSelect, String(p.sort));
}

const selectedFormat = () => el.formatToggle.querySelector('.seg-btn.active')?.dataset.format || 'all';
const selectedPeriod = () => el.periodToggle.querySelector('.seg-btn.active')?.dataset.period || 'all';
const selectedOrder = () => el.orderToggle.querySelector('.seg-btn.active')?.dataset.order || 'viewCount';

const OUTLIER = 3;
const MEGA = 10;
const BASELINE_FLOOR = 1000; // services/youtube.js 와 동일: 평소 조회수 하한
const EXAMPLES = ['AI 부업', '쇼츠 자동화', '재테크 초보', '자취 요리'];

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
  toastHost: $('toast-host'), winMax: $('win-max')
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

  applyPrefs(loadPrefs());
  setupWindowControls();
  setupEvents();
  setupScatter();
  refreshConfigUI();
  renderFeed();
  renderAiIdle();
  refreshUsage();
  el.searchInput.focus();
}

async function refreshUsage(snapshot) {
  let u = snapshot;
  if (!u) {
    const res = await window.api.getUsage();
    if (!res.ok) return;
    u = res.data;
  }
  const n = x => x.toLocaleString('ko-KR');
  el.usageMeter.hidden = false;
  el.usageMeter.textContent = `오늘 API 검색 ${n(u.search)}/${n(u.searchLimit)} · 조회 ${n(u.units)}/${n(u.unitLimit)}`;
  el.usageMeter.classList.toggle('warn', u.search >= u.searchLimit * 0.8 || u.units >= u.unitLimit * 0.8);
  el.usageMeter.title = `이 PC에서 오늘(태평양 시간 ${u.day}) 쓴 YouTube API 사용량입니다. 매일 오후 4~5시(한국 시간)에 초기화됩니다. 같은 키를 다른 곳에서도 쓰면 실제 사용량은 더 많을 수 있습니다.`;
  if (el.usageHint) el.usageHint.textContent = `오늘 이 PC 사용량: 검색 ${n(u.search)}/${n(u.searchLimit)}회 · 조회 ${n(u.units)}/${n(u.unitLimit)} 유닛`;
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
  el.aiEnginePill.textContent = `${engineLabel()} CLI`;
}

function setupEvents() {
  el.searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSearch();
  });

  const rerun = (label) => {
    savePrefs();
    if (!state.keyword && !state.searching) return;
    toast(`${label} 조건을 바꿔 다시 검색합니다.`);
    if (state.searching) state.pendingRerun = true;
    else handleSearch(state.keyword);
  };
  const segHandler = (group, attr, label) => group.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn || btn.classList.contains('active')) return;
    setSegment(group, attr, btn.dataset[attr]);
    rerun(label);
  });
  // 형식·기간·주제는 검색 조건 → 바뀌면 다시 검색
  segHandler(el.formatToggle, 'format', '형식');
  segHandler(el.periodToggle, 'period', '기간');
  segHandler(el.orderToggle, 'order', '검색 기준');
  el.categoryFilter.addEventListener('change', () => rerun('주제'));
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
  el.apiKey.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveSettings(); });
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
  $('btn-open-console').addEventListener('click', () => window.api.openExternal('https://console.cloud.google.com/apis/library/youtube.googleapis.com'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.modal.hidden) closeSettings();
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
  el.searchBtn.disabled = on;
  el.searchBtn.classList.toggle('is-loading', on);
  el.searchBtn.querySelector('.btn-label').textContent = on ? '분석 중' : '분석하기';
  el.btnAiRun.disabled = on || state.aiRunning || state.videos.length === 0;
}

async function handleSearch(forcedQuery) {
  const query = (forcedQuery ?? el.searchInput.value).trim();
  if (!query) {
    toast('분석할 키워드를 입력해 주세요.');
    el.searchInput.focus();
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
  setSearching(true);
  stopAi('새 검색이 끝나면 기획안을 다시 만듭니다.');
  el.feed.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');
  el.feedCount.textContent = '';

  const res = await window.api.searchYouTube({
    query,
    videoCategoryId: el.categoryFilter.value,
    publishedPeriod: selectedPeriod(),
    format: selectedFormat(),
    order: selectedOrder()
  });
  if (seq !== state.searchSeq) return;
  setSearching(false);
  refreshUsage(res.ok ? res.data.usage : undefined);

  // 검색 중에 주제·기간이 바뀌었으면 결과를 버리고 새 조건으로 다시 검색
  if (state.pendingRerun) {
    state.pendingRerun = false;
    handleSearch(query);
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
  state.videos = res.data.videos;
  state.analytics = res.data.analytics;
  state.trends = res.data.trends;
  state.format = res.data.format || 'all';
  state.excluded = res.data.excluded || { live: 0 };
  state.searchInfo = res.data.searchInfo || null;
  state.keywordFilter = '';
  state.aiReport = null;
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
  if (b && b.quotaHit) {
    toast('API 사용 한도 때문에 일부 채널의 평소 조회수를 확인하지 못했습니다. 해당 영상은 구독자 대비 배수로 추정해 표시합니다.', 'info');
  }
  runAi();
}

function resetResults() {
  stopAi();
  state.keyword = '';
  state.videos = [];
  state.analytics = null;
  state.trends = null;
  state.keywordFilter = '';
  state.aiReport = null;
  state.openTags.clear();
  el.insights.hidden = true;
  renderTrends();
  el.btnAiRun.disabled = true;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function currentFilters() {
  return {
    // 전체 검색일 때만 목록 안에서 쇼츠/롱폼을 나눠 본다(검색 형식이 한 가지면 이미 그 형식뿐)
    format: state.format === 'all' ? state.feedView : 'all',
    minRatio: parseFloat(el.outlierFilter.value) || 0,
    keyword: state.keywordFilter
  };
}

function passesFilters(v, f = currentFilters()) {
  if (f.format === 'long' && v.isShorts) return false;
  if (f.format === 'shorts' && !v.isShorts) return false;
  // 배수 필터는 떡상 판정 대상(조회수 하한선 통과) 영상에만 적용
  if (f.minRatio > 0 && !(v.qualifies && v.score >= f.minRatio)) return false;
  if (f.keyword && !v.title.toLowerCase().includes(f.keyword.toLowerCase())) return false;
  return true;
}

function onClientFilterChange() {
  renderFeed();
  drawScatter();
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
      title="눌러서 제목에 '${esc(k.word)}'가 들어간 영상만 보기">
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
  if (x.spam) parts.push(`해시태그 도배 ${x.spam}`);
  if (x.language) parts.push(`해외·외국어 ${x.language}`);
  if (x.offtopic) parts.push(`키워드 무관 ${x.offtopic}`);
  if (x.live) parts.push(`라이브·예정 ${x.live}`);
  if (x.format) parts.push(`다른 형식 ${x.format}`);
  const total = (x.spam || 0) + (x.language || 0) + (x.offtopic || 0) + (x.live || 0) + (x.format || 0);
  return { total, parts };
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
    lines.push(`제외 ${ex.total}개(${ex.parts.join(' · ')}개)는 목록·지표·트렌드·AI 어디에도 넣지 않습니다.`,
      '해시태그만 나열한 스팸, 한국어 키워드인데 한글이 거의 없는 해외 영상, 제목·태그·설명·채널명 어디에도 키워드가 없는 영상을 걸러냅니다.');
  }
  const si = state.searchInfo;
  if (si) lines.push(`검색 기준: ${si.order === 'relevance' ? '관련도순' : '조회수순'} · 검색 ${si.calls}회 사용${si.topupStopped ? ' · 사용 한도 때문에 보충 검색을 일부 못 했습니다' : ''}`);
  if (shown !== n) lines.push(`지금 목록은 필터로 ${shown}개만 보여 주고 있습니다. 지표는 분석 대상 ${n}개 기준입니다.`);
  return {
    text: `분석 대상 ${n}개 · 떡상 ${outliers}개${ex.total ? ` · 제외 ${ex.total}개` : ''}`,
    title: lines.join('\n')
  };
}

function renderFeed() {
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

  if (!hasVideos) {
    el.feedCount.textContent = '';
    el.filterNote.textContent = '';
    el.feed.innerHTML = state.keyword ? noResultHtml() : onboardingHtml();
    return;
  }

  const f = currentFilters();
  const list = sortVideos(state.videos.filter(v => passesFilters(v, f)));
  const filtered = list.length !== state.videos.length;
  const note = scopeNote(list.length);
  el.filterNote.textContent = note.text;
  el.filterNote.title = note.title;
  el.outlierFilter.classList.toggle('is-on', f.minRatio > 0);
  el.feedCount.textContent = filtered ? `${list.length}/${state.videos.length}` : `${list.length}`;
  el.feedCount.title = filtered ? `필터로 ${list.length}개만 표시 중 · 분석 대상 ${state.videos.length}개` : `분석 대상 ${list.length}개`;

  if (list.length === 0) {
    el.feed.innerHTML = `
      <div class="state">
        <div class="state-icon">${icon('search')}</div>
        <h3>조건에 맞는 영상이 없습니다</h3>
        <p>배수 필터를 '전체'로 바꾸거나 형식·키워드 필터를 해제해 보세요.</p>
        <div class="actions">
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
    return v.subscriberCount === null
      ? '채널 평소 조회수와 구독자 수를 모두 확인하지 못해 배수를 계산할 수 없습니다'
      : '채널 평소 조회수를 확인하지 못했고 구독자도 0명이라 배수를 계산할 수 없습니다';
  }
  const low = v.qualifies ? '' : ` 다만 조회수가 ${minViewsLabel()} 미만이라 떡상으로 보지 않습니다.`;
  if (v.scoreBasis === 'baseline') {
    return `이 채널의 최근 ${v.isShorts ? '쇼츠' : '롱폼'} ${v.baselineSampleSize}개 조회수 중앙값(${v.channelBaselineFormatted}회)의 ${v.scoreFormatted}입니다.${low}`;
  }
  return `채널의 최근 영상이 부족해 평소 조회수를 계산하지 못했습니다. 대신 구독자 수 대비 배수(${v.scoreFormatted})로 추정했습니다.${low}`;
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
      <div class="thumb">
        ${v.thumbnail ? `<img src="${esc(v.thumbnail)}" alt="" loading="lazy">` : ''}
        ${v.isShorts ? '<span class="badge badge-shorts">쇼츠</span>' : ''}
        ${v.durationFormatted ? `<span class="badge badge-duration">${esc(v.durationFormatted)}</span>` : ''}
      </div>
      <div class="vinfo">
        <div class="vtop">
          <span class="ratio ${ratioClass(v)}" title="${esc(scoreTitle(v))}">${esc(badgeText)}</span>
          <span class="ratio-sub" title="${esc(subsTitle)}">구독자 대비 <b>${esc(v.subsRatioFormatted)}</b></span>
          <span class="vcat">${esc(v.categoryName)}</span>
          <div class="vactions">
            <button type="button" class="vbtn" data-act="open" title="YouTube에서 보기">${icon('external')}YouTube</button>
            <button type="button" class="vbtn ${tagsOpen ? 'on' : ''}" data-act="tags" ${tagCount ? '' : 'disabled'} aria-expanded="${tagsOpen}" title="${tagCount ? '태그 펼쳐 보기' : '공개된 태그가 없습니다'}">${icon('tag')}태그 ${tagCount}</button>
          </div>
        </div>
        <h3 class="vtitle" title="${esc(v.title)}">${esc(v.title)}</h3>
        <div class="vmeta">
          <span class="vchan" title="${esc(v.channelTitle)}">${esc(v.channelTitle)}</span>
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
      <h3>키워드 하나로 떡상 영상을 찾아보세요</h3>
      <p>그 채널의 평소 조회수보다 크게 터진 영상을 골라내고, AI가 바로 만들 수 있는 기획안을 제안합니다.</p>
      <ol class="steps">
        <li class="${hasKey ? 'done' : ''}"><span class="n">${hasKey ? '✓' : '1'}</span>YouTube API 키 등록${hasKey ? ' 완료' : ''}
          ${hasKey ? '' : '<button type="button" class="btn btn-primary btn-sm" data-act="open-settings">설정 열기</button>'}</li>
        <li><span class="n">2</span>상단 검색창에 키워드 입력 후 Enter</li>
      </ol>
      ${hasKey ? `<div class="actions"><span class="field-label">예시로 바로 분석</span>${EXAMPLES.map(k => `<button type="button" class="chip" data-act="example" data-word="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
    </div>`;
}

function noResultHtml() {
  return `
    <div class="state">
      <div class="state-icon">${icon('search')}</div>
      <h3>검색 결과가 없습니다</h3>
      <p>"${esc(state.keyword)}"에 맞는 영상을 찾지 못했습니다. 주제·기간 조건을 넓히거나 다른 키워드로 검색해 보세요.</p>
      <div class="actions"><button type="button" class="btn btn-ghost btn-sm" data-act="reset-server-filters">주제·기간 초기화 후 다시 검색</button></div>
    </div>`;
}

function renderFeedError(err) {
  const keyIssue = ['NO_API_KEY', 'KEY_INVALID', 'API_DISABLED', 'FORBIDDEN'].includes(err.code);
  el.feedCount.textContent = '';
  el.feed.innerHTML = `
    <div class="state">
      <div class="state-icon is-error">${icon('alert')}</div>
      <h3>검색하지 못했습니다</h3>
      <p>${esc(err.message)}</p>
      <div class="actions">
        ${keyIssue ? '<button type="button" class="btn btn-primary btn-sm" data-act="open-settings">설정 열기</button>' : ''}
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
    const res = await window.api.openExternal(video.url);
    if (!res.ok) toast(res.error.message, 'error');
  } else if (act === 'tags' && video) {
    // 펼쳐서 태그를 먼저 보여 주고, 복사는 패널의 [복사] 버튼으로
    if (state.openTags.has(video.id)) state.openTags.delete(video.id);
    else state.openTags.add(video.id);
    row.outerHTML = videoRowHtml(video);
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
    handleSearch();
  } else if (act === 'ratio-all') {
    el.outlierFilter.value = '0';
    onClientFilterChange();
  } else if (act === 'clear-keyword') {
    setKeywordFilter('');
  } else if (act === 'format-all') {
    state.feedView = setSegment(el.feedFormat, 'view', 'all');
    onClientFilterChange();
  } else if (act === 'reset-server-filters') {
    el.categoryFilter.value = '0';
    setSegment(el.periodToggle, 'period', 'all');
    savePrefs();
    handleSearch(state.keyword);
  }
}

// ---------------------------------------------------------------------------
// AI strategy
// ---------------------------------------------------------------------------

function setAiRunning(on) {
  state.aiRunning = on;
  el.btnAiStop.hidden = !on;
  el.btnAiRun.disabled = on || state.searching || state.videos.length === 0;
}

function renderAiIdle(message) {
  setAiRunning(false);
  el.aiBody.innerHTML = `
    <div class="state">
      <div class="state-icon">${icon('spark')}</div>
      <h3>AI 기획안</h3>
      <p>${esc(message || `검색하면 PC에 설치된 ${engineLabel()} CLI가 떡상 영상을 분석해 제목 후보, 썸네일 구성, 첫 10초 대본을 제안합니다.`)}</p>
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

  const res = await window.api.generateStrategy({ keyword: state.keyword, videos: state.videos, format: state.format });
  clearInterval(timer);
  if (seq !== state.aiSeq) return; // 더 최신 요청이 있음
  setAiRunning(false);

  if (res.ok) {
    state.aiReport = res.data;
    renderAiReport(res.data);
  } else if (res.error.code === 'CANCELLED') {
    renderAiIdle('AI 분석을 중지했습니다. [다시 생성]으로 다시 시작할 수 있습니다.');
  } else {
    renderAiError(res.error);
  }
}

// 진행 중인 AI 요청을 무효화하고 중단한다. 결과가 늦게 와도 aiSeq 가 달라 무시된다.
function stopAi(message) {
  if (!state.aiRunning) return;
  state.aiSeq++;
  window.api.cancelStrategy();
  renderAiIdle(message || 'AI 분석을 중지했습니다. [다시 생성]으로 다시 시작할 수 있습니다.');
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
    <div class="ai-basis">"${esc(state.keyword)}" ${basis}${r.basisSupplemented ? '(떡상이 적어 조회수 상위 포함)' : ''}와 트렌드 통계 기반 · ${esc(r.engine)} CLI</div>
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
  else if (btn.dataset.act === 'retry-ai') { if (!state.searching) runAi(); }
  else if (btn.dataset.act === 'copy-plan' && state.aiReport) {
    const i = Number(btn.dataset.index);
    copyText(planText(state.aiReport.recommendations[i], i), `기획안 ${i + 1}을 복사했습니다.`);
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
const C_REST = '#3a4a6b';
const TIER_COLORS = { micro: '#9ec5f4', small: '#6da7ec', mid: '#3987e5', large: '#1c5cab', hidden: '#56627c' };

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
    state.feedView = setSegment(el.feedFormat, 'view', 'all');
    el.outlierFilter.value = '0';
    setKeywordFilter('');
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
        el.outlierFilter.value = '0';
        state.feedView = setSegment(el.feedFormat, 'view', 'all');
        setTab('feed');
        setKeywordFilter('');
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
  if (el.insights.hidden || state.videos.length === 0) return;
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
    ctx.fillStyle = '#7486a6';
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
    ctx.strokeStyle = '#1b2742';
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#6f809f';
    ctx.textAlign = 'right';
    ctx.fillText(axisLabel(10 ** e), pad.left - 6, y);
  }
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  for (let e = xMin; e <= xMax; e++) {
    const x = Math.round(X(10 ** e)) + 0.5;
    ctx.strokeStyle = '#1b2742';
    ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + ph); ctx.stroke();
    ctx.fillStyle = '#6f809f';
    ctx.fillText(axisLabel(10 ** e), x, pad.top + ph + 6);
  }
  // reference lines: 조회수 = max(평소, 하한) × k. 하한(1,000회) 아래 구간은 수평선이 된다.
  ctx.save();
  ctx.beginPath(); ctx.rect(pad.left, pad.top, pw, ph); ctx.clip();
  const refs = [[1, 'rgba(116,134,166,0.35)'], [OUTLIER, 'rgba(142,162,255,0.7)'], [MEGA, 'rgba(245,185,66,0.75)']];
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
  const colors = { 1: '#6b7a96', 2: '#8ea2ff', 3: '#f5b942' };
  // 전체 검색에서는 쇼츠를 속 빈 원으로 그려 롱폼과 구분한다(색은 배수 등급 그대로)
  const ringShorts = state.format === 'all';
  for (const p of drawList) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    const color = p.dim ? '#2b3856' : colors[p.tier];
    if (ringShorts && p.video.isShorts) {
      ctx.fillStyle = 'rgba(10,16,32,0.85)';
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
      ctx.strokeStyle = 'rgba(10,16,32,0.9)';
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

function openSettings() {
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
  el.modal.hidden = false;
  (c.youtubeApiKey ? el.saveBtn : el.apiKey).focus();
}

function closeSettings() {
  el.modal.hidden = true;
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
  } else {
    status.className = 'form-hint err';
    status.textContent = engine === 'codex'
      ? 'Codex CLI를 찾지 못했습니다. 설치(npm i -g @openai/codex) 후 다시 시도하거나 경로를 직접 입력하세요.'
      : 'Claude CLI를 찾지 못했습니다. Claude Code를 설치한 뒤 다시 시도하거나 경로를 직접 입력하세요.';
  }
}

async function saveSettings() {
  const key = el.apiKey.value.trim();
  if (key && !/^AIza[0-9A-Za-z_-]{35}$/.test(key)) {
    el.saveFeedback.className = 'form-feedback err';
    el.saveFeedback.textContent = 'API 키 형식이 아닙니다. AIza로 시작하는 39자리인지 확인해 주세요.';
    el.apiKey.focus();
    return;
  }
  el.saveBtn.disabled = true;
  const res = await window.api.saveConfig({
    youtubeApiKey: key,
    aiEngine: el.engineToggle.querySelector('.seg-btn.active')?.dataset.engine || 'claude',
    claudeCliPath: el.claudePath.value.trim(),
    codexCliPath: el.codexPath.value.trim()
  });
  el.saveBtn.disabled = false;
  if (!res.ok) {
    el.saveFeedback.className = 'form-feedback err';
    el.saveFeedback.textContent = res.error.message;
    return;
  }
  state.config = { ...state.config, ...res.data };
  refreshConfigUI();
  closeSettings();
  toast('설정을 저장했습니다.', 'success');
  if (state.videos.length === 0 && !state.keyword) renderFeed();
  if (!state.aiRunning && !state.aiReport && state.videos.length === 0) renderAiIdle();
}

window.addEventListener('DOMContentLoaded', init);
