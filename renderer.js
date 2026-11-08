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
  aiReport: null
};

const OUTLIER = 3;
const MEGA = 10;
const BASELINE_FLOOR = 1000; // services/youtube.js 와 동일: 평소 조회수 하한
const EXAMPLES = ['AI 부업', '쇼츠 자동화', '재테크 초보', '자취 요리'];

const el = {
  searchForm: $('search-form'), searchInput: $('search-input'), searchBtn: $('search-btn'),
  formatToggle: $('format-toggle'), outlierFilter: $('outlier-filter'), categoryFilter: $('category-filter'),
  publishedFilter: $('published-filter'), sortSelect: $('sort-select'),
  btnCsv: $('btn-export-csv'), btnSettings: $('btn-open-settings'), settingsAlert: $('settings-alert'),
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

  setupWindowControls();
  setupEvents();
  setupScatter();
  refreshConfigUI();
  renderFeed();
  renderAiIdle();
  el.searchInput.focus();
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

  el.formatToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    el.formatToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    onClientFilterChange();
  });
  el.outlierFilter.addEventListener('change', onClientFilterChange);
  el.sortSelect.addEventListener('change', renderFeed);

  const rerun = (label) => {
    if (!state.keyword && !state.searching) return;
    toast(`${label} 조건을 바꿔 다시 검색합니다.`);
    if (state.searching) state.pendingRerun = true;
    else handleSearch(state.keyword);
  };
  // 파일을 창에 떨어뜨려도 페이지가 바뀌지 않도록 차단
  ['dragover', 'drop'].forEach(type => document.addEventListener(type, e => e.preventDefault()));
  el.categoryFilter.addEventListener('change', () => rerun('주제'));
  el.publishedFilter.addEventListener('change', () => rerun('기간'));

  el.btnCsv.addEventListener('click', handleExportCsv);
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
    publishedPeriod: el.publishedFilter.value
  });
  if (seq !== state.searchSeq) return;
  setSearching(false);

  // 검색 중에 주제·기간이 바뀌었으면 결과를 버리고 새 조건으로 다시 검색
  if (state.pendingRerun) {
    state.pendingRerun = false;
    handleSearch(query);
    return;
  }

  if (!res.ok) {
    resetResults();
    renderFeedError(res.error);
    renderAiIdle('검색이 완료되면 기획안을 만들 수 있습니다.');
    return;
  }

  state.keyword = query;
  state.videos = res.data.videos;
  state.analytics = res.data.analytics;
  state.excluded = res.data.excluded || { live: 0 };
  state.keywordFilter = '';
  state.aiReport = null;
  el.btnCsv.disabled = state.videos.length === 0;

  if (state.videos.length === 0) {
    el.insights.hidden = true;
    renderFeed();
    renderAiIdle('분석할 영상이 없습니다.');
    return;
  }

  renderInsights();
  renderFeed();
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
  state.keywordFilter = '';
  state.aiReport = null;
  el.insights.hidden = true;
  el.btnCsv.disabled = true;
  el.btnAiRun.disabled = true;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function currentFilters() {
  return {
    format: el.formatToggle.querySelector('.seg-btn.active')?.dataset.format || 'all',
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
  if (state.excluded.live > 0) notes.push(`라이브·예정 ${state.excluded.live}개 제외`);
  el.scatterNote.textContent = [`점선: 채널 평소의 1·3·10배 · 조회수 ${minViewsLabel()} 미만은 회색 · 점을 누르면 영상으로 이동`, ...notes].join(' · ');

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

function renderFeed() {
  el.filterBar.hidden = !state.keywordFilter;
  el.filterWord.textContent = state.keywordFilter ? `#${state.keywordFilter}` : '';

  if (state.videos.length === 0) {
    el.feedCount.textContent = '';
    el.feed.innerHTML = state.keyword ? noResultHtml() : onboardingHtml();
    return;
  }

  const f = currentFilters();
  const list = sortVideos(state.videos.filter(v => passesFilters(v, f)));
  el.feedCount.textContent = list.length === state.videos.length
    ? `${list.length}개`
    : `${list.length}개 표시 · 전체 ${state.videos.length}개`;

  if (list.length === 0) {
    el.feed.innerHTML = `
      <div class="state">
        <div class="state-icon">${icon('search')}</div>
        <h3>조건에 맞는 영상이 없습니다</h3>
        <p>떡상 배수 기준을 낮추거나 형식·키워드 필터를 해제해 보세요.</p>
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
            <button type="button" class="vbtn" data-act="tags" ${tagCount ? '' : 'disabled'} title="${tagCount ? '공개 태그를 쉼표로 구분해 복사' : '공개된 태그가 없습니다'}">${icon('tag')}태그 ${tagCount}</button>
          </div>
        </div>
        <h3 class="vtitle" title="${esc(v.title)}">${esc(v.title)}</h3>
        <div class="vmeta">
          <span class="vchan" title="${esc(v.channelTitle)}">${esc(v.channelTitle)}</span>
          <span>구독자 <b>${esc(v.subscriberCountFormatted)}</b></span>
          <span>조회수 <b>${esc(v.viewCountFormatted)}</b></span>
          <span title="같은 형식 최근 영상 조회수 중앙값">채널 평소 <b>${esc(v.channelBaseline === null ? '-' : v.channelBaselineFormatted)}</b></span>
          <span>하루 평균 <b>${esc(v.viewsPerDayFormatted)}</b></span>
          <span>${esc(v.publishedAtRelative)}</span>
        </div>
      </div>
    </article>`;
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
    el.formatToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.format === 'all'));
    onClientFilterChange();
  } else if (act === 'reset-server-filters') {
    el.categoryFilter.value = '0';
    el.publishedFilter.value = 'all';
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
      <p>${esc(engineLabel())} CLI가 ${outlierCount >= 5 ? `떡상 영상 상위 ${Math.min(10, outlierCount)}개` : '떡상·조회수 상위 영상'}를 분석하고 있습니다 · <span id="ai-elapsed">0초</span></p>
      <small>보통 20~60초 걸립니다. 그동안 왼쪽 목록을 계속 살펴보셔도 됩니다.</small>
    </div>`;
  const timer = setInterval(() => {
    const node = $('ai-elapsed');
    if (node) node.textContent = `${Math.round((Date.now() - started) / 1000)}초`;
  }, 1000);

  const res = await window.api.generateStrategy({ keyword: state.keyword, videos: state.videos });
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

function planText(rec, i) {
  return [`[기획안 ${i + 1}] ${rec.format}`, `제목: ${rec.title}`, `썸네일: ${rec.thumbnailConcept}`, `첫 10초: ${rec.hookIntro}`].join('\n');
}

function renderAiReport(r) {
  const plans = r.recommendations.map((rec, i) => `
    <article class="plan ${i === 0 ? 'top' : ''}">
      <div class="plan-head">
        <span class="pill pill-muted">${esc(rec.format)}</span>
        ${i === 0 ? '<span class="plan-rank">추천 1순위</span>' : ''}
        <button type="button" class="vbtn" data-act="copy-plan" data-index="${i}" title="이 기획안 전체 복사">${icon('copy')}복사</button>
      </div>
      <h4 class="plan-title">${esc(rec.title)}</h4>
      ${rec.thumbnailConcept ? `<div class="plan-field"><span>썸네일 구성</span><p>${esc(rec.thumbnailConcept)}</p></div>` : ''}
      ${rec.hookIntro ? `<div class="plan-field"><span>첫 10초 대본</span><p>${esc(rec.hookIntro)}</p></div>` : ''}
    </article>`).join('');

  el.aiBody.innerHTML = `
    <div class="ai-basis">"${esc(state.keyword)}" ${r.basisSupplemented ? `떡상 영상이 적어 조회수 상위 영상을 포함한 ${r.basisCount}개` : `떡상 영상 상위 ${r.basisCount}개`} 기반 · ${esc(r.engine)} CLI</div>
    <section class="ai-block">
      <h4>떡상 패턴 요약</h4>
      <p>${esc(r.summary)}</p>
      ${r.hookingAngles.length ? `<ol>${r.hookingAngles.map(a => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
    </section>
    ${r.blueOceanInsight ? `<section class="ai-block alt"><h4>틈새 공략 각도</h4><p>${esc(r.blueOceanInsight)}</p></section>` : ''}
    <div class="ai-section-title">바로 만들 수 있는 기획안 ${r.recommendations.length}개</div>
    ${plans}`;
}

function onAiClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'open-settings') openSettings();
  else if (btn.dataset.act === 'retry-ai') runAi();
  else if (btn.dataset.act === 'copy-plan' && state.aiReport) {
    const i = Number(btn.dataset.index);
    copyText(planText(state.aiReport.recommendations[i], i), `기획안 ${i + 1}을 복사했습니다.`);
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
    ${esc(v.channelTitle)}<br>
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
        el.formatToggle.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.format === 'all'));
        setKeywordFilter('');
        focusVideo(hit.video.id);
      }
    });
    return;
  }
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
  for (const p of drawList) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = p.dim ? '#2b3856' : colors[p.tier];
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

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // Excel 수식 주입 방지
  return `"${s.replace(/"/g, '""')}"`;
}

function buildCsv(videos) {
  const headers = ['영상 ID', '제목', '카테고리', '채널명', '구독자 수', '조회수', '채널 평소 조회수', '평소 대비 배수', '구독자 대비 배수', '배수 기준', '떡상 여부', '하루 평균 조회수', '형식', '재생 시간(초)', '업로드 일시', '태그', 'URL'];
  const basisLabel = { baseline: '채널 평소', subs: '구독자 대비(추정)' };
  const rows = videos.map(v => [
    v.id, v.title, v.categoryName, v.channelTitle,
    v.subscriberCount ?? '비공개', v.viewCount, v.channelBaseline ?? '',
    v.scoreBasis === 'baseline' ? v.score : '', v.subsRatio ?? '', basisLabel[v.scoreBasis] || '',
    v.qualifies && v.score >= OUTLIER ? '떡상' : '', v.viewsPerDay,
    v.isShorts ? '쇼츠' : '롱폼', v.durationSec, v.publishedAt, (v.tags || []).join('; '), v.url
  ].map(csvCell).join(','));
  return '﻿' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
}

async function handleExportCsv() {
  if (state.videos.length === 0) return;
  const list = sortVideos([...state.videos]);
  const date = new Date().toISOString().slice(0, 10);
  const res = await window.api.saveCsv(`boks_youtube_${state.keyword}_${date}.csv`, buildCsv(list));
  if (!res.ok) return toast(res.error.message, 'error');
  if (res.data.saved) {
    toast(`${list.length}개 영상을 CSV로 저장했습니다.`, 'success', {
      label: '폴더 열기',
      onClick: () => window.api.showItemInFolder(res.data.filePath)
    });
  }
}

window.addEventListener('DOMContentLoaded', init);
