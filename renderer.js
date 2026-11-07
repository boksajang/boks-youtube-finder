// ==========================================================================
// BOKS YOUTUBE FINDER - All-in-One Unified Dashboard Controller
// ==========================================================================

let currentConfig = null;
let currentVideos = [];
let currentAnalytics = null;
let currentKeyword = '';
let activeKeywordFilter = '';

// DOM Elements
const searchInput = document.getElementById('search-input');
const searchBtn = document.getElementById('search-btn');
const formatBtns = document.querySelectorAll('#format-toggle .chip-btn');
const outlierFilter = document.getElementById('outlier-filter');
const categoryFilter = document.getElementById('category-filter');
const publishedFilter = document.getElementById('published-filter');
const btnExportCsv = document.getElementById('btn-export-csv');

// Insight Triad Elements
const insightTriad = document.getElementById('insight-triad');
const gaugeBarFill = document.getElementById('gauge-bar-fill');
const gaugeLevelBadge = document.getElementById('gauge-level-badge');
const gaugeScoreText = document.getElementById('gauge-score-text');
const metricSmallShare = document.getElementById('metric-small-share');
const gaugeAdviceText = document.getElementById('gauge-advice-text');
const scatterCanvas = document.getElementById('scatter-canvas');
const scatterTooltip = document.getElementById('scatter-tooltip');
const keywordChipsContainer = document.getElementById('keyword-chips-container');
const kpiOutlierCount = document.getElementById('kpi-outlier-count');
const kpiMaxRatio = document.getElementById('kpi-max-ratio');
const kpiAvgViews = document.getElementById('kpi-avg-views');
const kpiAvgSubs = document.getElementById('kpi-avg-subs');

// Workbench Elements
const videoFeed = document.getElementById('video-feed');
const feedCount = document.getElementById('feed-count');
const aiPlansContainer = document.getElementById('ai-plans-container');
const btnReAi = document.getElementById('btn-re-ai');

// Settings Modal Elements
const btnOpenSettings = document.getElementById('btn-open-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const settingsModal = document.getElementById('settings-modal');
const settingApiKey = document.getElementById('setting-api-key');
const btnToggleKey = document.getElementById('btn-toggle-key');
const settingClaudePath = document.getElementById('setting-claude-path');
const settingCodexPath = document.getElementById('setting-codex-path');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const saveFeedback = document.getElementById('save-feedback');
const autoDetectBtns = document.querySelectorAll('.btn-detect');

// --- Initialization ---
async function init() {
  currentConfig = await window.api.getConfig();
  populateSettingsUI();
  setupEventListeners();
  setupCanvasInteraction();
}

function populateSettingsUI() {
  settingApiKey.value = currentConfig.youtubeApiKey || '';
  settingClaudePath.value = currentConfig.claudeCliPath || '';
  settingCodexPath.value = currentConfig.codexCliPath || '';

  const engineRadio = document.querySelector(`input[name="ai-engine"][value="${currentConfig.aiEngine || 'claude'}"]`);
  if (engineRadio) engineRadio.checked = true;
}

// --- Event Listeners ---
function setupEventListeners() {
  searchBtn.addEventListener('click', handleSearch);
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') handleSearch();
  });

  // Instant Filter Changes
  formatBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      formatBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderVideoFeed();
    });
  });

  outlierFilter.addEventListener('change', renderVideoFeed);
  categoryFilter.addEventListener('change', () => { if (currentVideos.length > 0) handleSearch(); });
  publishedFilter.addEventListener('change', () => { if (currentVideos.length > 0) handleSearch(); });

  btnExportCsv.addEventListener('click', handleExportCsv);
  btnReAi.addEventListener('click', triggerAiStrategyGeneration);

  // Settings Modal Controls
  btnOpenSettings.addEventListener('click', () => { settingsModal.style.display = 'flex'; });
  btnCloseSettings.addEventListener('click', () => { settingsModal.style.display = 'none'; });
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.style.display = 'none';
  });

  btnToggleKey.addEventListener('click', () => {
    if (settingApiKey.type === 'password') {
      settingApiKey.type = 'text';
      btnToggleKey.textContent = '숨김';
    } else {
      settingApiKey.type = 'password';
      btnToggleKey.textContent = '보기';
    }
  });

  autoDetectBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
      const engine = btn.dataset.engine;
      const detected = await window.api.detectCliPath(engine);
      if (engine === 'claude') settingClaudePath.value = detected;
      else settingCodexPath.value = detected;
    });
  });

  saveSettingsBtn.addEventListener('click', async () => {
    const selectedEngine = document.querySelector('input[name="ai-engine"]:checked')?.value || 'claude';
    const newConfig = {
      youtubeApiKey: settingApiKey.value.trim(),
      aiEngine: selectedEngine,
      claudeCliPath: settingClaudePath.value.trim(),
      codexCliPath: settingCodexPath.value.trim()
    };

    const res = await window.api.saveConfig(newConfig);
    if (res.success) {
      currentConfig = res.config;
      saveFeedback.textContent = '✓ 저장 완료!';
      setTimeout(() => {
        saveFeedback.textContent = '';
        settingsModal.style.display = 'none';
      }, 1000);
    } else {
      saveFeedback.textContent = '❌ 저장 실패: ' + res.error;
    }
  });

  window.addEventListener('resize', () => {
    if (currentVideos.length > 0) {
      renderScatterChart();
    }
  });
}

// --- Main Search Pipeline ---
async function handleSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    alert('검색할 키워드를 입력해 주세요.');
    searchInput.focus();
    return;
  }

  if (!currentConfig.youtubeApiKey) {
    alert('YouTube Data API 키가 설정되지 않았습니다.\n우측 상단의 [⚙️ 설정]에서 API 키를 먼저 입력해 주세요.');
    settingsModal.style.display = 'flex';
    settingApiKey.focus();
    return;
  }

  currentKeyword = query;
  activeKeywordFilter = '';

  videoFeed.innerHTML = '<div class="spinner"></div>';
  aiPlansContainer.innerHTML = '<div class="spinner"></div><p style="text-align:center; color:var(--text-muted); font-size:12px;">로컬 AI가 실전 기획안을 분석 중...</p>';

  try {
    const res = await window.api.searchYouTube({
      query,
      maxResults: 40,
      regionCode: 'KR',
      relevanceLanguage: 'ko',
      videoCategoryId: categoryFilter.value,
      publishedPeriod: publishedFilter.value
    });

    currentVideos = res.videos || [];
    currentAnalytics = res.analytics || null;

    if (!currentVideos || currentVideos.length === 0) {
      insightTriad.style.display = 'none';
      videoFeed.innerHTML = `
        <div class="empty-dashboard-state">
          <div class="empty-icon">🔍</div>
          <h3>검색 결과가 없습니다</h3>
          <p>"${escapeHtml(query)}"에 대한 결과가 없습니다. 주제나 기간 필터를 완화해 보세요.</p>
        </div>
      `;
      aiPlansContainer.innerHTML = '<div class="ai-placeholder-box"><p>분석할 떡상 영상이 없습니다.</p></div>';
      return;
    }

    // 1. Render Top Insight Triad
    renderInsightTriad();

    // 2. Render Left Video Feed
    renderVideoFeed();

    // 3. Automatically Trigger AI Strategy in Right Column
    triggerAiStrategyGeneration();
  } catch (err) {
    videoFeed.innerHTML = `
      <div class="empty-dashboard-state">
        <div class="empty-icon">⚠️</div>
        <h3>검색 중 오류 발생</h3>
        <p style="color: #ff4763;">${escapeHtml(err.message)}</p>
      </div>
    `;
    aiPlansContainer.innerHTML = '<div class="ai-placeholder-box"><p>오류로 인해 AI 분석이 중단되었습니다.</p></div>';
  }
}

// --- Render Top Insight Triad ---
function renderInsightTriad() {
  if (!currentAnalytics) return;
  const a = currentAnalytics;

  // Opportunity Gauge
  gaugeLevelBadge.textContent = a.opportunityLevel;
  gaugeLevelBadge.style.color = a.opportunityColor;
  gaugeLevelBadge.style.borderColor = a.opportunityColor;
  gaugeLevelBadge.style.backgroundColor = `${a.opportunityColor}20`;
  gaugeBarFill.style.width = `${a.opportunityScore}%`;
  gaugeScoreText.textContent = `${a.opportunityScore}점`;
  metricSmallShare.textContent = `소형 채널 점유율 ${a.smallChannelShare}% (${a.smallChannelCount}개)`;
  gaugeAdviceText.textContent = a.opportunityAdvice;

  // Cheat-Key Keywords Chips
  if (a.topKeywords && a.topKeywords.length > 0) {
    keywordChipsContainer.innerHTML = a.topKeywords.slice(0, 8).map(k => `
      <button class="key-chip" onclick="filterByKeyword('${escapeHtml(k.word)}')">#${escapeHtml(k.word)} (${k.count})</button>
    `).join('');
  } else {
    keywordChipsContainer.innerHTML = '<span class="empty-hint">추출된 키워드 없음</span>';
  }

  // KPIs
  const outliers = currentVideos.filter(v => v.outlierMultiplier >= 3.0);
  const maxRatio = currentVideos.reduce((max, v) => Math.max(max, v.outlierMultiplier), 0);
  kpiOutlierCount.textContent = `떡상 영상 ${outliers.length}개`;
  kpiMaxRatio.textContent = `${maxRatio}x`;
  kpiAvgViews.textContent = a.avgViewsFormatted;
  kpiAvgSubs.textContent = a.avgSubscribersFormatted;

  insightTriad.style.display = 'grid';

  // Render Scatter Canvas
  setTimeout(renderScatterChart, 50);
}

// --- Render Left Video Cards Feed ---
function renderVideoFeed() {
  const activeFormat = document.querySelector('#format-toggle .chip-btn.active')?.dataset.format || 'all';
  const minRatio = parseFloat(outlierFilter.value) || 0;

  let filtered = currentVideos.filter(v => {
    if (activeFormat === 'long' && v.isShorts) return false;
    if (activeFormat === 'shorts' && !v.isShorts) return false;
    if (v.outlierMultiplier < minRatio) return false;
    if (activeKeywordFilter && !v.title.toLowerCase().includes(activeKeywordFilter.toLowerCase())) return false;
    return true;
  });

  // Always sorted by highest outlier multiplier by default
  filtered.sort((a, b) => b.outlierMultiplier - a.outlierMultiplier);
  feedCount.textContent = filtered.length;

  if (filtered.length === 0) {
    videoFeed.innerHTML = `
      <div class="empty-dashboard-state">
        <div class="empty-icon">👀</div>
        <h3>조건에 맞는 영상이 없습니다</h3>
        <p>상단의 배수 필터를 완화하거나 키워드 필터를 해제해 보세요.</p>
        ${activeKeywordFilter ? `<button class="btn-sub" style="margin-top:10px;" onclick="clearKeywordFilter()">#${escapeHtml(activeKeywordFilter)} 필터 해제</button>` : ''}
      </div>
    `;
    return;
  }

  videoFeed.innerHTML = filtered.map(v => createVideoCardHtml(v)).join('');

  // Attach Watch external links
  videoFeed.querySelectorAll('.btn-watch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openExternal(btn.dataset.url);
    });
  });

  // Attach Tag copy buttons
  videoFeed.querySelectorAll('.btn-copy-tags').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const tags = btn.getAttribute('data-tags');
      if (!tags) {
        alert('이 영상에는 등록된 공개 태그가 없습니다.');
        return;
      }
      navigator.clipboard.writeText(tags).then(() => {
        const orig = btn.textContent;
        btn.textContent = '✓ 복사됨';
        btn.style.borderColor = 'var(--accent-green)';
        setTimeout(() => {
          btn.textContent = orig;
          btn.style.borderColor = '';
        }, 2000);
      });
    });
  });
}

function createVideoCardHtml(v) {
  let tagClass = 'normal';
  let tagEmoji = '📈';
  if (v.outlierMultiplier >= 10.0) { tagClass = 'mega'; tagEmoji = '🔥'; }
  else if (v.outlierMultiplier >= 3.0) { tagClass = 'high'; tagEmoji = '⚡'; }

  const thumbUrl = v.thumbnails?.medium?.url || v.thumbnails?.high?.url || v.thumbnails?.default?.url || '';
  const tagsStr = (v.tags || []).join(', ');
  const safeTagsAttr = escapeHtml(tagsStr);
  const safeTitle = escapeHtml(v.title);
  const safeChannel = escapeHtml(v.channelTitle);

  return `
    <div class="video-card" id="card-${v.id}">
      <div class="thumb-container">
        <img src="${thumbUrl}" alt="${safeTitle}" loading="lazy">
        ${v.isShorts ? '<span class="badge-shorts">SHORTS</span>' : ''}
        <span class="badge-category">${v.categoryName}</span>
        <span class="badge-duration">${v.durationFormatted}</span>
      </div>
      <div class="card-body">
        <div class="outlier-tag ${tagClass}">
          <span>${tagEmoji} <strong>${v.outlierMultiplier}x</strong> 떡상</span>
        </div>
        <h4 class="video-title" title="${safeTitle}">${safeTitle}</h4>
        <div class="channel-info">
          <span class="channel-name" title="${safeChannel}">${safeChannel}</span>
          <span>구독자 ${v.subscriberCountFormatted}</span>
        </div>
        <div class="video-stats-row">
          <span>조회수 <strong class="stat-highlight">${v.viewCountFormatted}</strong></span>
          <span>일일 +${v.viewsPerDayFormatted}</span>
          <span>${v.publishedAtRelative}</span>
        </div>
        <div class="card-actions">
          <button class="btn-watch" data-url="${v.url}">유튜브 시청 ↗</button>
          <button class="btn-copy-tags" data-tags="${safeTagsAttr}">🏷️ 태그 (${v.tags ? v.tags.length : 0})</button>
        </div>
      </div>
    </div>
  `;
}

window.filterByKeyword = function(word) {
  activeKeywordFilter = word;
  renderVideoFeed();
};

function clearKeywordFilter() {
  activeKeywordFilter = '';
  renderVideoFeed();
}

// --- Right Column: AI Strategy Generation ---
async function triggerAiStrategyGeneration() {
  if (!currentVideos || currentVideos.length === 0) return;

  aiPlansContainer.innerHTML = `
    <div class="spinner"></div>
    <p style="text-align: center; color: var(--text-muted); font-size: 12.5px;">
      로컬 ${currentConfig.aiEngine.toUpperCase()} CLI가 실전 기획안을 도출 중입니다...
    </p>
  `;

  try {
    const report = await window.api.generateStrategy({
      keyword: currentKeyword,
      videos: currentVideos
    });

    renderAiPlans(report);
  } catch (err) {
    aiPlansContainer.innerHTML = `
      <div class="ai-placeholder-box">
        <span class="ai-icon-large">⚠️</span>
        <p style="color: #ff4763;">AI 분석 실패: ${escapeHtml(err.message)}</p>
        <button class="btn-sub" onclick="settingsModal.style.display='flex'">⚙️ CLI 경로 설정 점검</button>
      </div>
    `;
  }
}

function renderAiPlans(report) {
  const hookingList = (report.hookingAngles || []).map(a => `<li>${escapeHtml(a)}</li>`).join('');

  const plansHtml = (report.recommendations || []).map((rec, i) => `
    <div class="ai-plan-card ${i === 0 ? 'recommended' : ''}">
      <div class="plan-head">
        <span class="plan-format-badge">${escapeHtml(rec.format || '기획안')}</span>
        ${i === 0 ? '<span style="font-size:11px; font-weight:700; color:var(--accent-gold);">⭐ 추천 1순위</span>' : ''}
      </div>
      <h4 class="plan-title-text">${escapeHtml(rec.title)}</h4>
      <div class="plan-detail-group">
        <span class="plan-label">🎨 썸네일 컨셉</span>
        <div class="plan-content-box">${escapeHtml(rec.thumbnailConcept)}</div>
      </div>
      <div class="plan-detail-group">
        <span class="plan-label">🎬 10초 오프닝 훅</span>
        <div class="plan-content-box">${escapeHtml(rec.hookIntro)}</div>
      </div>
    </div>
  `).join('');

  aiPlansContainer.innerHTML = `
    <div class="ai-summary-banner">
      <h4>📌 떡상 핵심 패턴 요약</h4>
      <p>${escapeHtml(report.summary || '분석 완료')}</p>
      <ul class="ai-hook-list">
        ${hookingList}
      </ul>
    </div>

    ${report.blueOceanInsight ? `
      <div class="ai-summary-banner" style="border-left-color: var(--accent-gold);">
        <h4 style="color: var(--accent-gold);">🌊 빈집(블루오션) 틈새 앵글</h4>
        <p style="color: var(--text-secondary); font-size: 12px;">${escapeHtml(report.blueOceanInsight)}</p>
      </div>
    ` : ''}

    <div style="font-size: 12.5px; font-weight: 700; color: #fff; margin-top: 4px;">
      🎯 즉시 제작 추천 기획안 TOP 3
    </div>
    ${plansHtml}
  `;
}

// --- Compact 2D Scatter Canvas ---
let chartPoints = [];

function renderScatterChart() {
  if (!scatterCanvas || currentVideos.length === 0) return;

  const rect = scatterCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  scatterCanvas.width = rect.width * dpr;
  scatterCanvas.height = rect.height * dpr;

  const ctx = scatterCanvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  const padding = { top: 15, right: 15, bottom: 25, left: 45 };

  ctx.clearRect(0, 0, w, h);

  const plotW = w - padding.left - padding.right;
  const plotH = h - padding.top - padding.bottom;

  const maxSubs = Math.max(...currentVideos.map(v => v.subscriberCount), 1000);
  const maxViews = Math.max(...currentVideos.map(v => v.viewCount), 1000);

  const logMaxX = Math.log10(Math.max(maxSubs, 100000));
  const logMaxY = Math.log10(Math.max(maxViews, 1000000));
  const logMin = 2; // 100

  function getX(subs) {
    const logVal = Math.log10(Math.max(subs, 100));
    return padding.left + ((logVal - logMin) / (logMaxX - logMin)) * plotW;
  }

  function getY(views) {
    const logVal = Math.log10(Math.max(views, 100));
    return h - padding.bottom - ((logVal - logMin) / (logMaxY - logMin)) * plotH;
  }

  // Draw Grid
  ctx.strokeStyle = '#23283b';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#626c85';
  ctx.font = '9px sans-serif';

  // Sub ticks
  [1000, 10000, 100000, 1000000].forEach(tick => {
    if (tick <= Math.pow(10, logMaxX)) {
      const x = getX(tick);
      ctx.beginPath();
      ctx.moveTo(x, padding.top);
      ctx.lineTo(x, h - padding.bottom);
      ctx.stroke();
      ctx.fillText(formatNumber(tick), x - 8, h - padding.bottom + 14);
    }
  });

  // View ticks
  [10000, 100000, 1000000, 10000000].forEach(tick => {
    if (tick <= Math.pow(10, logMaxY)) {
      const y = getY(tick);
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      ctx.fillText(formatNumber(tick), 6, y + 3);
    }
  });

  // 3x & 10x lines
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
  ctx.beginPath();
  ctx.moveTo(getX(1000), getY(3000));
  ctx.lineTo(getX(Math.pow(10, logMaxX)), getY(Math.pow(10, logMaxX) * 3));
  ctx.stroke();

  ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
  ctx.beginPath();
  ctx.moveTo(getX(1000), getY(10000));
  ctx.lineTo(getX(Math.pow(10, logMaxX)), getY(Math.pow(10, logMaxX) * 10));
  ctx.stroke();
  ctx.setLineDash([]);

  // Plot Points
  chartPoints = [];
  currentVideos.forEach(v => {
    const px = getX(v.subscriberCount);
    const py = getY(v.viewCount);

    let color = '#64748b';
    let radius = 4.5;
    if (v.outlierMultiplier >= 10.0) {
      color = '#fbbf24';
      radius = 7;
    } else if (v.outlierMultiplier >= 3.0) {
      color = '#818cf8';
      radius = 5.5;
    }

    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = radius > 5 ? 6 : 0;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    chartPoints.push({ x: px, y: py, radius: radius + 3, video: v });
  });
}

function setupCanvasInteraction() {
  if (!scatterCanvas) return;

  scatterCanvas.addEventListener('mousemove', e => {
    const rect = scatterCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = chartPoints.find(p => {
      const dx = mx - p.x;
      const dy = my - p.y;
      return (dx * dx + dy * dy) <= (p.radius * p.radius);
    });

    if (hit) {
      scatterCanvas.style.cursor = 'pointer';
      const v = hit.video;
      scatterTooltip.style.display = 'block';
      scatterTooltip.style.left = `${Math.min(e.clientX - rect.left + 10, rect.width - 220)}px`;
      scatterTooltip.style.top = `${Math.max(10, e.clientY - rect.top - 20)}px`;
      scatterTooltip.innerHTML = `
        <strong>${escapeHtml(v.title)}</strong><br>
        구독자: ${v.subscriberCountFormatted} · 조회수: ${v.viewCountFormatted}<br>
        떡상 배수: <span style="color:#fbbf24; font-weight:700;">${v.outlierMultiplier}x</span>
      `;
    } else {
      scatterCanvas.style.cursor = 'default';
      scatterTooltip.style.display = 'none';
    }
  });

  scatterCanvas.addEventListener('mouseleave', () => {
    scatterTooltip.style.display = 'none';
  });

  scatterCanvas.addEventListener('click', e => {
    const rect = scatterCanvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const hit = chartPoints.find(p => {
      const dx = mx - p.x;
      const dy = my - p.y;
      return (dx * dx + dy * dy) <= (p.radius * p.radius);
    });

    if (hit) {
      const card = document.getElementById(`card-${hit.video.id}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.style.borderColor = 'var(--accent-gold)';
        card.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.5)';
        setTimeout(() => {
          card.style.borderColor = '';
          card.style.boxShadow = '';
        }, 2500);
      }
    }
  });
}

// --- CSV Export Handler ---
function handleExportCsv() {
  if (!currentVideos || currentVideos.length === 0) {
    alert('내보낼 검색 결과가 없습니다.');
    return;
  }

  const headers = ['비디오ID', '제목', '카테고리', '채널명', '구독자수', '조회수', '떡상배수', '일일조회수증가', '숏폼여부', '재생시간(초)', '업로드일', '태그', 'URL'];
  const rows = currentVideos.map(v => [
    `"${v.id}"`,
    `"${(v.title || '').replace(/"/g, '""')}"`,
    `"${v.categoryName}"`,
    `"${(v.channelTitle || '').replace(/"/g, '""')}"`,
    v.subscriberCount,
    v.viewCount,
    v.outlierMultiplier,
    v.viewsPerDay,
    v.isShorts ? 'Shorts' : 'Long',
    v.durationSec,
    `"${v.publishedAt}"`,
    `"${(v.tags || []).join('; ').replace(/"/g, '""')}"`,
    `"${v.url}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `boks_youtube_${currentKeyword || 'results'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function formatNumber(num) {
  if (!num || num <= 0) return '0';
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)}억`.replace('.0억', '억');
  if (num >= 10000) return `${(num / 10000).toFixed(1)}만`.replace('.0만', '만');
  return num.toLocaleString();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', init);
