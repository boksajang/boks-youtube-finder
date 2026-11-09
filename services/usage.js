// ==========================================================================
// BOKS YOUTUBE FINDER - YouTube API Usage Counter
// 이 PC에서 쓴 YouTube Data API 사용량을 할당량 초기화 기준(태평양 시간 자정)으로 센다.
//   - search.list: 검색 할당량(기본 하루 100회)
//   - 그 밖의 list 호출: 조회 유닛(기본 하루 10,000, 호출당 1)
//   한도는 설정에서 바꿀 수 있다(할당량을 증설받은 경우). 검색 전에 남은 검색 수를 확인해 미리 막는다.
// 할당량은 키(정확히는 키가 속한 Google Cloud 프로젝트)마다 따로라서 키별로 센다. 키를 바꾸면 그 키의 사용량을 보여 주고
// 이전 키로 돌아가면 그 키의 오늘 사용량이 다시 보인다. 파일에는 키 대신 해시 앞부분만 남긴다.
// 같은 API 키를 다른 PC·앱에서도 쓰면 실제 사용량은 이보다 많을 수 있다.
// ==========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

/** 키를 파일에 남기지 않도록 해시 앞부분만 쓴다. 키가 없으면 'none' */
function keyId(key) {
  const k = String(key || '').trim();
  return k ? crypto.createHash('sha256').update(k).digest('hex').slice(0, 16) : 'none';
}

const count = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);

function createUsageCounter(file, { now = () => new Date(), limits = () => ({ search: SEARCH_LIMIT, units: UNIT_LIMIT }), currentKey = () => '' } = {}) {
  let data = null;

  function load() {
    const day = quotaDay(now());
    if (!data) {
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (raw && typeof raw.day === 'string') {
          const keys = {};
          if (raw.keys && typeof raw.keys === 'object') {
            for (const [id, b] of Object.entries(raw.keys)) {
              if (/^[0-9a-f]{16}$|^none$|^legacy$/.test(id) && b) keys[id] = { search: count(b.search), units: count(b.units) };
            }
          } else if (raw.search || raw.units) {
            // 키별로 세기 전 형식: 그날 쓰던 키는 대개 지금 키이므로 현재 키로 옮긴다(미리 막기가 업데이트 당일에도 동작하도록).
            // 현재 키를 아직 알 수 없으면 legacy 로 두었다가 처음 알 수 있을 때 옮긴다.
            keys.legacy = { search: count(raw.search), units: count(raw.units) };
          }
          data = { day: raw.day, keys };
        }
      } catch { /* 없음/손상 → 새로 시작 */ }
    }
    if (!data || data.day !== day) data = { day, keys: {} };
    if (data.keys.legacy) {
      let id = null;
      try { id = keyId(currentKey()); } catch { /* 설정을 아직 읽을 수 없음 → 다음에 다시 */ }
      if (id && id !== 'none') {
        const b = data.keys[id] || (data.keys[id] = { search: 0, units: 0 });
        b.search += data.keys.legacy.search;
        b.units += data.keys.legacy.units;
        delete data.keys.legacy;
      }
    }
    return data;
  }

  function bucket(key, create) {
    const d = load();
    let k = key;
    if (k === undefined) { try { k = currentKey(); } catch { k = ''; } }
    const id = keyId(k);
    if (!d.keys[id]) {
      if (!create) return { search: 0, units: 0 };
      d.keys[id] = { search: 0, units: 0 };
    }
    return d.keys[id];
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
    /** 호출 1회 기록. key 를 주지 않으면 현재 설정의 키로 센다(키 확인처럼 저장 전 키로 호출할 때는 그 키를 넘긴다) */
    record(endpoint, key) {
      const b = bucket(key, true);
      if (endpoint === 'search') b.search++;
      else b.units++;
    },
    flush: save,
    /** 현재 키(또는 주어진 키)의 오늘 사용량 */
    snapshot(key) {
      const d = load();
      const b = bucket(key, false);
      const l = limits();
      return { day: d.day, search: b.search, searchLimit: l.search, units: b.units, unitLimit: l.units, resetAt: nextResetMs(now()) };
    },
    /** 오늘 남은 검색 수(현재 키, 설정 한도 기준, 0 미만이면 0) */
    remainingSearch(key) {
      return Math.max(0, limits().search - bucket(key, false).search);
    }
  };
}

module.exports = { createUsageCounter, quotaDay, nextResetMs, keyId, SEARCH_LIMIT, UNIT_LIMIT };
