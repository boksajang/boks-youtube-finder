// ==========================================================================
// BOKS YOUTUBE FINDER - YouTube Data API v3 Service & Market Analytics
// ==========================================================================

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const REQUEST_TIMEOUT_MS = 15000;

// YouTube Shorts 최대 길이(2024-10 이후 3분). API에 쇼츠 여부 필드가 없어 길이로 추정한다.
const SHORTS_MAX_SEC = 180;
const SMALL_CHANNEL_MAX_SUBS = 20000;
const OUTLIER_RATIO = 3.0;
// 떡상 판정 최소 조회수: 구독자 1명·조회수 104회 같은 소규모 노이즈가 "104배"로 잡히는 것을 막는다
const MIN_OUTLIER_VIEWS = 10000;

// 채널 평소 조회수(메인 지표) = 같은 형식(쇼츠/롱폼) 최근 영상 조회수의 중앙값
const BASELINE_FETCH_PER_CHANNEL = 30;  // 업로드 목록에서 가져올 최근 영상 수
const BASELINE_SAMPLE_MAX = 15;         // 중앙값 계산에 쓰는 최근 영상 수
const BASELINE_SAMPLE_MIN = 5;          // 이보다 적으면 구독자 대비 배수로 대신(추정)
const BASELINE_MIN_AGE_MS = 48 * 3600 * 1000; // 막 올라와 조회수가 쌓이는 중인 영상 제외
const BASELINE_FLOOR = 1000;            // 평소 조회수가 아주 낮은 채널의 배수 과장을 막는 하한
const BASELINE_CONCURRENCY = 8;

const CATEGORY_NAMES = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '반려동물', '17': '스포츠',
  '19': '여행/이벤트', '20': '게임', '22': '인물/블로그', '23': '코미디', '24': '엔터테인먼트',
  '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육', '28': '과학기술', '29': '비영리/사회운동'
};

class YouTubeApiError extends Error {
  constructor(message, code, detail = '') {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

// --- HTTP ---

function explainApiError(status, body) {
  const err = body && body.error ? body.error : {};
  const reason = (err.errors && err.errors[0] && err.errors[0].reason) || err.status || '';
  const raw = err.message || '';

  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
    return new YouTubeApiError('오늘 YouTube API 사용 한도를 모두 썼습니다(기본 한도: 검색 하루 100회, 조회 하루 10,000 유닛). 매일 오후 4~5시(한국 시간)에 초기화됩니다.', 'QUOTA_EXCEEDED', raw);
  }
  if (reason === 'keyInvalid' || /API key not valid/i.test(raw)) {
    return new YouTubeApiError('YouTube API 키가 올바르지 않습니다. [설정]에서 키를 다시 확인해 주세요.', 'KEY_INVALID', raw);
  }
  if (reason === 'accessNotConfigured' || /has not been used|is disabled/i.test(raw)) {
    return new YouTubeApiError('Google Cloud 프로젝트에서 "YouTube Data API v3"가 사용 설정되지 않았습니다. 콘솔에서 사용 설정 후 다시 시도해 주세요.', 'API_DISABLED', raw);
  }
  if (reason === 'ipRefererBlocked' || reason === 'forbidden' || status === 403) {
    return new YouTubeApiError('API 키 사용 제한(IP·리퍼러·API 제한) 때문에 요청이 거부되었습니다. 키의 애플리케이션 제한을 확인해 주세요.', 'FORBIDDEN', raw);
  }
  return new YouTubeApiError(`YouTube API 요청에 실패했습니다 (HTTP ${status}).`, 'API_ERROR', raw);
}

// 사용량 집계 훅(main 에서 주입). 요청을 보낸 시점에 센다(실패한 요청도 할당량을 쓴다).
let usageRecorder = null;
function setUsageRecorder(fn) {
  usageRecorder = typeof fn === 'function' ? fn : null;
}

async function apiGet(endpoint, params, apiKey) {
  if (usageRecorder) usageRecorder(endpoint);
  const qs = new URLSearchParams({ ...params, key: apiKey });
  let res;
  try {
    res = await fetch(`${YOUTUBE_API_BASE}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new YouTubeApiError('YouTube 서버 응답이 15초 안에 오지 않았습니다. 잠시 후 다시 시도해 주세요.', 'TIMEOUT');
    throw new YouTubeApiError('YouTube 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.', 'NETWORK', err.message);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = explainApiError(res.status, body);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// --- Search ---

/**
 * 키워드로 영상을 검색하고 채널 구독자·영상 통계를 합쳐 떡상 지표를 계산한다.
 * search.list 의 제목은 HTML 이스케이프되어 오므로 videos.list 의 원문 snippet 을 사용한다.
 */
async function searchYouTube({ apiKey, query, maxResults = 50, regionCode = 'KR', relevanceLanguage = 'ko', videoCategoryId = '0', publishedPeriod = 'all', format = 'all', channelCache = null }) {
  if (!apiKey) {
    throw new YouTubeApiError('YouTube Data API 키가 없습니다. [설정]에서 API 키를 먼저 등록해 주세요.', 'NO_API_KEY');
  }

  const params = { part: 'snippet', q: query, type: 'video', maxResults: String(Math.min(50, Math.max(1, maxResults))) };
  if (regionCode && regionCode !== 'ALL') params.regionCode = regionCode;
  if (relevanceLanguage && relevanceLanguage !== 'ALL') params.relevanceLanguage = relevanceLanguage;
  if (videoCategoryId && videoCategoryId !== '0') params.videoCategoryId = videoCategoryId;
  const publishedAfter = calculatePublishedAfter(publishedPeriod);
  if (publishedAfter) params.publishedAfter = publishedAfter;

  // 형식은 검색 단계에서 나눈다. 한 번에 섞어 검색하면 쇼츠가 상위를 차지해 롱폼이 몇 개밖에 남지 않는다.
  //   short = 4분 미만, medium = 4~20분, long = 20분 초과 (search.list videoDuration)
  //   쇼츠만 볼 때는 한 버킷뿐이라 다음 페이지까지 받아 표본을 늘린다.
  const fmt = SEARCH_PLAN[format] ? format : 'all';
  const pages = await Promise.all(SEARCH_PLAN[fmt].map(videoDuration => apiGet('search', { ...params, videoDuration }, apiKey)));
  if (fmt === 'shorts' && pages[0] && pages[0].nextPageToken) {
    pages.push(await apiGet('search', { ...params, videoDuration: 'short', pageToken: pages[0].nextPageToken }, apiKey));
  }
  // 버킷별 결과를 번갈아 합쳐 관련도 상위가 고르게 섞이도록 한다
  const items = [];
  const seen = new Set();
  const lists = pages.map(p => (p.items || []).filter(it => it.id && it.id.videoId));
  for (let i = 0; i < Math.max(0, ...lists.map(l => l.length)); i++) {
    for (const l of lists) {
      const it = l[i];
      if (it && !seen.has(it.id.videoId)) { seen.add(it.id.videoId); items.push(it); }
    }
  }
  const searchCalls = pages.length;
  const excluded = { live: 0, format: 0, spam: 0, language: 0, offtopic: 0 };
  if (items.length === 0) return { videos: [], excluded, baseline: emptyBaselineStats(), format: fmt, searchCalls };

  const videoIds = [...new Set(items.map(it => it.id.videoId))];
  const videoMap = await fetchVideoDetails(videoIds, apiKey);
  const searchSnippet = Object.fromEntries(items.map(it => [it.id.videoId, it.snippet || {}]));

  // 1차 거르기: 라이브·형식 불일치·해시태그 도배·한국어 아님·키워드 무관.
  // 채널 조회 전에 걸러 채널·평소 조회수 수집 유닛을 아낀다.
  const kept = [];
  for (const id of videoIds) {
    const v = videoMap[id];
    if (!v) continue; // 삭제·비공개 전환된 영상
    // videos.list 값이 비어 있으면 search.list 값으로 보완(제목은 이스케이프 해제)
    const fb = searchSnippet[id] || {};
    v.channelId = v.channelId || fb.channelId || '';
    v.channelTitle = v.channelTitle || decodeEntities(fb.channelTitle);
    v.title = v.title || decodeEntities(fb.title);
    v.publishedAt = v.publishedAt || fb.publishedAt;
    if (!v.thumbnails || !Object.keys(v.thumbnails).length) v.thumbnails = fb.thumbnails || {};
    if (v.liveBroadcastContent === 'live' || v.liveBroadcastContent === 'upcoming') { excluded.live++; continue; }
    // 쇼츠는 최대 3분이므로 길이로만 판정한다(설명란 #shorts 때문에 롱폼을 쇼츠 표본과 비교하지 않도록)
    v.isShorts = v.durationSec > 0 && v.durationSec <= SHORTS_MAX_SEC;
    // 'short' 버킷에는 3~4분 롱폼도 섞여 온다 → 선택한 형식과 다르면 제외
    if ((fmt === 'shorts' && !v.isShorts) || (fmt === 'long' && v.isShorts)) { excluded.format++; continue; }
    const reason = relevanceIssue(v, query, relevanceLanguage);
    if (reason) { excluded[reason]++; continue; }
    kept.push(id);
  }

  const channelIds = [...new Set(kept.map(id => videoMap[id].channelId).filter(Boolean))];
  const channelMap = await fetchChannelDetails(channelIds, apiKey);
  // 채널 평소 조회수 수집은 실패해도 검색 전체를 실패시키지 않는다(구독자 대비로 대신)
  const { uploadsByChannel, stats: baseline } = await fetchChannelUploads(channelMap, apiKey, channelCache);

  const now = Date.now();
  const videos = [];

  for (const id of kept) {
    const v = videoMap[id];
    const ch = channelMap[v.channelId] || { subscriberCount: null };

    const viewCount = v.viewCount;
    const subscriberCount = ch.subscriberCount; // null = 비공개/알 수 없음
    const subsRatio = subscriberCount && subscriberCount > 0 ? round1(viewCount / subscriberCount) : null;

    const publishedAt = new Date(v.publishedAt);
    const ageDays = Math.max(1, (now - publishedAt.getTime()) / 86400000);
    const viewsPerDay = Number.isFinite(ageDays) ? Math.round(viewCount / ageDays) : 0;
    const isShorts = v.isShorts;

    // 메인 지표: 같은 채널·같은 형식의 최근 영상 중앙값 대비 배수
    // 업로드 통계가 캐시에서 왔으면 '48시간 경과' 판정도 그 수집 시각 기준으로 한다
    const chUploads = uploadsByChannel[v.channelId];
    const base = chUploads ? computeChannelBaseline(chUploads.uploads, { videoId: id, isShorts, now: chUploads.asOf }) : null;
    const baselineRatio = base ? round1(viewCount / Math.max(base.median, BASELINE_FLOOR)) : null;
    const scoreBasis = baselineRatio !== null ? 'baseline' : subsRatio !== null ? 'subs' : null;
    const score = baselineRatio !== null ? baselineRatio : subsRatio;

    videos.push({
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: v.title,
      channelId: v.channelId,
      channelTitle: v.channelTitle,
      categoryId: v.categoryId,
      categoryName: CATEGORY_NAMES[v.categoryId] || '기타',
      publishedAt: v.publishedAt,
      publishedAtRelative: formatRelativeTime(publishedAt, now),
      thumbnail: pickThumbnail(v.thumbnails),
      durationSec: v.durationSec,
      durationFormatted: formatDuration(v.durationSec),
      isShorts,
      viewCount,
      viewCountFormatted: formatNumber(viewCount),
      subscriberCount,
      subscriberCountFormatted: subscriberCount === null ? '비공개' : formatNumber(subscriberCount),
      likeCount: v.likeCount,
      commentCount: v.commentCount,
      // 반응도(%): 좋아요·댓글이 비공개면 0으로 오므로 조회수가 있을 때만 계산
      likeRate: viewCount > 0 && v.likeCount > 0 ? Math.round((v.likeCount / viewCount) * 10000) / 100 : null,
      commentRate: viewCount > 0 && v.commentCount > 0 ? Math.round((v.commentCount / viewCount) * 100000) / 1000 : null,
      // 메인 점수(채널 평소 대비, 계산 불가 시 구독자 대비로 대신)
      score,
      scoreFormatted: formatMultiplier(score),
      scoreBasis, // 'baseline' | 'subs'(추정) | null
      channelBaseline: base ? base.median : null,
      channelBaselineFormatted: base ? formatNumber(base.median) : '-',
      baselineSampleSize: base ? base.sampleSize : 0,
      // 보조 지표(구독자 대비)
      subsRatio,
      subsRatioFormatted: formatMultiplier(subsRatio),
      // 떡상 판정 대상: 점수를 계산할 수 있고 조회수가 하한선 이상
      qualifies: score !== null && viewCount >= MIN_OUTLIER_VIEWS,
      viewsPerDay,
      viewsPerDayFormatted: formatNumber(viewsPerDay),
      tags: v.tags
    });
  }

  return { videos, excluded, baseline, format: fmt, searchCalls };
}

// 형식별 search.list 호출 계획(검색 1회 = 검색 할당량 1)
const SEARCH_PLAN = {
  all: ['short', 'medium', 'long'],
  long: ['medium', 'long'],
  shorts: ['short']
};

// --- 관련성 거르기 ---
// YouTube 검색은 제목·설명에 키워드를 해시태그로 도배한 해외 스팸 쇼츠까지 돌려준다.
// 아래 세 가지를 통과한 영상만 분석에 넣는다.

const HASHTAG_RE = /#[^\s#]+/gu;
const HANGUL_RE = /[ㄱ-ㆎ가-힣]/gu;
const hangulCount = s => (String(s || '').match(HANGUL_RE) || []).length;

function stripHashtags(s) {
  return String(s || '').replace(HASHTAG_RE, ' ');
}

function compact(s) {
  return String(s || '').toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** @returns {null|'spam'|'language'|'offtopic'} */
function relevanceIssue(v, query, relevanceLanguage = 'ko') {
  // 분해형(NFD) 한글도 같은 글자로 보도록 먼저 정규화
  const title = String(v.title || '').normalize('NFC');
  v = { ...v, channelTitle: String(v.channelTitle || '').normalize('NFC'), description: String(v.description || '').normalize('NFC') };
  query = String(query || '').normalize('NFC');
  // #shorts·#쇼츠 같은 형식 표시 해시태그는 도배로 세지 않는다
  const tagsInTitle = (title.match(HASHTAG_RE) || []).filter(t => !/^#(shorts?|쇼츠|숏츠)$/i.test(t));
  const core = stripHashtags(title);
  const coreLetters = (core.match(/[\p{L}\p{N}]/gu) || []).length;
  // 1) 해시태그 도배: 제목에 해시태그 5개 이상, 또는 해시태그를 빼면 글자가 거의 없는 제목
  if (tagsInTitle.length >= 5 || (tagsInTitle.length >= 2 && coreLetters < 3)) return 'spam';

  // 2) 언어: 한국어 키워드로 찾았는데 제목(해시태그 제외)·채널명에 한글이 없고
  //    설명 앞부분에도 한글 문장이 없으면 해외 영상(설명에 키워드만 끼워 넣은 경우 포함)
  if (relevanceLanguage === 'ko' && hangulCount(query) > 0) {
    const head = hangulCount(core + ' ' + (v.channelTitle || ''));
    const desc = hangulCount(stripHashtags(String(v.description || '').slice(0, 400)));
    if (head < 2 && desc < 10) return 'language';
  }

  // 3) 키워드: 제목·태그·설명 어디에도 키워드(띄어쓰기 무시)나 키워드의 모든 단어가 없으면 무관한 영상
  const hay = compact(title + ' ' + (v.tags || []).join(' ') + ' ' + v.description);
  const q = compact(query);
  if (q && hay.includes(q)) return null;
  const words = String(query).split(/\s+/).map(compact).filter(w => w.length > 0);
  if (words.length > 1 && words.every(w => hay.includes(w))) return null;
  return q ? 'offtopic' : null;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function emptyBaselineStats() {
  return { channels: 0, cached: 0, fetched: 0, failed: 0, quotaHit: false };
}

/**
 * 채널 평소 조회수: 후보 영상 자신·48시간 미만·길이 0(라이브/예정) 영상을 빼고
 * 같은 형식(쇼츠 ≤180초 / 롱폼)의 최근 최대 15개 조회수 중앙값. 표본이 5개 미만이면 null.
 */
function computeChannelBaseline(uploads, { videoId, isShorts, now = Date.now() }) {
  if (!Array.isArray(uploads) || uploads.length === 0) return null;
  const sample = uploads
    .filter(u => Array.isArray(u) && u.length === 4)
    .filter(([id, views, dur, pub]) =>
      id !== videoId &&
      typeof views === 'number' &&
      dur > 0 &&
      (dur <= SHORTS_MAX_SEC) === isShorts &&
      Number.isFinite(pub) && now - pub >= BASELINE_MIN_AGE_MS)
    .sort((a, b) => b[3] - a[3])
    .slice(0, BASELINE_SAMPLE_MAX)
    .map(u => u[1])
    .sort((a, b) => a - b);
  if (sample.length < BASELINE_SAMPLE_MIN) return null;
  const mid = Math.floor(sample.length / 2);
  const median = sample.length % 2 ? sample[mid] : Math.round((sample[mid - 1] + sample[mid]) / 2);
  return { median, sampleSize: sample.length };
}

/**
 * 채널별 최근 업로드 통계 수집: uploads 재생목록(playlistItems) → videos.list(통계·길이).
 * 24시간 캐시를 먼저 쓰고, 쿼터 초과 시 나머지 채널은 건너뛴다.
 * 반환: uploadsByChannel[channelId] = { asOf: 수집 시각(ms), uploads: [[videoId, views|null, durationSec, publishedAtMs], ...] }
 */
async function fetchChannelUploads(channelMap, apiKey, cache) {
  const stats = emptyBaselineStats();
  const uploadsByChannel = {};
  const pending = [];
  for (const [cid, ch] of Object.entries(channelMap)) {
    stats.channels++;
    const hit = cache ? cache.get(cid) : null;
    if (hit) {
      uploadsByChannel[cid] = { asOf: hit.t, uploads: hit.u };
      stats.cached++;
    } else if (ch.uploadsPlaylistId) {
      pending.push([cid, ch.uploadsPlaylistId]);
    } else {
      stats.failed++;
    }
  }
  if (pending.length === 0) return { uploadsByChannel, stats };

  const onError = (err, cid) => {
    if (err.code === 'QUOTA_EXCEEDED') stats.quotaHit = true;
    else console.warn(`[youtube] 채널 업로드 수집 실패 ${cid}: ${err.code} ${err.detail || err.message}`);
  };

  // 1) 채널별 최근 업로드 영상 id
  const lists = await mapLimit(pending, BASELINE_CONCURRENCY, async ([cid, playlistId]) => {
    if (stats.quotaHit) return null;
    try {
      const data = await apiGet('playlistItems', { part: 'contentDetails', playlistId, maxResults: String(BASELINE_FETCH_PER_CHANNEL) }, apiKey);
      return (data.items || []).map(it => it.contentDetails && it.contentDetails.videoId).filter(Boolean);
    } catch (err) {
      // 업로드 재생목록이 없는 채널(404)은 빈 목록으로 확정해 캐시한다
      if (err.status === 404) return [];
      onError(err, cid);
      return null;
    }
  });

  // 2) 모은 영상의 조회수·길이·게시일
  const allIds = [...new Set(lists.filter(Boolean).flat())];
  const statMap = {};
  const failedIds = new Set();
  await mapLimit(chunkArray(allIds, 50), 4, async (chunk) => {
    if (stats.quotaHit) { chunk.forEach(id => failedIds.add(id)); return; }
    try {
      const data = await apiGet('videos', { part: 'snippet,contentDetails,statistics', fields: 'items(id,snippet/publishedAt,contentDetails/duration,statistics/viewCount)', id: chunk.join(',') }, apiKey);
      for (const it of data.items || []) {
        const vc = it.statistics && it.statistics.viewCount;
        statMap[it.id] = [
          it.id,
          vc === undefined ? null : toInt(vc),
          parseIsoDuration(it.contentDetails && it.contentDetails.duration),
          Date.parse(it.snippet && it.snippet.publishedAt)
        ];
      }
    } catch (err) {
      chunk.forEach(id => failedIds.add(id));
      onError(err, 'videos');
    }
  });

  const asOf = Date.now();
  pending.forEach(([cid], i) => {
    const ids = lists[i];
    if (!ids) { stats.failed++; return; }
    const uploads = ids.map(id => statMap[id]).filter(Boolean);
    uploadsByChannel[cid] = { asOf, uploads };
    // 통계 일부가 빠진 채널은 있는 만큼만 쓰고 캐시하지 않는다(다음 검색에서 다시 수집)
    if (ids.some(id => failedIds.has(id))) { stats.failed++; return; }
    stats.fetched++;
    if (cache) cache.set(cid, uploads);
  });
  if (cache) cache.flush();
  return { uploadsByChannel, stats };
}

async function fetchVideoDetails(videoIds, apiKey) {
  const result = {};
  for (const chunk of chunkArray(videoIds, 50)) {
    const data = await apiGet('videos', { part: 'snippet,contentDetails,statistics', id: chunk.join(',') }, apiKey);
    for (const v of data.items || []) {
      const s = v.snippet || {};
      result[v.id] = {
        title: s.title || '',
        description: s.description || '',
        channelId: s.channelId || '',
        channelTitle: s.channelTitle || '',
        categoryId: s.categoryId || '0',
        publishedAt: s.publishedAt,
        thumbnails: s.thumbnails || {},
        liveBroadcastContent: s.liveBroadcastContent || 'none',
        tags: Array.isArray(s.tags) ? s.tags : [],
        durationSec: parseIsoDuration(v.contentDetails && v.contentDetails.duration),
        viewCount: toInt(v.statistics && v.statistics.viewCount),
        likeCount: toInt(v.statistics && v.statistics.likeCount),
        commentCount: toInt(v.statistics && v.statistics.commentCount)
      };
    }
  }
  return result;
}

async function fetchChannelDetails(channelIds, apiKey) {
  const result = {};
  for (const chunk of chunkArray(channelIds, 50)) {
    const data = await apiGet('channels', { part: 'statistics,contentDetails', id: chunk.join(',') }, apiKey);
    for (const c of data.items || []) {
      const st = c.statistics || {};
      const related = (c.contentDetails && c.contentDetails.relatedPlaylists) || {};
      result[c.id] = {
        subscriberCount: st.hiddenSubscriberCount || st.subscriberCount === undefined ? null : toInt(st.subscriberCount),
        uploadsPlaylistId: related.uploads || ''
      };
    }
  }
  return result;
}

// --- Market Analytics ---

/**
 * 시장 진입 기회 지수 (0~100)
 *   = 소형 채널(구독 2만 이하) 영상 비중 × 60
 *   + 소형 채널 떡상(조회수 1만 이상 & 평소 대비 3배 이상) 영상 비중 × 2(최대 100%) × 40
 * 채널 규모는 구독자 수로 나누므로 구독자 비공개 채널은 이 계산에서 제외한다.
 */
function computeMarketAnalytics(videos, query = '') {
  videos = videos || [];
  // 점수(평소 대비 또는 구독자 대비)를 계산할 수 있는 영상
  const known = videos.filter(v => typeof v.score === 'number');
  // 떡상 = 조회수 하한선 이상 & 메인 점수 3배 이상
  const isOutlier = v => v.qualifies && v.score >= OUTLIER_RATIO;
  const outliers = known.filter(isOutlier);
  const avgViews = videos.length ? Math.round(videos.reduce((s, v) => s + v.viewCount, 0) / videos.length) : 0;
  const baselineCount = videos.filter(v => v.scoreBasis === 'baseline').length;
  const estimatedCount = videos.filter(v => v.scoreBasis === 'subs').length;
  // 채널 규모를 알 수 있는 영상(구독자 공개)
  const sized = known.filter(v => typeof v.subscriberCount === 'number' && v.subscriberCount > 0);

  // 떡상 영상이 충분하면 그 제목에서, 반복 키워드가 3개 미만이면 전체 제목에서 추출
  let keywordSource = outliers.length >= 5 ? outliers : videos;
  let topKeywords = extractTitleKeywords(keywordSource, query);
  if (keywordSource !== videos && topKeywords.length < 3) {
    keywordSource = videos;
    topKeywords = extractTitleKeywords(videos, query);
  }
  // 최고 배수도 하한선을 넘은 영상 중에서만 계산
  const qualified = known.filter(v => v.qualifies);
  const maxMultiplier = qualified.length ? qualified.reduce((m, v) => Math.max(m, v.score), 0) : null;

  const common = {
    knownCount: known.length,
    sizedCount: sized.length,
    hiddenCount: videos.length - sized.length,
    baselineCount,
    estimatedCount,
    outlierCount: outliers.length,
    maxMultiplier,
    maxMultiplierFormatted: formatMultiplier(maxMultiplier),
    avgViewsFormatted: formatNumber(avgViews),
    topKeywords,
    keywordBasis: keywordSource === videos ? 'all' : 'outliers',
    keywordBasisCount: keywordSource.length,
    minOutlierViews: MIN_OUTLIER_VIEWS
  };

  // 기회 지수만 채널 규모(구독자 수)가 필요하다. 나머지 지표는 그대로 보여 준다.
  if (sized.length === 0) {
    return {
      ...common,
      opportunityScore: 0,
      opportunityLevel: '데이터 부족',
      opportunityTone: 'neutral',
      opportunityAdvice: known.length === 0
        ? '채널 평소 조회수와 구독자 수를 확인할 수 있는 영상이 없어 시장을 평가하지 못했습니다.'
        : '구독자 수가 공개된 채널이 없어 채널 규모별 시장을 평가하지 못했습니다.',
      smallChannelShare: 0, smallChannelCount: 0, smallOutlierCount: 0, smallOutlierShare: 0,
      medianSubscribersFormatted: '-'
    };
  }

  const small = sized.filter(v => v.subscriberCount <= SMALL_CHANNEL_MAX_SUBS);
  const smallOutliers = small.filter(isOutlier);
  const smallShare = small.length / sized.length;
  const smallOutlierShare = smallOutliers.length / sized.length;
  const score = Math.round(Math.min(100, smallShare * 60 + Math.min(1, smallOutlierShare * 2) * 40));

  let level = '경쟁 보통';
  let tone = 'mid';
  let advice = '틈새 키워드와 차별화된 썸네일로 충분히 공략할 수 있는 시장입니다.';
  if (score >= 60) {
    level = '기회 높음';
    tone = 'good';
    advice = '구독자가 적은 채널도 높은 조회수를 얻고 있습니다. 지금 진입하기 좋은 시장입니다.';
  } else if (score < 30) {
    level = '경쟁 치열';
    tone = 'bad';
    advice = '대형 채널이 상위를 차지하고 있습니다. 더 좁은 세부 키워드로 우회 진입을 권장합니다.';
  }

  const subsSorted = sized.map(v => v.subscriberCount).sort((a, b) => a - b);
  const medianSubs = subsSorted[Math.floor(subsSorted.length / 2)];

  return {
    ...common,
    opportunityScore: score,
    opportunityLevel: level,
    opportunityTone: tone,
    opportunityAdvice: advice,
    smallChannelShare: Math.round(smallShare * 100),
    smallChannelCount: small.length,
    smallOutlierCount: smallOutliers.length,
    smallOutlierShare: Math.round(smallOutlierShare * 100),
    medianSubscribersFormatted: formatNumber(medianSubs)
  };
}

// --- Keyword Extraction ---

const STOP_WORDS = new Set([
  // 한국어 일반어·기능어
  '있는', '하는', '없는', '되는', '위한', '대한', '통해', '그냥', '정말', '진짜', '지금', '이거', '이것', '그거', '이런', '그런',
  '모든', '가장', '많이', '너무', '하면', '해서', '하고', '합니다', '입니다', '있습니다', '없습니다', '했습니다', '됩니다',
  '영상', '방법', '이유', '어떻게', '무엇', '뭐가', '것은', '것이', '경우', '오늘', '이번', '우리', '저는', '제가', '내가',
  '쇼츠', '숏츠', '구독', '좋아요', '알림', '설정', '최신판',
  '만에', '하나', '한번', '이제', '바로', '같은', '하기', '하세요', '해야', '해보니', '했더니', '봤습니다', '드립니다', '알려드립니다',
  // 영어 기능어
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'and', 'or', 'for', 'with', 'you', 'your', 'how', 'is', 'are', 'this', 'that',
  'my', 'i', 'it', 'its', 'be', 'from', 'at', 'by', 'what', 'why', 'shorts', 'short', 'vs', 'ep', 'feat'
]);

// 조사·어미 (긴 것부터 검사)
const KO_SUFFIXES = ['에서는', '으로는', '에게서', '이라고', '에서', '으로', '에게', '까지', '부터', '처럼', '보다', '이나', '라고',
  '하는', '하고', '해서', '하면', '이다', '은', '는', '이', '가', '을', '를', '에', '의', '도', '만', '로', '와', '과', '나'];

function normalizeToken(token) {
  let t = token.toLowerCase();
  if (/[가-힣]$/.test(t)) {
    for (const suf of KO_SUFFIXES) {
      if (t.length - suf.length >= 2 && t.endsWith(suf)) {
        t = t.slice(0, -suf.length);
        break;
      }
    }
  }
  return t;
}

function tokenize(text) {
  return (String(text).match(/[\p{L}\p{N}]+/gu) || []).map(normalizeToken);
}

function extractTitleKeywords(videos, query = '') {
  const queryTokens = new Set(tokenize(query));
  // 검색어를 품은 합성어(예: 검색어 "일상생활" → "일상생활영어")도 새로운 정보가 아니므로 뺀다
  // 영문 짧은 토큰(ai 등)은 daily·email 같은 무관한 단어까지 지우므로 한글 토큰에만 적용한다
  const queryWords = [...queryTokens].filter(q => q.length >= 2 && /[가-힣]/.test(q));
  const freq = new Map();

  for (const v of videos) {
    const unique = new Set(
      tokenize(v.title).filter(w =>
        w.length >= 2 &&
        !/^\d+$/.test(w) &&
        !STOP_WORDS.has(w) &&
        !queryTokens.has(w) &&
        !queryWords.some(q => w.includes(q))
      )
    );
    unique.forEach(w => freq.set(w, (freq.get(w) || 0) + 1));
  }

  return [...freq.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, 8)
    .map(([word, count]) => ({ word, count, percent: Math.round((count / videos.length) * 100) }));
}

// --- Utilities ---

function calculatePublishedAfter(period) {
  const DAY = 86400000;
  const spans = { '24h': 1, '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  return spans[period] ? new Date(Date.now() - spans[period] * DAY).toISOString() : null;
}

function chunkArray(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
}

function pickThumbnail(t = {}) {
  return (t.medium && t.medium.url) || (t.high && t.high.url) || (t.default && t.default.url) || '';
}

// ISO 8601 (P#DT#H#M#S, P0D)
function parseIsoDuration(str) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(str || '');
  if (!m) return 0;
  return toInt(m[1]) * 86400 + toInt(m[2]) * 3600 + toInt(m[3]) * 60 + toInt(m[4]);
}

function formatDuration(total) {
  if (!total || total <= 0) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatNumber(num) {
  if (!num || num <= 0) return '0';
  if (num >= 100000000) return `${(num / 100000000).toFixed(1).replace(/\.0$/, '')}억`;
  if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  return num.toLocaleString('ko-KR');
}

function formatMultiplier(x) {
  if (x === null || x === undefined) return '-';
  if (x >= 100) return `${Math.round(x).toLocaleString('ko-KR')}배`;
  return `${x.toFixed(1).replace(/\.0$/, '')}배`;
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function formatRelativeTime(date, now = Date.now()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const sec = Math.floor((now - date.getTime()) / 1000);
  if (sec < 60) return '방금 전';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}일 전`;
  if (day < 365) return `${Math.min(11, Math.floor(day / 30))}개월 전`;
  return `${Math.floor(day / 365)}년 전`;
}

module.exports = {
  searchYouTube,
  setUsageRecorder,
  computeMarketAnalytics,
  extractTitleKeywords,
  // 테스트용
  _internal: { relevanceIssue, parseIsoDuration, formatRelativeTime, formatMultiplier, formatNumber, tokenize, explainApiError, computeChannelBaseline, fetchChannelUploads, mapLimit }
};
