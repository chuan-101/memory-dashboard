import { Parser, normalizeMessage } from './parser.js';

function ensureImportScripts() {
  if (typeof importScripts === 'function') {
    return;
  }

  const globalObject = typeof globalThis !== 'undefined' ? globalThis : self;

  globalObject.importScripts = (...urls) => {
    urls.forEach(url => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      try {
        xhr.send(null);
      } catch (error) {
        throw new Error(`无法加载脚本：${url}`);
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        // eslint-disable-next-line no-eval
        (0, eval)(xhr.responseText);
      } else {
        throw new Error(`加载脚本失败：${url}`);
      }
    });
  };
}

ensureImportScripts();
importScripts('vendor/jieba.min.js');

const parser = new Parser();

self.addEventListener('message', async event => {
  const { data } = event || {};
  if (!data || data.type !== 'process') {
    return;
  }

  const { requestId, payload } = data;
  const { messages = [], options = {} } = payload || {};
  const overrides = options.overrides || {};
  const stopWords = options.stopWords || [];

  try {
    const stats = await computeStats(messages, { overrides, stopWords });
    self.postMessage({ type: 'result', requestId, stats });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error?.message || '解析失败，请重试。'
    });
  }
});

async function computeStats(rawMessages, { overrides = {}, stopWords = [] } = {}) {
  if (!Array.isArray(rawMessages)) {
    throw new Error('JSON 数据格式不正确，缺少消息数组。');
  }

  parser.setStopWords(stopWords);
  parser.currentOverrides = overrides || {};

  let assistantCount = 0;
  let userCount = 0;
  let assistantWords = 0;
  let userWords = 0;
  let totalMessages = 0;
  let earliestTimestamp = null;
  let earliestRole = null;

  const roleStatsMap = new Map();
  const monthMap = new Map();
  const hourCounts = Array(24).fill(0);
  const weekdayCounts = Array(7).fill(0);
  const dayMap = new Map();
  const daySet = new Set();
  const modelMap = new Map();
  const keywordMap = new Map();

  for (const rawMessage of rawMessages) {
    const normalised = normalizeMessage(rawMessage);
    if (!normalised) {
      continue;
    }

    totalMessages += 1;

    const role = normalised.role || 'unknown';
    const text = normalised.text || '';
    const timestamp = parser.normalizeTimestampValue(normalised.ts);
    const model = normalised.model || 'unknown';
    const wordCount = parser.countWords(text);

    if (role === 'assistant') {
      assistantCount += 1;
      assistantWords += wordCount;
    } else if (role === 'user') {
      userCount += 1;
      userWords += wordCount;
    }

    if (!roleStatsMap.has(role)) {
      roleStatsMap.set(role, {
        role,
        displayRole: parser.getDisplayName(role),
        messageCount: 0,
        wordCount: 0
      });
    }

    const roleEntry = roleStatsMap.get(role);
    roleEntry.messageCount += 1;
    roleEntry.wordCount += wordCount;

    if (timestamp !== null && !Number.isNaN(timestamp)) {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.getTime())) {
        const year = date.getFullYear();
        const month = `${date.getMonth() + 1}`.padStart(2, '0');
        const day = `${date.getDate()}`.padStart(2, '0');
        const monthKey = `${year}-${month}`;
        const dayKey = `${year}-${month}-${day}`;

        monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
        dayMap.set(dayKey, (dayMap.get(dayKey) || 0) + 1);
        daySet.add(dayKey);

        const hour = date.getHours();
        if (Number.isInteger(hour) && hour >= 0 && hour < hourCounts.length) {
          hourCounts[hour] += 1;
        }

        const weekday = date.getDay();
        if (Number.isInteger(weekday) && weekday >= 0 && weekday < weekdayCounts.length) {
          weekdayCounts[weekday] += 1;
        }

        if (earliestTimestamp === null || timestamp < earliestTimestamp) {
          earliestTimestamp = timestamp;
          earliestRole = role;
        }
      }
    }

    const modelLabel = (model || 'unknown').toString();
    const modelKey = modelLabel.toLowerCase() || 'unknown';
    if (!modelMap.has(modelKey)) {
      modelMap.set(modelKey, { label: modelLabel, count: 0 });
    }
    const modelEntry = modelMap.get(modelKey);
    modelEntry.count += 1;
    if (modelEntry.label === 'unknown' && modelLabel !== 'unknown') {
      modelEntry.label = modelLabel;
    }

    const tokens = await parser.tokenize(text);
    for (const token of tokens) {
      const normalizedToken = token.trim().toLowerCase();
      if (!normalizedToken || normalizedToken.length <= 1) {
        continue;
      }
      if (parser.stopWords.has(normalizedToken)) {
        continue;
      }
      keywordMap.set(normalizedToken, (keywordMap.get(normalizedToken) || 0) + 1);
    }
  }

  if (!totalMessages) {
    throw new Error('未找到可用于统计的 user/assistant 文本；请检查导出格式。');
  }

  const roleStats = Array.from(roleStatsMap.values()).sort((a, b) => b.messageCount - a.messageCount);

  const monthlyLabels = Array.from(monthMap.keys()).sort((a, b) => a.localeCompare(b));
  const monthlyHistogram = {
    labels: monthlyLabels,
    data: monthlyLabels.map(label => monthMap.get(label))
  };

  const hourlyHistogram = {
    labels: hourCounts.map((_, hour) => `${hour}:00`),
    data: hourCounts.slice()
  };

  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const weekdayHistogram = {
    labels: weekdayNames,
    data: weekdayCounts.slice()
  };

  const dailyLabels = Array.from(dayMap.keys()).sort((a, b) => a.localeCompare(b));
  const dailyTrend = {
    labels: dailyLabels,
    data: dailyLabels.map(label => dayMap.get(label))
  };

  const modelEntries = Array.from(modelMap.values()).sort((a, b) => b.count - a.count);
  const modelDistribution = {
    labels: modelEntries.map(entry => entry.label),
    data: modelEntries.map(entry => entry.count)
  };

  const keywords = buildKeywordList(keywordMap);

  const peakHour = computePeakHour(hourlyHistogram);
  const streak = computeStreak(daySet);

  const earliestMessage =
    earliestTimestamp !== null
      ? {
          date: new Date(earliestTimestamp),
          formatted: parser.formatDate(earliestTimestamp, { includeTime: true }),
          role: parser.getDisplayName(earliestRole)
        }
      : null;

  return {
    messageCount: totalMessages,
    assistantCount,
    userCount,
    assistantWords,
    userWords,
    roleStats,
    monthlyHistogram,
    hourlyHistogram,
    weekdayHistogram,
    modelDistribution,
    dailyTrend,
    streak,
    peakHour,
    earliestMessage,
    keywords
  };
}

function buildKeywordList(keywordMap) {
  if (!keywordMap.size) {
    return [];
  }

  const sorted = Array.from(keywordMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 100);

  const maxWeight = sorted[0]?.[1] || 1;

  return sorted.map(([word, weight]) => ({
    word,
    weight,
    normalizedWeight: weight / maxWeight
  }));
}

function computePeakHour(hourlyHistogram) {
  if (!hourlyHistogram?.data?.length) {
    return null;
  }

  let maxCount = -Infinity;
  let maxIndex = 0;

  hourlyHistogram.data.forEach((count, index) => {
    if (count > maxCount) {
      maxCount = count;
      maxIndex = index;
    }
  });

  return {
    hour: maxIndex,
    label: hourlyHistogram.labels[maxIndex],
    count: maxCount
  };
}

function computeStreak(daySet) {
  if (!daySet || daySet.size === 0) {
    return { longest: 0, range: null };
  }

  const sortedDays = Array.from(daySet)
    .sort((a, b) => a.localeCompare(b))
    .map(day => new Date(day));

  if (!sortedDays.length) {
    return { longest: 0, range: null };
  }

  let longest = 1;
  let current = 1;
  let bestRange = { start: sortedDays[0], end: sortedDays[0] };
  let tempStart = sortedDays[0];

  for (let i = 1; i < sortedDays.length; i += 1) {
    const diff = (sortedDays[i] - sortedDays[i - 1]) / (24 * 60 * 60 * 1000);
    if (diff === 1) {
      current += 1;
    } else {
      if (current > longest) {
        longest = current;
        bestRange = { start: tempStart, end: sortedDays[i - 1] };
      }
      current = 1;
      tempStart = sortedDays[i];
    }
  }

  if (current > longest) {
    longest = current;
    bestRange = { start: tempStart, end: sortedDays[sortedDays.length - 1] };
  }

  return {
    longest,
    range: bestRange
  };
}
