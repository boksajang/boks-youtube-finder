// ==========================================================================
// BOKS YOUTUBE FINDER - Trend Breakdown
// 검색 결과를 형식·채널 규모·길이·업로드 시점·제목 패턴·태그·채널별로 나눠
// "무엇이 터지는가"를 숫자로 요약한다. 화면 차트와 AI 프롬프트가 함께 쓴다.
// ==========================================================================

const OUTLIER_RATIO = 3;
const MIN_GROUP = 3; // 비교 결론을 내리기 위한 최소 표본

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일
const HOUR_BLOCKS = [[0, 6, '새벽 0~6시'], [6, 9, '아침 6~9시'], [9, 12, '오전 9~12시'], [12, 15, '점심 12~15시'],
  [15, 18, '오후 15~18시'], [18, 21, '저녁 18~21시'], [21, 24, '밤 21~24시']];

const SHORTS_BUCKETS = [[0, 30, '30초 이하'], [31, 60, '31~60초'], [61, 180, '1~3분']];
const LONG_BUCKETS = [[181, 480, '3~8분'], [481, 900, '8~15분'], [901, 1800, '15~30분'], [1801, 3600, '30~60분'], [3601, Infinity, '1시간 이상']];
const SUB_TIERS = [[0, 9999, '1만 미만', 'micro'], [10000, 99999, '1만~10만', 'small'], [100000, 999999, '10만~100만', 'mid'], [1000000, Infinity, '100만 이상', 'large']];
const RECENCY = [[0, 7, '7일 이내'], [7, 30, '8~30일'], [30, 90, '1~3개월'], [90, 365, '3~12개월'], [365, Infinity, '1년 이상']];

const TITLE_FEATURES = [
  ['number', '숫자 포함', t => /\d/.test(t)],
  ['question', '질문형(?)', t => /\?|？/.test(t)],
  ['exclaim', '느낌표(!)', t => /!|！/.test(t)],
  ['bracket', '괄호·대괄호', t => /[[\]()【】「」『』<>]/.test(t)],
  ['quote', '따옴표 인용', t => /["“”'‘’]/.test(t)],
  ['emoji', '이모지', t => /\p{Extended_Pictographic}/u.test(t)],
  ['english', '영어 단어', t => /[A-Za-z]{2,}/.test(t)]
];

const isOutlier = v => !!v.qualifies && typeof v.score === 'number' && v.score >= OUTLIER_RATIO;

function median(nums) {
  const a = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((x, y) => x - y);
  if (a.length === 0) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const round1 = x => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

function groupStats(list) {
  const outliers = list.filter(isOutlier);
  return {
    count: list.length,
    outlierCount: outliers.length,
    outlierRate: pct(outliers.length, list.length),
    medianScore: round1(median(list.map(v => v.score))),
    medianViews: Math.round(median(list.map(v => v.viewCount)) || 0)
  };
}

function kstParts(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t + 9 * 3600 * 1000);
  return { day: d.getUTCDay(), hour: d.getUTCHours() };
}

function bucketize(list, buckets, valueOf) {
  return buckets.map(([lo, hi, label]) => ({ label, ...groupStats(list.filter(v => { const x = valueOf(v); return x >= lo && x <= hi; })) }));
}

function bestOf(groups) {
  // 표본이 충분한 그룹 중 평소 대비 중앙값이 가장 높은 그룹
  const ok = groups.filter(g => g.count >= MIN_GROUP && g.medianScore !== null);
  return ok.length ? ok.reduce((a, b) => (b.medianScore > a.medianScore ? b : a)) : null;
}

function formatBlock(list, total, totalViews) {
  const views = list.reduce((s, v) => s + v.viewCount, 0);
  const top = list.filter(isOutlier).sort((a, b) => b.score - a.score)[0] || null;
  return {
    ...groupStats(list),
    share: pct(list.length, total),
    totalViews: views,
    viewsShare: pct(views, totalViews),
    medianLikeRate: round1(median(list.map(v => v.likeRate))),
    medianDurationSec: Math.round(median(list.map(v => v.durationSec)) || 0),
    medianViewsPerDay: Math.round(median(list.map(v => v.viewsPerDay)) || 0),
    top: top ? { id: top.id, title: top.title, score: top.score, channelTitle: top.channelTitle } : null
  };
}

function computeTrends(videos, format = 'all', now = Date.now()) {
  videos = Array.isArray(videos) ? videos : [];
  const total = videos.length;
  const totalViews = videos.reduce((s, v) => s + (v.viewCount || 0), 0);
  const outliers = videos.filter(isOutlier);
  const others = videos.filter(v => !isOutlier(v));
  const shorts = videos.filter(v => v.isShorts);
  const longs = videos.filter(v => !v.isShorts);
  const ageDays = v => Math.max(0, (now - Date.parse(v.publishedAt)) / 86400000);

  const totals = {
    count: total,
    totalViews,
    medianViews: Math.round(median(videos.map(v => v.viewCount)) || 0),
    medianScore: round1(median(videos.map(v => v.score))),
    outlierCount: outliers.length,
    outlierRate: pct(outliers.length, total),
    medianLikeRate: round1(median(videos.map(v => v.likeRate))),
    medianCommentRate: median(videos.map(v => v.commentRate)),
    medianViewsPerDay: Math.round(median(videos.map(v => v.viewsPerDay)) || 0),
    recent30Share: pct(videos.filter(v => ageDays(v) <= 30).length, total),
    outlierMedianLikeRate: round1(median(outliers.map(v => v.likeRate))),
    otherMedianLikeRate: round1(median(others.map(v => v.likeRate)))
  };

  const formatSplit = { shorts: formatBlock(shorts, total, totalViews), long: formatBlock(longs, total, totalViews) };

  const channelTiers = [
    ...SUB_TIERS.map(([lo, hi, label, key]) => ({ key, label, ...groupStats(videos.filter(v => typeof v.subscriberCount === 'number' && v.subscriberCount >= lo && v.subscriberCount <= hi)) })),
    { key: 'hidden', label: '구독자 비공개', ...groupStats(videos.filter(v => typeof v.subscriberCount !== 'number')) }
  ].map(t => ({ ...t, share: pct(t.count, total) }));

  const durations = {
    shorts: bucketize(shorts, SHORTS_BUCKETS, v => v.durationSec),
    long: bucketize(longs, LONG_BUCKETS, v => v.durationSec)
  };

  const withTime = videos.map(v => ({ v, t: kstParts(v.publishedAt) })).filter(x => x.t);
  const weekday = WEEK_ORDER.map(d => ({ label: WEEKDAYS[d], ...groupStats(withTime.filter(x => x.t.day === d).map(x => x.v)) }));
  const hours = HOUR_BLOCKS.map(([lo, hi, label]) => ({ label, ...groupStats(withTime.filter(x => x.t.hour >= lo && x.t.hour < hi).map(x => x.v)) }));

  const recency = RECENCY.map(([lo, hi, label]) => {
    // 구간: [0,7] (7,30] (30,90] (90,365] (365,∞)
    const list = videos.filter(v => { const a = ageDays(v); return Number.isFinite(a) && (lo === 0 ? a >= 0 : a > lo) && a <= hi; });
    return { label, ...groupStats(list), medianViewsPerDay: Math.round(median(list.map(v => v.viewsPerDay)) || 0) };
  });

  const titleLen = list => round1(median(list.map(v => [...String(v.title || '')].length)));
  const titlePatterns = {
    features: TITLE_FEATURES.map(([key, label, test]) => ({
      key, label,
      outlierPct: pct(outliers.filter(v => test(v.title || '')).length, outliers.length),
      otherPct: pct(others.filter(v => test(v.title || '')).length, others.length)
    })),
    outlierTitleLength: titleLen(outliers),
    otherTitleLength: titleLen(others),
    outlierCount: outliers.length,
    otherCount: others.length
  };

  // 태그: 같은 영상 안 중복 제거, 대소문자·공백 정규화
  const tagMap = new Map();
  for (const v of videos) {
    const uniq = new Map();
    for (const raw of v.tags || []) {
      const t = String(raw).trim().replace(/^#+/, '').trim(); // "#영어공부"와 "영어공부"는 같은 태그
      if (t.length < 2 || t.length > 40) continue;
      const k = t.toLowerCase().replace(/\s+/g, ' ');
      if (!uniq.has(k)) uniq.set(k, t);
    }
    for (const [k, t] of uniq) {
      const e = tagMap.get(k) || { tag: t, count: 0, outlierCount: 0 };
      e.count++;
      if (isOutlier(v)) e.outlierCount++;
      tagMap.set(k, e);
    }
  }
  const taggedVideos = videos.filter(v => (v.tags || []).length > 0).length;
  const topTags = [...tagMap.values()].filter(t => t.count >= 2)
    .sort((a, b) => b.count - a.count || b.outlierCount - a.outlierCount || a.tag.localeCompare(b.tag, 'ko'))
    .slice(0, 20);

  const chMap = new Map();
  for (const v of videos) {
    const e = chMap.get(v.channelId) || { channelId: v.channelId, channelTitle: v.channelTitle, subscriberCount: v.subscriberCount, count: 0, totalViews: 0, outlierCount: 0, bestScore: null };
    e.count++;
    e.totalViews += v.viewCount;
    if (isOutlier(v)) e.outlierCount++;
    if (typeof v.score === 'number' && (e.bestScore === null || v.score > e.bestScore)) e.bestScore = v.score;
    chMap.set(v.channelId, e);
  }
  const channels = [...chMap.values()];
  const topChannels = channels.sort((a, b) => b.totalViews - a.totalViews).slice(0, 6)
    .map(c => ({ ...c, viewsShare: pct(c.totalViews, totalViews) }));
  const top5Share = pct(topChannels.slice(0, 5).reduce((s, c) => s + c.totalViews, 0), totalViews);

  const result = {
    format, totals, formatSplit, channelTiers, durations, weekday, hours, recency, titlePatterns,
    topTags, taggedVideos, topChannels, channelCount: channels.length, top5Share
  };
  result.findings = buildFindings(result);
  return result;
}

// 차트를 읽지 않아도 핵심을 알 수 있도록 데이터에서 바로 나온 결론만 문장으로 만든다
function buildFindings(r) {
  const out = [];
  const t = r.totals;
  if (t.count === 0) return out;

  const fs = r.formatSplit;
  if (r.format === 'all' && fs.shorts.count >= MIN_GROUP && fs.long.count >= MIN_GROUP) {
    const better = fs.shorts.outlierRate === fs.long.outlierRate ? null : fs.shorts.outlierRate > fs.long.outlierRate ? '쇼츠' : '롱폼';
    out.push({
      key: 'format',
      text: better
        ? `${better}의 떡상 비율이 더 높습니다 (쇼츠 ${fs.shorts.outlierRate}% · 롱폼 ${fs.long.outlierRate}%).`
        : `쇼츠와 롱폼의 떡상 비율이 같습니다 (${fs.shorts.outlierRate}%).`
    });
  }

  const durGroups = r.format === 'shorts' ? r.durations.shorts : r.format === 'long' ? r.durations.long : [...r.durations.shorts, ...r.durations.long];
  const bestDur = bestOf(durGroups);
  if (bestDur) out.push({ key: 'duration', text: `${bestDur.label} 길이 영상이 평소 대비 중앙값 ${bestDur.medianScore}배로 성과가 가장 좋습니다 (${bestDur.count}개).` });

  const smallTiers = r.channelTiers.filter(x => x.key === 'micro' || x.key === 'small');
  const smallCount = smallTiers.reduce((s, x) => s + x.count, 0);
  const smallOut = smallTiers.reduce((s, x) => s + x.outlierCount, 0);
  if (smallCount >= MIN_GROUP) {
    out.push({ key: 'small', text: `구독자 10만 미만 채널 영상 ${smallCount}개 중 ${smallOut}개(${pct(smallOut, smallCount)}%)가 떡상했습니다.` });
  }

  const bestDay = bestOf(r.weekday);
  if (bestDay) out.push({ key: 'weekday', text: `${bestDay.label}요일에 올린 영상의 평소 대비 중앙값이 ${bestDay.medianScore}배로 가장 높습니다 (한국 시간 기준).` });

  const tp = r.titlePatterns;
  if (tp.outlierCount >= MIN_GROUP && tp.otherCount >= MIN_GROUP) {
    const gap = tp.features.map(f => ({ ...f, gap: f.outlierPct - f.otherPct })).sort((a, b) => b.gap - a.gap)[0];
    if (gap && gap.gap >= 10) out.push({ key: 'title', text: `떡상 영상 제목의 ${gap.outlierPct}%가 '${gap.label}' 패턴입니다 (그 외 영상 ${gap.otherPct}%).` });
  }

  if (t.recent30Share >= 40) out.push({ key: 'fresh', text: `상위 영상의 ${t.recent30Share}%가 최근 30일 안에 올라왔습니다. 지금 관심이 커지는 주제입니다.` });
  else if (t.recent30Share <= 10) out.push({ key: 'evergreen', text: `최근 30일 영상은 ${t.recent30Share}%뿐입니다. 꾸준히 검색되는 스테디 주제이거나 최근 공급이 적은 주제입니다.` });

  if (r.top5Share >= 60) out.push({ key: 'concentration', text: `상위 5개 채널이 전체 조회수의 ${r.top5Share}%를 차지합니다. 소수 채널이 강한 시장입니다.` });

  if (t.outlierMedianLikeRate !== null && t.otherMedianLikeRate !== null && tp.outlierCount >= MIN_GROUP) {
    out.push({ key: 'engagement', text: `좋아요율 중앙값: 떡상 영상 ${t.outlierMedianLikeRate}% · 그 외 ${t.otherMedianLikeRate}%.` });
  }
  return out;
}

module.exports = { computeTrends, _internal: { median, kstParts, buildFindings, isOutlier } };
