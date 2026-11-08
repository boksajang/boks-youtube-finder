// ==========================================================================
// BOKS YOUTUBE FINDER - Channel Upload Stats Cache
// 채널별 최근 업로드 통계(평소 조회수 계산용)를 24시간 동안 파일에 보관해
// 같은 채널을 다시 만나도 API 유닛을 쓰지 않게 한다.
// ==========================================================================

const fs = require('fs');
const path = require('path');

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CHANNELS = 3000;

/**
 * 파일 기반 캐시. entry = { t: 저장 시각(ms), u: [[videoId, views|null, durationSec, publishedAtMs], ...] }
 * 파일이 없거나 깨져 있으면 빈 캐시로 시작한다(캐시는 언제든 버려도 되는 데이터).
 */
// 구조가 어긋난 항목(수동 편집·이전 형식)은 버린다. 원소 = [id, views|null, durationSec, publishedAtMs|null]
function isValidEntry(e) {
  return !!e && Number.isFinite(e.t) && Array.isArray(e.u) && e.u.every(x =>
    Array.isArray(x) && x.length === 4 && typeof x[0] === 'string' &&
    (x[1] === null || Number.isFinite(x[1])) && Number.isFinite(x[2]) && (x[3] === null || Number.isFinite(x[3])));
}

function createChannelCache(file, { ttlMs = TTL_MS, now = () => Date.now() } = {}) {
  let store = null;
  let dirty = false;

  function load() {
    if (store) return store;
    store = {};
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.v === 1 && raw.channels && typeof raw.channels === 'object') {
        const t = now();
        for (const [id, e] of Object.entries(raw.channels)) {
          if (isValidEntry(e) && t - e.t < ttlMs) store[id] = e;
        }
      }
    } catch {
      // 없음/손상 → 빈 캐시
    }
    return store;
  }

  return {
    /** @returns {{t:number,u:Array}|null} t = 수집 시각(ms) */
    get(channelId) {
      const e = load()[channelId];
      if (!e) return null;
      if (now() - e.t >= ttlMs) {
        delete store[channelId];
        dirty = true;
        return null;
      }
      return e;
    },
    set(channelId, uploads) {
      load()[channelId] = { t: now(), u: uploads };
      dirty = true;
    },
    flush() {
      if (!dirty || !store) return;
      // 오래된 순으로 잘라 파일 크기를 제한
      const entries = Object.entries(store);
      if (entries.length > MAX_CHANNELS) {
        entries.sort((a, b) => b[1].t - a[1].t);
        store = Object.fromEntries(entries.slice(0, MAX_CHANNELS));
      }
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify({ v: 1, channels: store }), 'utf8');
        fs.renameSync(tmp, file);
        dirty = false;
      } catch (err) {
        console.error('[channel-cache] 저장 실패:', err.message);
      }
    }
  };
}

module.exports = { createChannelCache, TTL_MS };
