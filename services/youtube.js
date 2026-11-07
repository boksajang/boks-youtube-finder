// ==========================================================================
// BOKS YOUTUBE FINDER - YouTube Data API v3 Service & Advanced Analytics
// ==========================================================================

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

/**
 * Searches YouTube videos and enriches with channel stats & outlier metrics
 * Supports regional & language targeting (KR, US, JP, etc.)
 */
async function searchYouTube({ apiKey, query, maxResults = 40, regionCode = 'KR', relevanceLanguage = 'ko' }) {
  if (!apiKey) {
    throw new Error('YouTube Data API 키가 설정되지 않았습니다. [환경설정] 메뉴에서 API 키를 등록해 주세요.');
  }

  // 1. Search videos by keyword with regional and language filters
  let searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&q=${encodeURIComponent(query)}&type=video&maxResults=${maxResults}&key=${apiKey}`;
  
  if (regionCode && regionCode !== 'ALL') {
    searchUrl += `&regionCode=${encodeURIComponent(regionCode)}`;
  }
  if (relevanceLanguage && relevanceLanguage !== 'ALL') {
    searchUrl += `&relevanceLanguage=${encodeURIComponent(relevanceLanguage)}`;
  }

  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    const errorData = await searchRes.json().catch(() => ({}));
    throw new Error(`YouTube API 검색 실패 (${searchRes.status}): ${errorData.error?.message || searchRes.statusText}`);
  }
  const searchData = await searchRes.json();
  const items = searchData.items || [];
  if (items.length === 0) return [];

  const videoIds = items.map(item => item.id.videoId).filter(Boolean);
  const channelIds = [...new Set(items.map(item => item.snippet.channelId).filter(Boolean))];

  // 2. Batch fetch video details (Duration, statistics)
  const videoDetailsMap = await fetchVideoDetails(videoIds, apiKey);

  // 3. Batch fetch channel statistics (Subscriber counts)
  const channelDetailsMap = await fetchChannelDetails(channelIds, apiKey);

  // 4. Combine and compute outlier multipliers & velocity
  const now = new Date();
  const enrichedVideos = items.map(item => {
    const videoId = item.id.videoId;
    const channelId = item.snippet.channelId;
    const vDetail = videoDetailsMap[videoId] || {};
    const cDetail = channelDetailsMap[channelId] || {};

    const viewCount = parseInt(vDetail.viewCount || '0', 10);
    const subscriberCount = parseInt(cDetail.subscriberCount || '0', 10);
    const durationSec = vDetail.durationSec || 0;
    const isShorts = durationSec > 0 && durationSec <= 60;

    // Outlier multiplier: views / subscribers (defaults to 1.0 if subscriberCount unknown)
    let outlierMultiplier = 1.0;
    if (subscriberCount > 0) {
      outlierMultiplier = Math.round((viewCount / subscriberCount) * 10) / 10;
    }

    // Velocity: views per day
    const publishedAt = new Date(item.snippet.publishedAt);
    const diffDays = Math.max(1, Math.round((now - publishedAt) / (1000 * 60 * 60 * 24)));
    const viewsPerDay = Math.round(viewCount / diffDays);

    return {
      id: videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: item.snippet.title,
      description: item.snippet.description,
      channelId: channelId,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      publishedAtRelative: formatRelativeTime(publishedAt),
      publishedDayOfWeek: publishedAt.getDay(), // 0: Sun, 1: Mon, ...
      publishedHour: publishedAt.getHours(),
      thumbnails: item.snippet.thumbnails,
      durationSec: durationSec,
      durationFormatted: formatDuration(durationSec),
      isShorts: isShorts,
      viewCount: viewCount,
      viewCountFormatted: formatNumber(viewCount),
      subscriberCount: subscriberCount,
      subscriberCountFormatted: formatNumber(subscriberCount),
      likeCount: parseInt(vDetail.likeCount || '0', 10),
      commentCount: parseInt(vDetail.commentCount || '0', 10),
      outlierMultiplier: outlierMultiplier,
      viewsPerDay: viewsPerDay,
      viewsPerDayFormatted: formatNumber(viewsPerDay),
      tags: vDetail.tags || []
    };
  });

  return enrichedVideos;
}

/**
 * Batch fetch video metadata (contentDetails, statistics)
 */
async function fetchVideoDetails(videoIds, apiKey) {
  if (!videoIds || videoIds.length === 0) return {};
  const chunks = chunkArray(videoIds, 50);
  const result = {};

  for (const chunk of chunks) {
    const url = `${YOUTUBE_API_BASE}/videos?part=contentDetails,statistics,snippet&id=${chunk.join(',')}&key=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      (data.items || []).forEach(v => {
        result[v.id] = {
          durationSec: ISO8601DurationToSeconds(v.contentDetails?.duration || ''),
          viewCount: v.statistics?.viewCount || '0',
          likeCount: v.statistics?.likeCount || '0',
          commentCount: v.statistics?.commentCount || '0',
          tags: v.snippet?.tags || []
        };
      });
    }
  }
  return result;
}

/**
 * Batch fetch channel statistics (subscriberCount)
 */
async function fetchChannelDetails(channelIds, apiKey) {
  if (!channelIds || channelIds.length === 0) return {};
  const chunks = chunkArray(channelIds, 50);
  const result = {};

  for (const chunk of chunks) {
    const url = `${YOUTUBE_API_BASE}/channels?part=statistics&id=${chunk.join(',')}&key=${apiKey}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      (data.items || []).forEach(c => {
        result[c.id] = {
          subscriberCount: c.statistics?.subscriberCount || '0',
          videoCount: c.statistics?.videoCount || '0'
        };
      });
    }
  }
  return result;
}

// --- Advanced Market Analytics ---

/**
 * Analyzes market competition and small creator opportunity score
 */
function computeMarketAnalytics(videos) {
  if (!videos || videos.length === 0) {
    return {
      opportunityScore: 0,
      opportunityLevel: '데이터 없음',
      smallChannelShare: 0,
      avgViews: 0,
      avgSubscribers: 0,
      topKeywords: [],
      dayDistribution: [0, 0, 0, 0, 0, 0, 0]
    };
  }

  const total = videos.length;
  // Small channels: subscribers under 20,000
  const smallChannels = videos.filter(v => v.subscriberCount > 0 && v.subscriberCount <= 20000);
  const smallChannelShare = Math.round((smallChannels.length / total) * 100);

  // Outliers among small channels (>= 3.0x)
  const smallOutliers = smallChannels.filter(v => v.outlierMultiplier >= 3.0);

  // Calculate Opportunity Score (0 to 100)
  let score = Math.min(100, Math.round(smallChannelShare * 1.1 + (smallOutliers.length / total) * 45));
  let level = '경쟁 보통';
  let levelColor = '#f59e0b';
  let advice = '적절한 틈새 키워드와 썸네일로 공략 가능한 시장입니다.';

  if (score >= 60) {
    level = '기회 매우 높음 (빈집 털이 최적 🟢)';
    levelColor = '#10b981';
    advice = '구독자 적은 하꼬 채널들이 높은 조회수를 쓸어담고 있는 알짜 시장입니다!';
  } else if (score <= 30) {
    level = '경쟁 극심 (대형 채널 독점 🔴)';
    levelColor = '#ff2e4d';
    advice = '대형 채널들이 상단을 장악하고 있어 세부 서브 키워드로 우회 진입을 권장합니다.';
  }

  // Averages
  const totalViews = videos.reduce((sum, v) => sum + v.viewCount, 0);
  const totalSubs = videos.reduce((sum, v) => sum + v.subscriberCount, 0);
  const avgViews = Math.round(totalViews / total);
  const avgSubscribers = Math.round(totalSubs / total);

  // Keyword extraction from titles
  const topKeywords = extractTitleKeywords(videos);

  // Day of week distribution (0: Sun, 1: Mon, ... 6: Sat)
  const dayDistribution = [0, 0, 0, 0, 0, 0, 0];
  videos.forEach(v => {
    if (v.publishedDayOfWeek !== undefined) {
      dayDistribution[v.publishedDayOfWeek]++;
    }
  });

  return {
    opportunityScore: score,
    opportunityLevel: level,
    opportunityColor: levelColor,
    opportunityAdvice: advice,
    smallChannelShare: smallChannelShare,
    smallChannelCount: smallChannels.length,
    smallOutlierCount: smallOutliers.length,
    avgViews: avgViews,
    avgViewsFormatted: formatNumber(avgViews),
    avgSubscribers: avgSubscribers,
    avgSubscribersFormatted: formatNumber(avgSubscribers),
    topKeywords: topKeywords,
    dayDistribution: dayDistribution
  };
}

/**
 * Extracts high-frequency hooking keywords from titles
 */
function extractTitleKeywords(videos) {
  const stopWords = new Set([
    '수', '있는', '하는', '이', '그', '저', '것', '및', '을', '를', '에', '의', '가', '은', '는', '으로', '로',
    '에서', '과', '와', '도', '다', 'vs', 'ep', 'shorts', '쇼츠', '영상', '대한', '방법', '이유', '어떻게',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '년', '월', '일', '개', '화', '전'
  ]);

  const freqMap = {};
  videos.forEach(v => {
    const words = v.title
      .replace(/[\[\]\(\)\{\}\<\>\|\#\!\?\.\,\~\+\-\_\/\"\:\;\★\🔥\⚡]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length >= 2 && !stopWords.has(w));

    const uniqueWords = new Set(words);
    uniqueWords.forEach(w => {
      freqMap[w] = (freqMap[w] || 0) + 1;
    });
  });

  return Object.entries(freqMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({
      word,
      count,
      percent: Math.round((count / videos.length) * 100)
    }));
}

// --- Utilities ---

function chunkArray(array, size) {
  const result = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

function ISO8601DurationToSeconds(durationStr) {
  if (!durationStr) return 0;
  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(totalSeconds) {
  if (!totalSeconds || totalSeconds <= 0) return '0:00';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const secStr = seconds < 10 ? `0${seconds}` : `${seconds}`;

  if (hours > 0) {
    const minStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    return `${hours}:${minStr}:${secStr}`;
  }
  return `${minutes}:${secStr}`;
}

function formatNumber(num) {
  if (!num || num <= 0) return '0';
  if (num >= 100000000) {
    return `${(num / 100000000).toFixed(1)}억`.replace('.0억', '억');
  }
  if (num >= 10000) {
    return `${(num / 10000).toFixed(1)}만`.replace('.0만', '만');
  }
  return num.toLocaleString();
}

function formatRelativeTime(date) {
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return '방금 전';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay}일 전`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth < 12) return `${diffMonth}개월 전`;
  const diffYear = Math.floor(diffDay / 365);
  return `${diffYear}년 전`;
}

module.exports = {
  searchYouTube,
  computeMarketAnalytics,
  extractTitleKeywords
};
