import { Parser } from './parser.js';

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

const normaliseArray = Parser.normaliseArray || Parser.normalizeArray;

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
    const cleaned = typeof normaliseArray === 'function' ? normaliseArray(messages) : [];

    if (!cleaned.length) {
      throw new Error('未找到可用于统计的 user/assistant 文本；请检查导出格式。');
    }

    parser.setStopWords(stopWords);

    const analysis = await parser.parse(cleaned, { overrides, stopWords });
    const keywords = Array.isArray(analysis.keywords) ? analysis.keywords.slice(0, 100) : [];
    const stats = { ...analysis, keywords };

    const meta = {
      messageCount: cleaned.length,
      roleCounts: (analysis.roleStats || []).map(({ role, messageCount }) => ({
        role,
        messageCount
      })),
      generatedAt: Date.now()
    };

    self.postMessage({ type: 'result', requestId, stats, meta });
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      message: error?.message || '解析失败，请重试。'
    });
  }
});
