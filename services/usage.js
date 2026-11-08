// ==========================================================================
// BOKS YOUTUBE FINDER - YouTube API Usage Counter
// 이 PC에서 쓴 YouTube Data API 사용량을 할당량 초기화 기준(태평양 시간 자정)으로 센다.
//   - search.list: 검색 할당량(기본 하루 100회)
//   - 그 밖의 list 호출: 조회 유닛(기본 하루 10,000, 호출당 1)
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

function createUsageCounter(file, { now = () => new Date() } = {}) {
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
      return { day: d.day, search: d.search, searchLimit: SEARCH_LIMIT, units: d.units, unitLimit: UNIT_LIMIT };
    }
  };
}

module.exports = { createUsageCounter, quotaDay, SEARCH_LIMIT, UNIT_LIMIT };
