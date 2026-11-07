// YouTube Data API v3 Service (Native fetch, zero external dependencies)

function parseDuration(isoDuration) {
  if (!isoDuration) return 0;
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function formatDuration(totalSeconds) {
  if (totalSeconds <= 0) return '00:00';
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  const n = Number(num);
  if (n >= 100000000) {
    return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '억';
  }
  if (n >= 10000) {
    return (n / 10000).toFixed(1).replace(/\.0$/, '') + '만';
  }
  if (n >= 1000) {
    return (n / 1000).toFixed(1).replace(/\.0$/, '') + '천';
  }
  return n.toLocaleString();
}

async function searchYouTube(apiKey, { query, maxResults = 30, publishedAfter, order = 'relevance' }) {
  if (!apiKey) {
    throw new Error('YouTube Data API 키가 설정되지 않았습니다. 환경설정에서 API 키를 입력해 주세요.');
  }

  // 1. Search videos
  const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  searchUrl.searchParams.set('part', 'snippet');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('type', 'video');
  searchUrl.searchParams.set('maxResults', Math.min(maxResults, 50).toString());
  searchUrl.searchParams.set('order', order);
  if (publishedAfter) {
    searchUrl.searchParams.set('publishedAfter', publishedAfter);
  }
  searchUrl.searchParams.set('key', apiKey);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) {
    const errorData = await searchRes.json().catch(() => ({}));
    const message = errorData.error?.message || `YouTube API Search 오류 (${searchRes.status})`;
    throw new Error(message);
  }

  const searchData = await searchRes.json();
  const items = searchData.items || [];
  if (items.length === 0) return [];

  const videoIds = items.map(item => item.id.videoId).filter(Boolean);
  const channelIds = [...new Set(items.map(item => item.snippet.channelId).filter(Boolean))];

  // 2. Fetch video statistics & duration
  const videosUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
  videosUrl.searchParams.set('part', 'snippet,statistics,contentDetails');
  videosUrl.searchParams.set('id', videoIds.join(','));
  videosUrl.searchParams.set('key', apiKey);

  const videosRes = await fetch(videosUrl.toString());
  const videosData = videosRes.ok ? await videosRes.json() : { items: [] };
  const videoDetailsMap = new Map();
  (videosData.items || []).forEach(v => videoDetailsMap.set(v.id, v));

  // 3. Fetch channel statistics (subscriber count)
  const channelsUrl = new URL('https://www.googleapis.com/youtube/v3/channels');
  channelsUrl.searchParams.set('part', 'statistics');
  channelsUrl.searchParams.set('id', channelIds.join(','));
  channelsUrl.searchParams.set('key', apiKey);

  const channelsRes = await fetch(channelsUrl.toString());
  const channelsData = channelsRes.ok ? await channelsRes.json() : { items: [] };
  const channelDetailsMap = new Map();
  (channelsData.items || []).forEach(c => channelDetailsMap.set(c.id, c));

  // 4. Combine and compute metrics
  const now = new Date();
  const results = items.map(item => {
    const vid = item.id.videoId;
    const vDetail = videoDetailsMap.get(vid);
    const cDetail = channelDetailsMap.get(item.snippet.channelId);

    const viewCount = parseInt(vDetail?.statistics?.viewCount || '0', 10);
    const likeCount = parseInt(vDetail?.statistics?.likeCount || '0', 10);
    const commentCount = parseInt(vDetail?.statistics?.commentCount || '0', 10);
    const subscriberCount = parseInt(cDetail?.statistics?.subscriberCount || '0', 10);

    const durationSeconds = parseDuration(vDetail?.contentDetails?.duration);
    const isShorts = durationSeconds > 0 && durationSeconds <= 60;

    const publishedAt = new Date(item.snippet.publishedAt);
    const daysSincePublished = Math.max(1, Math.round((now - publishedAt) / (1000 * 60 * 60 * 24)));
    const viewsPerDay = Math.round(viewCount / daysSincePublished);

    // 떡상 배수 (구독자 대비 조회수 비율)
    let outlierMultiplier = 0;
    if (subscriberCount > 0) {
      outlierMultiplier = Number((viewCount / subscriberCount).toFixed(1));
    } else if (viewCount > 5000) {
      // 구독자 비공개지만 조회수가 높은 경우
      outlierMultiplier = 10.0;
    }

    return {
      id: vid,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnails: item.snippet.thumbnails,
      channelId: item.snippet.channelId,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      publishedAtRelative: `${daysSincePublished}일 전`,
      durationSeconds,
      durationFormatted: formatDuration(durationSeconds),
      isShorts,
      viewCount,
      viewCountFormatted: formatNumber(viewCount),
      likeCount,
      likeCountFormatted: formatNumber(likeCount),
      commentCount,
      commentCountFormatted: formatNumber(commentCount),
      subscriberCount,
      subscriberCountFormatted: subscriberCount > 0 ? formatNumber(subscriberCount) : '비공개',
      viewsPerDay,
      viewsPerDayFormatted: formatNumber(viewsPerDay),
      outlierMultiplier,
      url: `https://www.youtube.com/watch?v=${vid}`,
      channelUrl: `https://www.youtube.com/channel/${item.snippet.channelId}`
    };
  });

  return results;
}

module.exports = {
  searchYouTube,
  formatNumber,
  formatDuration
};
