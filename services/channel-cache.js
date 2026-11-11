// ==========================================================================
// BOKS YOUTUBE FINDER - Channel Upload Stats Cache
// 채널별 최근 업로드 통계(평소 조회수 계산용)를 정해진 시간(기본 24시간, 설정에서 변경) 동안 파일에 보관해
// 같은 채널을 다시 만나도 API 유닛을 쓰지 않게 한다.
// ==========================================================================

const fs = require('fs');
const path = require('path');

const TTL_MS = 24 * 60 * 60 * 1000;
// 설정에서 고를 수 있는 가장 긴 유지 시간. 파일에는 이만큼 보관해 두고 판정은 현재 유지 시간으로 한다
const MAX_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
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

function createChannelCache(file, { ttlMs: initialTtl = TTL_MS, now = () => Date.now() } = {}) {
  let ttlMs = initialTtl;
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
          if (isValidEntry(e) && t - e.t < Math.max(ttlMs, MAX_KEEP_MS)) store[id] = e;
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
      if (now() - e.t >= ttlMs) return null; // 지금 유지 시간으로는 만료(유지 시간을 늘리면 다시 쓸 수 있도록 지우지는 않음)
      return e;
    },
    set(channelId, uploads) {
      load()[channelId] = { t: now(), u: uploads };
      dirty = true;
    },
    /** 유지 시간 변경(설정 저장 시). 이미 저장된 항목도 새 기준으로 판정한다(늘리면 다시 쓸 수 있음) */
    setTtl(ms) {
      if (Number.isFinite(ms) && ms > 0) ttlMs = ms;
    },
    /** 설정 화면 표시용: 유효 항목 수·가장 오래된 수집 시각·파일 크기 */
    stats() {
      const t = now();
      const valid = Object.values(load()).filter(e => t - e.t < ttlMs);
      let bytes = 0;
      try { bytes = fs.statSync(file).size; } catch { /* 파일 없음 */ }
      return { channels: valid.length, oldest: valid.length ? Math.min(...valid.map(e => e.t)) : null, bytes, ttlMs };
    },
    clear() {
      store = {};
      dirty = false;
      try { fs.rmSync(file, { force: true }); } catch (err) { console.error('[channel-cache] 삭제 실패:', err.message); }
    },
    flush() {
      if (!dirty || !store) return;
      // 최대 보관 기간이 지난 항목을 버리고, 오래된 순으로 잘라 파일 크기를 제한
      const keep = Math.max(ttlMs, MAX_KEEP_MS);
      const t = now();
      const entries = Object.entries(store).filter(([, e]) => t - e.t < keep);
      store = Object.fromEntries(entries);
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

module.exports = { createChannelCache };
