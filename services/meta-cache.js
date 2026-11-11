// ==========================================================================
// BOKS YOUTUBE FINDER - Region / Category Metadata Cache
// 국가 목록(i18nRegions)과 국가별 카테고리(videoCategories)는 거의 바뀌지 않으므로
// 30일 동안 app-data/cache/meta.json 에 보관한다(각 1 유닛).
// API를 쓸 수 없으면(키 없음·오류) 내장 기본 목록을 쓴다.
// ==========================================================================

const fs = require('fs');
const path = require('path');

const TTL_MS = 30 * 86400000;
// API 실패 후 이 시간 동안은 다시 부르지 않고 기본 목록·만료 캐시를 쓴다(키 오류·한도 초과 때 매번 1 유닛씩 쓰지 않도록)
const RETRY_AFTER_MS = 10 * 60000;

// 키가 없거나 API 오류일 때 쓰는 기본 목록
const FALLBACK_REGIONS = [
  ['KR', '대한민국'], ['US', '미국'], ['JP', '일본'], ['GB', '영국'], ['CA', '캐나다'], ['AU', '오스트레일리아'],
  ['DE', '독일'], ['FR', '프랑스'], ['ES', '스페인'], ['IT', '이탈리아'], ['BR', '브라질'], ['MX', '멕시코'],
  ['IN', '인도'], ['ID', '인도네시아'], ['VN', '베트남'], ['TH', '태국'], ['PH', '필리핀'], ['TW', '대만'],
  ['HK', '홍콩'], ['SG', '싱가포르'], ['RU', '러시아'], ['TR', '튀르키예']
].map(([id, name]) => ({ id, name }));

const FALLBACK_CATEGORIES = [
  ['1', '영화/애니메이션'], ['2', '자동차'], ['10', '음악'], ['15', '반려동물/동물'], ['17', '스포츠'],
  ['19', '여행/이벤트'], ['20', '게임'], ['22', '인물/블로그'], ['23', '코미디'], ['24', '엔터테인먼트'],
  ['25', '뉴스/정치'], ['26', '노하우/스타일'], ['27', '교육'], ['28', '과학기술'], ['29', '비영리/사회운동']
].map(([id, name]) => ({ id, name }));

function createMetaCache(file, { now = () => Date.now() } = {}) {
  let store = null;
  const failedAt = new Map(); // slot:key → 마지막 실패 시각(메모리에만)
  const inflight = new Map(); // 같은 목록을 동시에 요청하면 한 번만 부른다

  function load() {
    if (store) return store;
    store = { regions: null, categories: {} };
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.v === 1) {
        if (raw.regions && Array.isArray(raw.regions.d)) store.regions = raw.regions;
        if (raw.categories && typeof raw.categories === 'object') store.categories = raw.categories;
      }
    } catch { /* 없음/손상 → 빈 캐시 */ }
    return store;
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: 1, ...store }), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[meta-cache] 저장 실패:', err.message);
    }
  }

  const fresh = e => !!e && Array.isArray(e.d) && e.d.length > 0 && now() - e.t < TTL_MS;

  /**
   * @param fetcher API 호출 함수(키가 없으면 null)
   * @returns {{ items, source: 'cache'|'api'|'fallback', error? }}
   */
  function get(slot, key, fetcher, fallback) {
    const id = `${slot}:${key || ''}`;
    if (inflight.has(id)) return inflight.get(id);
    const p = resolve(slot, key, fetcher, fallback, id).finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  async function resolve(slot, key, fetcher, fallback, id) {
    const s = load();
    const entry = key ? s[slot][key] : s[slot];
    if (fresh(entry)) return { items: entry.d, source: 'cache' };
    const recentFail = failedAt.has(id) && now() - failedAt.get(id) < RETRY_AFTER_MS;
    if (fetcher && !recentFail) {
      try {
        const d = await fetcher();
        if (Array.isArray(d) && d.length) {
          const e = { t: now(), d };
          if (key) s[slot][key] = e; else s[slot] = e;
          failedAt.delete(id);
          save();
          return { items: d, source: 'api' };
        }
        failedAt.set(id, now()); // 빈 목록도 잠시 다시 부르지 않는다
      } catch (err) {
        failedAt.set(id, now());
        // 만료된 캐시라도 있으면 그걸 쓴다
        if (entry && Array.isArray(entry.d) && entry.d.length) return { items: entry.d, source: 'cache', error: err.message };
        return { items: fallback, source: 'fallback', error: err.message };
      }
    }
    if (entry && Array.isArray(entry.d) && entry.d.length) return { items: entry.d, source: 'cache' };
    return { items: fallback, source: 'fallback' };
  }

  return {
    regions: fetcher => get('regions', null, fetcher, FALLBACK_REGIONS),
    categories: (region, fetcher) => get('categories', region, fetcher, FALLBACK_CATEGORIES),
    /** 키를 바꿨을 때 등: 실패 기록만 지워 바로 다시 받을 수 있게 한다 */
    resetFailures() { failedAt.clear(); },
    clear() {
      store = { regions: null, categories: {} };
      failedAt.clear();
      try { fs.rmSync(file, { force: true }); } catch { /* 무시 */ }
    }
  };
}

module.exports = { createMetaCache };
