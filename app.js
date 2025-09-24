import { Parser } from './parser.js';
import { Dashboard } from './dashboard.js';
import { ThemeManager } from './themeManager.js';

const NAME_STORAGE_KEY = 'memory-dashboard-name-overrides';
const STOP_WORD_STORAGE_KEY = 'memory-dashboard-stopwords';

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

    this.parser = new Parser();
    this.themeManager = new ThemeManager(this.themeSelect);
    this.dashboard = new Dashboard({ themeManager: this.themeManager });

    this.activeMessages = null;
    this.lastAnalysis = null;
    this.lightMode = true;

    this.handleThemeChange = this.handleThemeChange.bind(this);
    this.handleLightModeToggle = this.handleLightModeToggle.bind(this);
  }

  init() {
    this.themeManager.init();
    this.themeManager.onChange(this.handleThemeChange);
    this.loadPreferences();

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

      const dbg = document.getElementById('debug');
      const sample = candidates.slice(0, 3).map(x => ({
        role: x?.author?.role ?? x?.role,
        hasParts: Array.isArray(x?.content?.parts),
        contentType: typeof x?.content
      }));
      dbg.hidden = false;
      dbg.textContent =
        '[extract] total=' +
        candidates.length +
        '  roles=' +
        JSON.stringify(
          candidates.reduce((m, x) => {
            const r = x?.author?.role ?? x?.role ?? 'none';
            m[r] = (m[r] || 0) + 1;
            return m;
          }, {})
        ) +
        '\n' +
        JSON.stringify(sample, null, 2);

      const normaliseArray = Parser.normaliseArray ?? Parser.normalizeArray;
      const cleaned = typeof normaliseArray === 'function' ? normaliseArray(candidates) : [];

      if (!cleaned.length) {
        throw new Error('未找到可用于统计的 user/assistant 文本；请检查导出格式。');
      }

      this.activeMessages = cleaned;
      this.lastAnalysis = null;

      if (typeof this.dashboard.renderAll === 'function') {
        this.dashboard.renderAll(cleaned);
      } else {
        await this.refreshDashboard();
      }

      this.updateStatus('success', `成功导入 ${cleaned.length} 条消息。`);
    } catch (error) {
      console.error(error);
      this.updateStatus('error', error.message || '解析文件失败。');
      this.dashboardElement.hidden = true;
    }
  }

  async refreshDashboard() {
    if (!this.activeMessages || !this.activeMessages.length) {
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
      const analysis = await this.parser.parse(this.activeMessages, { overrides, stopWords });
      this.lastAnalysis = analysis;
      this.dashboard.setLightMode?.(this.lightMode);
      this.dashboard.render(analysis);
      this.dashboardElement.hidden = false;
    } catch (error) {
      console.error(error);
      this.updateStatus('error', error.message || '生成分析数据失败。');
      this.dashboardElement.hidden = true;
      this.lastAnalysis = null;
    }
  }

  handlePreferenceSubmit(event) {
    event.preventDefault();
    this.persistPreferences();
    this.updateStatus('success', '偏好已保存。');
    if (this.activeMessages?.length) {
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

  updateStatus(type, message) {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.className = `status ${type}`;
  }
}
