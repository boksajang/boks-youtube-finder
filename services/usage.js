// ==========================================================================
// BOKS YOUTUBE FINDER - YouTube API Usage Counter
// 이 PC에서 쓴 YouTube Data API 사용량을 할당량 초기화 기준(태평양 시간 자정)으로 센다.
//   - search.list: 검색 할당량(기본 하루 100회)
//   - 그 밖의 list 호출: 조회 유닛(기본 하루 10,000, 호출당 1)
//   한도는 설정에서 바꿀 수 있다(할당량을 증설받은 경우). 검색 전에 남은 검색 수를 확인해 미리 막는다.
// 같은 API 키를 다른 PC·앱에서도 쓰면 실제 사용량은 이보다 많을 수 있다.
// ==========================================================================

const fs = require('fs');
const path = require('path');

const SEARCH_LIMIT = 100;
const UNIT_LIMIT = 10000;

function quotaDay(now = new Date()) {
  // en-CA → YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// 다음 초기화 시각(태평양 시간 자정, ms). 서머타임 전환일도 맞도록 1분 단위로 날짜가 바뀌는 시점을 찾는다.
function nextResetMs(now = new Date()) {
  const today = quotaDay(now);
  let lo = now.getTime();
  let hi = lo + 26 * 3600 * 1000;
  while (hi - lo > 60000) {
    const mid = Math.floor((lo + hi) / 2);
    if (quotaDay(new Date(mid)) === today) lo = mid; else hi = mid;
  }
  return hi;
}

function createUsageCounter(file, { now = () => new Date(), limits = () => ({ search: SEARCH_LIMIT, units: UNIT_LIMIT }) } = {}) {
  let data = null;

  function load() {
    const day = quotaDay(now());
    if (!data) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (raw && typeof raw.day === 'string') data = { day: raw.day, search: Number(raw.search) || 0, units: Number(raw.units) || 0 };
      } catch { /* 없음/손상 → 새로 시작 */ }
    }
    if (!data || data.day !== day) data = { day, search: 0, units: 0 };
    return data;
  }

  function save() {
    if (!data) return; // 한 번도 읽지 않았으면 기존 파일을 덮어쓰지 않는다
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[usage] 저장 실패:', err.message);
    }
  }

  return {
    record(endpoint) {
      const d = load();
      if (endpoint === 'search') d.search++;
      else d.units++;
    },
    flush: save,
    snapshot() {
      const d = load();
      const l = limits();
      return { day: d.day, search: d.search, searchLimit: l.search, units: d.units, unitLimit: l.units, resetAt: nextResetMs(now()) };
    },
    /** 오늘 남은 검색 수(설정 한도 기준, 0 미만이면 0) */
    remainingSearch() {
      return Math.max(0, limits().search - load().search);
    }
  };
}

module.exports = { createUsageCounter, quotaDay, nextResetMs, SEARCH_LIMIT, UNIT_LIMIT };
