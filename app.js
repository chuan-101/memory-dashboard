import { Dashboard } from './dashboard.js';
import { ThemeManager } from './themeManager.js';

const NAME_STORAGE_KEY = 'memory-dashboard-name-overrides';
const STOP_WORD_STORAGE_KEY = 'memory-dashboard-stopwords';

function printDebug(candidates) {
  if (typeof location === 'undefined' || !location.search.includes('debug=1')) {
    return;
  }
  if (typeof document === 'undefined') {
    return;
  }
  const dbg = document.getElementById('debug');
  if (!dbg) {
    return;
  }
  const sample3 = candidates.slice(0, 3).map(x => ({
    role: x?.author?.role ?? x?.role ?? 'none',
    hasParts: Array.isArray(x?.content?.parts),
    contentType: typeof x?.content
  }));
  const roleMap = candidates.reduce((m, x) => {
    const r = x?.author?.role ?? x?.role ?? 'none';
    m[r] = (m[r] || 0) + 1;
    return m;
  }, {});
  dbg.hidden = false;
  dbg.textContent =
    '[extract] total=' + candidates.length +
    '  roles=' + JSON.stringify(roleMap) + '\n' +
    JSON.stringify(sample3, null, 2);
}

export class App {
  constructor() {
    this.fileInput = document.getElementById('fileInput');
    this.statusElement = document.getElementById('status');
    this.dashboardElement = document.getElementById('dashboard');
    this.themeSelect = document.getElementById('themeSelect');
    this.lightModeToggle = document.getElementById('lightModeToggle');
    this.lightModeHint = document.getElementById('lightModeHint');
    this.nameForm = document.getElementById('nameOverrides');
    this.userNameInput = document.getElementById('userName');
    this.assistantNameInput = document.getElementById('assistantName');
    this.stopWordsInput = document.getElementById('stopWords');
    this.toastLayer = document.getElementById('toastLayer');

    this.themeManager = new ThemeManager(this.themeSelect);
    this.dashboard = new Dashboard({ themeManager: this.themeManager });
    this.worker = null;
    this.processingToast = null;
    this.toast = null;
    this.spinner = null;
    this.activeMessages = [];
    this.activeRawMessages = null;
    this.lastAnalysis = null;
    this.lastMeta = null;
    this.lightMode = true;
    this.isProcessing = false;

    this.handleThemeChange = this.handleThemeChange.bind(this);
    this.handleLightModeToggle = this.handleLightModeToggle.bind(this);
  }

  init() {
    this.debugElement = document.getElementById('debug');
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search || '');
      this.debugEnabled = params.get('debug') === '1';
    }
    if (this.debugElement) {
      this.debugElement.hidden = !this.debugEnabled;
      if (!this.debugEnabled) {
        this.debugElement.textContent = '';
      }
    }

    this.themeManager.init();
    this.themeManager.onChange(this.handleThemeChange);
    this.loadPreferences();

    this.setupWorker();

    if (this.fileInput) {
      this.fileInput.addEventListener('change', event => this.handleFileSelection(event));
    }

    if (this.lightModeToggle) {
      this.lightModeToggle.checked = true;
      this.lightModeToggle.addEventListener('change', this.handleLightModeToggle);
    }
    this.setLightMode(this.lightModeToggle ? this.lightModeToggle.checked : true, { skipRender: true });

    if (this.nameForm) {
      this.nameForm.addEventListener('submit', event => this.handlePreferenceSubmit(event));
    }
  }

  async handleFileSelection(evt) {
    const file = evt.target.files?.[0];
    if (!file) {
      return;
    }

    if (file.type && file.type !== 'application/json') {
      this.updateStatus('error', '请选择 JSON 格式的文件。');
      return;
    }

    try {
      const text = await file.text();
      const raw = JSON.parse(text);

      const candidates = this.extractMessages(raw);
      printDebug(candidates);

      this.activeMessages = [];
      this.lastAnalysis = null;

      if (!candidates.length) {
        throw new Error('未找到可用于统计的消息，请确认文件内容。');
      }

      this.activeRawMessages = candidates;
      this.lastAnalysis = null;
      this.lastMeta = null;
      this.dashboardElement.hidden = true;

      await this.requestAnalysis(candidates, {
        overrides: this.getNameOverrides(),
        stopWords: this.getStopWords()
      });
    } catch (error) {
      console.error(error);
      this.updateStatus('error', error.message || '解析文件失败。');
      this.dashboardElement.hidden = true;
      this.hideProcessingToast();
    }
  }

  async refreshDashboard() {
    if (!this.activeRawMessages || !this.activeRawMessages.length) {
      this.updateStatus('error', '没有可用于渲染的数据。');
      this.dashboardElement.hidden = true;
      return;
    }

    if (this.activeMessages.length < 4) {
      this.updateStatus('error', '消息数量不足，至少需要 4 条消息才能生成仪表盘。');
      this.dashboardElement.hidden = true;
      return;
    }

    const overrides = this.getNameOverrides();
    const stopWords = this.getStopWords();

    try {
      await this.requestAnalysis(this.activeRawMessages, { overrides, stopWords });
    } catch (error) {
      console.error(error);
      this.updateStatus('error', error.message || '生成分析数据失败。');
      this.dashboardElement.hidden = true;
      this.hideProcessingToast();
    }
  }

  handlePreferenceSubmit(event) {
    event.preventDefault();
    this.persistPreferences();
    this.updateStatus('success', '偏好已保存。');
    if (this.activeRawMessages?.length) {
      this.refreshDashboard();
    }
  }

  loadPreferences() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    try {
      const nameConfig = JSON.parse(window.localStorage.getItem(NAME_STORAGE_KEY) || '{}');
      if (nameConfig.user && this.userNameInput) {
        this.userNameInput.value = nameConfig.user;
      }
      if (nameConfig.assistant && this.assistantNameInput) {
        this.assistantNameInput.value = nameConfig.assistant;
      }

      const stopWords = window.localStorage.getItem(STOP_WORD_STORAGE_KEY);
      if (stopWords && this.stopWordsInput) {
        this.stopWordsInput.value = stopWords;
      }
    } catch (error) {
      console.warn('读取偏好失败：', error);
    }
  }

  persistPreferences() {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }

    const overrides = this.getNameOverrides();
    const stopWords = this.stopWordsInput?.value || '';

    try {
      window.localStorage.setItem(NAME_STORAGE_KEY, JSON.stringify(overrides));
      window.localStorage.setItem(STOP_WORD_STORAGE_KEY, stopWords);
    } catch (error) {
      console.warn('保存偏好失败：', error);
    }
  }

  handleThemeChange() {
    this.dashboard.updateTheme();
  }

  handleLightModeToggle(event) {
    const enabled = !!event.target.checked;
    this.setLightMode(enabled);
  }

  setLightMode(enabled, { skipRender = false } = {}) {
    this.lightMode = !!enabled;
    if (this.lightModeHint) {
      this.lightModeHint.hidden = !this.lightMode;
    }
    if (typeof document !== 'undefined' && document.body) {
      document.body.dataset.lightMode = this.lightMode ? 'on' : 'off';
    }
    this.dashboard.setLightMode?.(this.lightMode);

    if (!skipRender && this.lastAnalysis) {
      this.dashboard.render(this.lastAnalysis);
      this.dashboardElement.hidden = false;
    }
  }

  getNameOverrides() {
    const overrides = {};
    const userName = this.userNameInput?.value.trim();
    const assistantName = this.assistantNameInput?.value.trim();

    if (userName) {
      overrides.user = userName;
    }
    if (assistantName) {
      overrides.assistant = assistantName;
    }
    return overrides;
  }

  getStopWords() {
    const raw = this.stopWordsInput?.value || '';
    return raw
      .split(/[\n,]/)
      .map(item => item.trim())
      .filter(Boolean);
  }

  // app.js — robust extractor that always pushes the real "message"
  extractMessages(raw) {
    const out = [];

    const collect = msg => {
      if (!msg) return;
      // 真正的消息对象通常具备 author/content 或 role/content
      const hasAuthor = !!(msg.author && typeof msg.author.role === 'string');
      const hasRole = typeof msg.role === 'string';
      const hasContent = msg.content !== undefined;
      if (hasAuthor || hasRole || hasContent) out.push(msg);
    };

    const walk = v => {
      if (!v) return;
      if (Array.isArray(v)) {
        v.forEach(walk);
        return;
      }
      if (typeof v !== 'object') return;

      // 1) 最常见容器：mapping
      if (v.mapping && typeof v.mapping === 'object') {
        Object.values(v.mapping).forEach(n => {
          if (n && n.message) collect(n.message);
        });
      }

      // 2) items/messages 等数组容器
      if (Array.isArray(v.items)) {
        v.items.forEach(it => {
          if (it && it.message) collect(it.message);
          else walk(it);
        });
      }
      if (Array.isArray(v.messages)) {
        v.messages.forEach(m => {
          if (m && m.message) collect(m.message);
          else collect(m); // some exports are already flat
        });
      }
      if (Array.isArray(v.conversations)) {
        v.conversations.forEach(walk);
      }

      // 3) 当前对象本身若含有 message，就收集 message
      if (v.message && (v.message.author || v.message.role || v.message.content)) {
        collect(v.message);
      }

      // 4) 当前对象若本身就像消息，也直接收集
      if (v.author || v.role || v.content) {
        collect(v);
      }

      // 5) 兜底：继续向下递归
      Object.values(v).forEach(child => {
        if (child && typeof child === 'object') walk(child);
      });
    };

    walk(raw);
    return out;
  }


  validateMessages(raw) {
    return this.extractMessages(raw);
  }

  setupWorker() {
    if (typeof Worker === 'undefined') {
      console.warn('当前环境不支持 Web Worker。');
      this.updateStatus('error', '当前浏览器不支持 Web Worker，无法执行解析。');
      return;
    }

    try {
      this.worker = new Worker('worker.js');
      this.worker.onmessage = event => this.handleWorkerMessage(event?.data);
      this.worker.onerror = error => this.handleWorkerError(error);
      this.worker.onmessageerror = error => this.handleWorkerError(error);
    } catch (error) {
      console.error('创建 Web Worker 失败：', error);
      this.worker = null;
      this.updateStatus('error', '初始化后台解析失败，请刷新页面或更换浏览器。');
    }
  }

  async requestAnalysis(messages, { overrides = {}, stopWords = [] } = {}) {
    if (!this.worker) {
      throw new Error('后台解析未就绪。');
    }

    this.isProcessing = true;
    this.showProcessingToast();

    this.worker.postMessage({
      type: 'process',
      payload: {
        messages,
        options: {
          overrides,
          stopWords
        }
      }
    });

    this.updateStatus('info', '正在后台处理中，请稍候…');
  }

  handleWorkerMessage(payload) {
    const data = payload && payload.data ? payload.data : payload;
    if (!data) {
      return;
    }

    this.isProcessing = false;
    this.hideProcessingToast();
    this.toast?.clear?.();
    this.toast = null;
    this.spinner?.stop?.();
    this.spinner = null;

    if (data.ok) {
      this.lastAnalysis = data.stats || null;
      this.lastMeta = null;

      if (this.lastAnalysis) {
        this.activeMessages = Array.isArray(this.lastAnalysis.messages)
          ? this.lastAnalysis.messages
          : [];
        this.dashboard.setLightMode?.(this.lightMode);
        this.dashboard.render(this.lastAnalysis);
        this.dashboardElement.hidden = false;
        const messageCount = this.activeMessages.length;
        this.updateStatus('success', `成功导入 ${messageCount} 条消息。`);
        return;
      }

      this.dashboardElement.hidden = true;
      this.updateStatus('error', '生成分析数据失败。');
    } else if (data.error) {
      this.lastAnalysis = null;
      this.lastMeta = null;
      this.activeMessages = [];
      this.dashboardElement.hidden = true;
      const errorMessage = data.error || '生成分析数据失败。';
      this.showError(errorMessage);
    }
  }

  handleWorkerError(event) {
    console.error('Worker failed:', event);
    this.isProcessing = false;
    this.hideProcessingToast();
    this.toast?.clear?.();
    this.toast = null;
    this.spinner?.stop?.();
    this.spinner = null;
    this.lastAnalysis = null;
    this.lastMeta = null;
    this.activeMessages = [];
    this.dashboardElement.hidden = true;
    const reason =
      event?.message ||
      event?.error?.message ||
      event?.data?.error ||
      '未知错误';
    this.showError('解析失败：' + reason);
  }

  showProcessingToast() {
    if (this.processingToast || !this.toastLayer) {
      return;
    }

    this.processingToast = this.showToast('Processing…', {
      title: '后台处理中',
      variant: 'info',
      autoHide: false
    });
  }

  hideProcessingToast() {
    if (this.processingToast && typeof this.processingToast.remove === 'function') {
      this.processingToast.remove();
    }
    this.processingToast = null;
  }

  showError(message) {
    const finalMessage = message || '解析失败：未知错误';
    this.updateStatus('error', finalMessage);
    if (!this.toastLayer) {
      this.toast = null;
      return;
    }
    this.toast?.clear?.();
    this.toast = this.showToast(finalMessage, {
      title: '解析失败',
      variant: 'error'
    });
  }

  showToast(message, { title = '', variant = 'info', autoHide = 3200 } = {}) {
    if (!this.toastLayer || !message) {
      return null;
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    if (variant === 'error') {
      toast.classList.add('toast--error');
    } else if (variant === 'success') {
      toast.classList.add('toast--success');
    }

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'toast__title';
      titleEl.textContent = title;
      toast.appendChild(titleEl);
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'toast__message';
    messageEl.textContent = message;
    toast.appendChild(messageEl);

    this.toastLayer.appendChild(toast);

    let timeoutId = null;
    if (autoHide !== false) {
      const duration = typeof autoHide === 'number' ? autoHide : 3200;
      timeoutId = setTimeout(() => {
        toast.remove();
      }, duration);
    }

    const clear = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      toast.remove();
    };

    return {
      element: toast,
      remove: clear,
      clear
    };
  }

  updateStatus(type, message) {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.className = `status ${type}`;
  }
}
