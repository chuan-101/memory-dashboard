/* worker.js — classic worker */
self.importScripts('vendor/jieba.min.js');

function loadParserModule() {
  const request = new XMLHttpRequest();
  request.open('GET', 'parser.js', false);

  try {
    request.send(null);
  } catch (error) {
    const reason = error && error.message ? error.message : String(error || '');
    throw new Error(`无法加载 parser.js：${reason}`);
  }

  if (request.status < 200 || request.status >= 300) {
    const statusText = request.statusText ? ` ${request.statusText}` : '';
    throw new Error(`加载 parser.js 失败：${request.status}${statusText}`);
  }

  const sanitizedSource = request.responseText
    .replace(/export\s+class\s+/g, 'class ')
    .replace(/export\s+function\s+/g, 'function ')
    .replace(/export\s*\{[^}]+\};?/g, '');

  const suffix =
    '\nconst normalizeArrayAlias = typeof normaliseArray !== \"undefined\" ? normaliseArray : undefined;\n' +
    'return {\n' +
    '  Parser: typeof Parser !== \"undefined\" ? Parser : undefined,\n' +
    '  normalizeMessage: typeof normalizeMessage !== \"undefined\" ? normalizeMessage : undefined,\n' +
    '  normaliseArray: typeof normaliseArray !== \"undefined\" ? normaliseArray : undefined,\n' +
    '  normalizeArray: typeof normalizeArrayAlias !== \"undefined\" ? normalizeArrayAlias : undefined\n' +
    '};\n';

  const factorySource = `${sanitizedSource}\n${suffix}`;
  return new Function(factorySource)();
}

let parserInitError = null;
let parserInstance = null;
let normaliseArrayFn = null;

try {
  const parserModule = loadParserModule();
  if (!parserModule || typeof parserModule.Parser !== 'function') {
    throw new Error('Parser 模块不可用。');
  }

  parserInstance = new parserModule.Parser();
  normaliseArrayFn =
    parserModule.normaliseArray ||
    parserModule.normalizeArray ||
    parserModule.Parser?.normaliseArray ||
    parserModule.Parser?.normalizeArray;
} catch (error) {
  parserInitError = error;
}

function normaliseMessages(messages) {
  const fallback = value => (Array.isArray(value) ? value : []);
  const normaliser =
    typeof normaliseArrayFn === 'function'
      ? normaliseArrayFn
      : parserInstance?.constructor?.normaliseArray ||
        parserInstance?.constructor?.normalizeArray ||
        fallback;

  try {
    return normaliser(messages);
  } catch (error) {
    return fallback(messages);
  }
}

self.onmessage = async event => {
  const message = event && event.data;
  if (!message || message.type !== 'process') {
    return;
  }

  if (parserInitError) {
    self.postMessage({
      ok: false,
      error: parserInitError.message || String(parserInitError)
    });
    return;
  }

  if (!parserInstance || typeof parserInstance.parse !== 'function') {
    self.postMessage({
      ok: false,
      error: '解析器未初始化。'
    });
    return;
  }

  const { messages = [], options = {} } = message.payload || {};
  const overrides = options.overrides || {};
  const stopWords = options.stopWords || [];

  try {
    const cleaned = normaliseMessages(messages);

    if (!Array.isArray(cleaned) || !cleaned.length) {
      throw new Error('未找到可用于统计的 user/assistant 文本；请检查导出格式。');
    }

    if (typeof parserInstance.setStopWords === 'function') {
      parserInstance.setStopWords(stopWords);
    }

    const analysis = await parserInstance.parse(cleaned, { overrides, stopWords });
    const keywords = Array.isArray(analysis.keywords) ? analysis.keywords.slice(0, 100) : [];
    const stats = { ...analysis, keywords };

    self.postMessage({ ok: true, stats });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: (error && error.message) || '解析失败，请重试。'
    });
  }
};
