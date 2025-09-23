const DEFAULT_STOP_WORDS = [
  '的', '了', '和', '是', '在', '我', '你', '我们', '他们', '它', '这', '那', '一个', '以及',
  'with', 'the', 'and', 'for', 'this', 'that', 'are', 'was', 'were', 'from', 'your', 'have',
  'has', 'will', 'would', 'could', 'should', 'can', 'about', 'into', 'over', 'after'
];

const ROLE_DEFAULT_NAMES = {
  assistant: 'Assistant',
  user: 'User',
  system: 'System',
  tool: 'Tool'
};

export function normalizeMessage(m) {
  if (!m || typeof m !== 'object') {
    return null;
  }

  const roleValue =
    m.role ??
    m.author?.role ??
    m.author_role ??
    (typeof m.author === 'string' ? m.author : null) ??
    m.message?.author?.role ??
    m.participant ??
    m.sender ??
    null;
  const role = typeof roleValue === 'string' ? roleValue.trim().toLowerCase() : '';

  const pickText = value => {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      for (const part of value) {
        const extracted = pickText(part);
        if (extracted) {
          return extracted;
        }
      }
      return '';
    }
    if (typeof value !== 'object') {
      return '';
    }

    if (typeof value.text === 'string') return value.text;
    if (typeof value.value === 'string') return value.value;
    if (typeof value.content === 'string') return value.content;
    if (typeof value.message === 'string') return value.message;
    if (typeof value.caption === 'string') return value.caption;
    if (typeof value.data === 'string') return value.data;
    if (typeof value.arguments === 'string') return value.arguments;
    if (typeof value.body === 'string') return value.body;
    if (typeof value.delta === 'string') return value.delta;
    if (typeof value.text?.value === 'string') return value.text.value;
    if (typeof value.content?.value === 'string') return value.content.value;
    if (typeof value.message?.value === 'string') return value.message.value;
    if (typeof value.text?.content === 'string') return value.text.content;
    if (typeof value.message?.content === 'string') return value.message.content;

    if (Array.isArray(value.parts)) {
      const nested = pickText(value.parts);
      if (nested) return nested;
    }

    if (Array.isArray(value.content)) {
      const nested = pickText(value.content);
      if (nested) return nested;
    }

    if (Array.isArray(value.messages)) {
      const nested = pickText(value.messages);
      if (nested) return nested;
    }

    if (Array.isArray(value.values)) {
      const nested = pickText(value.values);
      if (nested) return nested;
    }

    if (value.delta && typeof value.delta === 'object') {
      const nested = pickText(value.delta.content ?? value.delta.parts ?? value.delta.text ?? value.delta.value);
      if (nested) return nested;
    }

    return '';
  };

  const contentCandidates = [
    m.content?.parts,
    m.content,
    m.parts,
    m.text,
    m.value,
    m.delta?.content,
    m.delta,
    m.message?.content?.parts,
    m.message?.content,
    m.message?.parts,
    m.message?.text,
    m.message?.value
  ];

  let text = '';
  for (const candidate of contentCandidates) {
    text = pickText(candidate);
    if (text) {
      break;
    }
  }

  text = (text || '').replace(/\s+/g, ' ').trim();

  if (!role || (role !== 'user' && role !== 'assistant')) {
    return null;
  }

  if (text.length < 2) {
    return null;
  }

  const ts =
    m.create_time ??
    m.createTime ??
    m.timestamp ??
    m.message?.create_time ??
    m.message?.timestamp ??
    null;
  const model =
    m.model ??
    m.metadata?.model ??
    m.message?.metadata?.model ??
    null;

  return { role, text, ts, model };
}

export function normaliseArray(arr) {
  return (arr || []).map(normalizeMessage).filter(Boolean);
}

export { normaliseArray as normalizeArray };

export class Parser {
  constructor({ stopWords = [] } = {}) {
    this.stopWords = new Set();
    this.setStopWords(stopWords);
    this.currentOverrides = {};
    this.jiebaReady = null;
  }

  static normaliseArray(arr) {
    return normaliseArray(arr);
  }

  static normalizeArray(arr) {
    return normaliseArray(arr);
  }

  setStopWords(words = []) {
    this.stopWords.clear();
    [...DEFAULT_STOP_WORDS, ...words]
      .map(word => (word || '').toString().trim().toLowerCase())
      .filter(Boolean)
      .forEach(word => this.stopWords.add(word));
  }

  async parse(messages, { overrides = {}, stopWords = [] } = {}) {
    if (!Array.isArray(messages)) {
      throw new Error('JSON 数据格式不正确，缺少消息数组。');
    }

    if (stopWords.length) {
      this.setStopWords(stopWords);
    }

    this.currentOverrides = overrides || {};

    const prepared = this.prepareMessages(messages);

    if (!prepared.length) {
      throw new Error('未找到可解析的消息文本内容。');
    }

    const roleMessages = {
      assistant: this.filterAssistantMessages(prepared),
      user: this.filterUserMessages(prepared)
    };

    const roleStats = this.computeRoleStats(prepared);
    const monthlyHistogram = this.computeMonthlyHistogram(prepared);
    const hourlyHistogram = this.computeHourlyHistogram(prepared);
    const weekdayHistogram = this.computeWeekdayHistogram(prepared);
    const modelDistribution = this.computeModelDistribution(prepared);
    const dailyTrend = this.computeDailyTrend(prepared);
    const earliestMessage = this.computeEarliestMessage(prepared);
    const streak = this.computeStreak(prepared);
    const peakHour = this.computePeakHour(hourlyHistogram);
    const keywords = await this.extractTopKeywords(prepared);

    return {
      messages: prepared,
      roleMessages,
      roleStats,
      monthlyHistogram,
      hourlyHistogram,
      weekdayHistogram,
      modelDistribution,
      dailyTrend,
      earliestMessage,
      streak,
      peakHour,
      keywords
    };
  }

  prepareMessages(messages) {
    if (!Array.isArray(messages)) {
      return [];
    }

    const looksNormalised = messages.every(
      message =>
        message &&
        typeof message === 'object' &&
        typeof message.role === 'string' &&
        typeof message.text === 'string'
    );

    const baseArray = looksNormalised ? messages : Parser.normaliseArray(messages);

    return baseArray
      .map(entry => this.composeMessage(entry))
      .filter(Boolean);
  }

  composeMessage(entry) {
    if (!entry || typeof entry !== 'object') {
      return null;
    }

    const role = (entry.role || '').toString().trim().toLowerCase();
    if (!role || (role !== 'assistant' && role !== 'user')) {
      return null;
    }

    const text = typeof entry.text === 'string' ? entry.text : String(entry.text ?? '');
    if (text.replace(/\s+/g, '').length < 2) {
      return null;
    }

    const timestamp = this.resolveTimestamp(entry);
    const model = this.resolveModel(entry);
    const wordCount = Number.isFinite(entry.wordCount) ? entry.wordCount : this.countWords(text);
    const dayKey = timestamp ? this.formatDate(timestamp) : null;
    const formattedTime = timestamp ? this.formatDate(timestamp, { includeTime: true }) : null;
    const raw = entry.raw ?? entry.__raw ?? null;

    const idCandidate =
      entry.id ||
      entry.message_id ||
      entry.uuid ||
      raw?.id ||
      raw?.message_id ||
      raw?.uuid;

    return {
      id:
        idCandidate ||
        `${role}-${timestamp || Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      displayRole: this.getDisplayName(role),
      text,
      timestamp,
      model,
      wordCount,
      dayKey,
      formattedTime,
      raw
    };
  }

  filterByRole(messages, role) {
    const targetRole = (role || '').toLowerCase();
    return messages
      .filter(message => (message.role || '').toLowerCase() === targetRole)
      .map(message => ({ ...message, displayRole: this.getDisplayName(message.role) }));
  }

  filterAssistantMessages(messages) {
    return this.filterByRole(messages, 'assistant');
  }

  filterUserMessages(messages) {
    return this.filterByRole(messages, 'user');
  }

  computeRoleStats(messages) {
    const stats = new Map();

    messages.forEach(message => {
      const roleKey = message.role || 'unknown';
      if (!stats.has(roleKey)) {
        stats.set(roleKey, {
          role: roleKey,
          displayRole: this.getDisplayName(roleKey),
          messageCount: 0,
          wordCount: 0
        });
      }

      const roleStat = stats.get(roleKey);
      roleStat.messageCount += 1;
      roleStat.wordCount += message.wordCount;
    });

    return Array.from(stats.values()).sort((a, b) => b.messageCount - a.messageCount);
  }

  computeMonthlyHistogram(messages) {
    const monthlyMap = new Map();

    messages.forEach(message => {
      if (!message.timestamp) return;
      const monthKey = this.formatDate(message.timestamp, { monthOnly: true });
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, 0);
      }
      monthlyMap.set(monthKey, monthlyMap.get(monthKey) + 1);
    });

    const entries = Array.from(monthlyMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    return {
      labels: entries.map(entry => entry[0]),
      data: entries.map(entry => entry[1])
    };
  }

  computeHourlyHistogram(messages) {
    const hours = Array.from({ length: 24 }, (_, index) => ({ hour: index, count: 0 }));

    messages.forEach(message => {
      if (!message.timestamp) return;
      const hour = new Date(message.timestamp).getHours();
      hours[hour].count += 1;
    });

    return {
      labels: hours.map(entry => `${entry.hour}:00`),
      data: hours.map(entry => entry.count)
    };
  }

  computeWeekdayHistogram(messages) {
    const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const counts = Array(7).fill(0);

    messages.forEach(message => {
      if (!message.timestamp) return;
      const weekday = new Date(message.timestamp).getDay();
      counts[weekday] += 1;
    });

    return {
      labels: weekdayNames,
      data: counts
    };
  }

  computeModelDistribution(messages) {
    const modelMap = new Map();

    messages.forEach(message => {
      const modelLabel = (message.model || 'unknown').toString();
      const key = modelLabel.toLowerCase();
      if (!modelMap.has(key)) {
        modelMap.set(key, { label: modelLabel, count: 0 });
      }
      const entry = modelMap.get(key);
      entry.count += 1;
      if (entry.label === 'unknown' && modelLabel !== 'unknown') {
        entry.label = modelLabel;
      }
    });

    const entries = Array.from(modelMap.values()).sort((a, b) => b.count - a.count);
    return {
      labels: entries.map(entry => entry.label),
      data: entries.map(entry => entry.count)
    };
  }

  computeDailyTrend(messages) {
    const dayMap = new Map();

    messages.forEach(message => {
      if (!message.timestamp) return;
      const dayKey = this.formatDate(message.timestamp);
      if (!dayMap.has(dayKey)) {
        dayMap.set(dayKey, 0);
      }
      dayMap.set(dayKey, dayMap.get(dayKey) + 1);
    });

    const entries = Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    return {
      labels: entries.map(entry => entry[0]),
      data: entries.map(entry => entry[1])
    };
  }

  computeEarliestMessage(messages) {
    const sorted = messages
      .filter(message => !!message.timestamp)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!sorted.length) {
      return null;
    }

    const first = sorted[0];
    return {
      date: new Date(first.timestamp),
      formatted: this.formatDate(first.timestamp, { includeTime: true }),
      role: this.getDisplayName(first.role)
    };
  }

  computeStreak(messages) {
    const daySet = new Set(
      messages
        .filter(message => !!message.timestamp)
        .map(message => this.formatDate(message.timestamp))
    );

    if (!daySet.size) {
      return { longest: 0, range: null };
    }

    const sortedDays = Array.from(daySet)
      .sort((a, b) => a.localeCompare(b))
      .map(day => new Date(day));

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

  computePeakHour(hourlyHistogram) {
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

  async extractTopKeywords(messages) {
    const tokens = [];

    for (const message of messages) {
      const words = await this.tokenize(message.text || '');
      words
        .map(word => word.trim().toLowerCase())
        .filter(word => word && !this.stopWords.has(word) && word.length > 1)
        .forEach(word => tokens.push(word));
    }

    if (!tokens.length) {
      return [];
    }

    const frequencies = tokens.reduce((map, token) => {
      map.set(token, (map.get(token) || 0) + 1);
      return map;
    }, new Map());

    const sorted = Array.from(frequencies.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 120);

    const maxFrequency = sorted[0]?.[1] || 1;

    return sorted.map(([word, weight]) => ({
      word,
      weight,
      normalizedWeight: weight / maxFrequency
    }));
  }

  async tokenize(text) {
    if (!text) {
      return [];
    }

    const hasJieba = await this.ensureJieba();
    if (hasJieba) {
      try {
        const result = window.jieba.cut(text, false);
        if (Array.isArray(result)) {
          return result;
        }
      } catch (error) {
        console.warn('使用 jieba 分词失败，使用回退策略。', error);
      }
    }

    const fallback = text
      .toLowerCase()
      .match(/\p{L}+[\p{M}]*/gu);

    if (fallback) {
      return fallback;
    }

    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  async ensureJieba() {
    if (this.jiebaReady !== null) {
      return this.jiebaReady;
    }

    if (typeof window === 'undefined' || typeof window.jieba === 'undefined') {
      this.jiebaReady = false;
      return this.jiebaReady;
    }

    if (typeof window.jieba.load === 'function') {
      try {
        await window.jieba.load();
      } catch (error) {
        console.warn('加载 jieba 词典失败。', error);
      }
    }

    this.jiebaReady = typeof window.jieba.cut === 'function';
    return this.jiebaReady;
  }

  normalizeMessage(raw) {
    if (!raw || typeof raw !== 'object') {
      return null;
    }

    const coreFields = this.normalizeCoreFields(raw);
    if (!coreFields) {
      return null;
    }

    const { role: baseRole, text } = coreFields;
 main
    const role = this.getRole({ ...raw, role: baseRole });
    const timestamp = this.extractTimestamp(raw);
    const model = this.extractModel(raw);
    const wordCount = this.countWords(text);
    const dayKey = timestamp ? this.formatDate(timestamp) : null;
    const formattedTime = timestamp
      ? this.formatDate(timestamp, { includeTime: true })
      : null;

    return {
      id: raw.id || raw.message_id || raw.uuid || `${role}-${timestamp || Date.now()}`,
      role,
      displayRole: this.getDisplayName(role),
      text,
      timestamp,
      model,
      wordCount,
      dayKey,
      formattedTime,
      raw
    };
  }

  normalizeCoreFields(msg) {
    const role =
      msg?.role ??
      msg?.author?.role ??
      msg?.author_role ??
      (typeof msg?.author === 'string' ? msg.author : null) ??
      msg?.participant ??
      msg?.sender ??
      'unknown';

    let text = '';

    if (Array.isArray(msg?.content?.parts)) {
      text = msg.content.parts
        .map(part => {
          if (typeof part === 'string') return part;
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.content === 'string') return part.content;
          if (typeof part?.value === 'string') return part.value;
          return '';
        })
        .join(' ')
        .trim();
    } else if (typeof msg?.content?.parts === 'string') {
      text = msg.content.parts;
    }

    if (!text && typeof msg?.content === 'string') {
      text = msg.content;
    }

    if (!text && typeof msg?.content?.text === 'string') {
      text = msg.content.text;
    }

    if (!text && typeof msg?.content?.value === 'string') {
      text = msg.content.value;
    }

    if (!text && typeof msg?.content?.content === 'string') {
      text = msg.content.content;
    }

    if (!text) {
      text = this.extractText(msg);
    }

    const normalizedRole = (role ?? '').toString().trim();
    if (!normalizedRole) {
      throw new Error('消息结构不完整，无法解析 role 或 content。');
    }

    if (typeof text === 'string') {
      text = text.trim();
    } else if (text == null) {
      text = '';
    } else {
      text = `${text}`.trim();
    }

    if (!text) {
      return { role: normalizedRole, text: '' };
    }

    return { role: normalizedRole, text };
 main
  }

  getRole(message) {
    const role =
      message.role ||
      message?.author?.role ||
      message.author_role ||
      (typeof message.author === 'string' ? message.author : null) ||
      message.participant ||
      message.sender ||
      'unknown';

    return (role || 'unknown').toString().toLowerCase();
  }

  extractText(message) {
    if (Array.isArray(message?.content?.parts)) {
      const combined = message.content.parts
        .map(part => {
          if (typeof part === 'string') return part;
          if (typeof part?.text === 'string') return part.text;
          if (typeof part?.content === 'string') return part.content;
          if (typeof part?.value === 'string') return part.value;
          return '';
        })
        .join(' ')
        .trim();

      if (combined) {
        return combined;
      }
    }

    if (typeof message?.content?.parts === 'string') {
      return message.content.parts;
    }

    if (typeof message?.content?.text === 'string') {
      return message.content.text;
    }

    if (typeof message?.content?.value === 'string') {
      return message.content.value;
    }

    if (typeof message?.content?.content === 'string') {
      return message.content.content;
    }

    if (typeof message.content === 'string') {
      return message.content;
    }

    if (Array.isArray(message.content)) {
      return message.content
        .map(part => {
          if (typeof part === 'string') return part;
          if (part?.text) return part.text;
          if (part?.content) return part.content;
          if (part?.value) return part.value;
          return '';
        })
        .join(' ');
    }

    if (message?.message?.content) {
      return this.extractText(message.message);
    }

    if (message?.body) {
      return this.extractText({ content: message.body });
    }

    if (message?.text) {
      return message.text;
    }

    return '';
  }

  extractTimestamp(message) {
    const timeValue =
      message.timestamp ||
      message.create_time ||
      message.created_at ||
      message.created ||
      message.time ||
      message.date ||
      message?.meta?.created_at ||
      message?.metadata?.created_at;

    return this.normalizeTimestampValue(timeValue);
  }

  extractModel(message) {
    const model =
      message.model ||
      message?.metadata?.model ||
      message?.meta?.model ||
      message?.response_metadata?.model ||
      message?.raw_model ||
      'unknown';

    return model.toString();
  }

  resolveTimestamp(entry) {
    const direct = this.normalizeTimestampValue(entry.timestamp ?? entry.ts ?? null);
    if (direct !== null && direct !== undefined) {
      return direct;
    }

    if (entry.raw) {
      const extracted = this.extractTimestamp(entry.raw);
      if (extracted !== null && extracted !== undefined) {
        return extracted;
      }
    }

    return null;
  }

  resolveModel(entry) {
    const value = entry.model ?? (entry.raw ? this.extractModel(entry.raw) : null);
    if (value == null) {
      return 'unknown';
    }
    return value.toString();
  }

  normalizeTimestampValue(value) {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 10 ** 12 ? value * 1000 : value;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }

      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        return this.normalizeTimestampValue(numeric);
      }

      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.getTime();
    }

    return null;
  }

  countWords(text) {
    if (!text) {
      return 0;
    }

    const words = text
      .toLowerCase()
      .match(/\p{L}+[\p{M}]*/gu);

    if (words) {
      return words.length;
    }

    const withoutWhitespace = text.replace(/\s+/g, '');
    return withoutWhitespace.length;
  }

  getDisplayName(role) {
    const normalizedRole = (role || 'unknown').toLowerCase();
    return (
      this.currentOverrides[normalizedRole] ||
      this.currentOverrides[role] ||
      ROLE_DEFAULT_NAMES[normalizedRole] ||
      role ||
      'unknown'
    );
  }

  formatDate(timestamp, { includeTime = false, monthOnly = false } = {}) {
    if (!timestamp) {
      return '';
    }

    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');

    if (monthOnly) {
      return `${year}-${month}`;
    }

    if (!includeTime) {
      return `${year}-${month}-${day}`;
    }

    const hour = `${date.getHours()}`.padStart(2, '0');
    const minute = `${date.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
}
