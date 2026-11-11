// ==========================================================================
// BOKS YOUTUBE FINDER - Search Result Cache
// 같은 조건(키워드·국가·언어·주제·기간·형식·검색 기준·인기 차트 여부·종교 영상 포함)으로 다시 검색하면
// 설정한 시간 안에는 저장된 결과를 그대로 돌려준다. 할당량이 들지 않는다.
// 앱을 다시 켜도 쓸 수 있도록 app-data/cache/results.json 에 최근 몇 개만 보관한다.
// ==========================================================================

const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 12;
const MAX_KEEP_MS = 6 * 3600 * 1000; // 설정에서 고를 수 있는 가장 긴 재사용 시간

function createResultCache(file, { now = () => Date.now(), max = MAX_ENTRIES } = {}) {
  let store = null; // { [key]: { t, data } }

  function load() {
    if (store) return store;
    store = {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.v === 1 && raw.entries && typeof raw.entries === 'object') {
        const t = now();
        for (const [k, e] of Object.entries(raw.entries)) {
          if (e && Number.isFinite(e.t) && t - e.t < MAX_KEEP_MS && e.data && Array.isArray(e.data.videos)) store[k] = e;
        }
      }
    } catch { /* 없음/손상 → 빈 캐시 */ }
    return store;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, entries: store }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[result-cache] 저장 실패:', err.message);
    }
  }

  return {
    /** maxAgeMs 안에 저장된 결과({ t, data }) 또는 null */
    get(key, maxAgeMs) {
      if (!(maxAgeMs > 0)) return null;
      const e = load()[key];
      if (!e || now() - e.t >= Math.min(maxAgeMs, MAX_KEEP_MS)) return null;
      return e;
    },
    set(key, data) {
      const s = load();
      const t = now();
      s[key] = { t, data };
      // 오래된 것·최대 개수를 넘는 것을 버린다
      const keep = Object.entries(s)
        .filter(([, e]) => t - e.t < MAX_KEEP_MS)
        .sort((a, b) => b[1].t - a[1].t)
        .slice(0, max);
      store = Object.fromEntries(keep);
      save();
    },
    stats() {
      return { results: Object.keys(load()).length };
    },
    clear() {
      store = {};
      try { fs.rmSync(file, { force: true }); } catch { /* 무시 */ }
    }
  };
}

/** 검색 조건 → 캐시 키(값 순서를 고정해 같은 조건이면 같은 문자열) */
function resultKey(p) {
  return JSON.stringify([
    p.source || 'search', p.query || '', p.region || '', p.language || '', p.langOnly !== false,
    p.videoCategoryId || '0', p.source === 'chart' ? '' : (p.publishedPeriod || ''),
    p.source === 'chart' || p.publishedPeriod !== 'custom' ? '' : `${p.customFrom || ''}~${p.customTo || ''}`,
    p.format || 'all', p.source === 'chart' ? '' : (p.order || ''),
    p.includeReligion === true
  ]);
}

module.exports = { createResultCache, resultKey };
