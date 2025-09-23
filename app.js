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
    this.nameForm = document.getElementById('nameOverrides');
    this.userNameInput = document.getElementById('userName');
    this.assistantNameInput = document.getElementById('assistantName');
    this.stopWordsInput = document.getElementById('stopWords');

    this.parser = new Parser();
    this.themeManager = new ThemeManager(this.themeSelect);
    this.dashboard = new Dashboard({ themeManager: this.themeManager });

    this.activeMessages = null;

    this.handleThemeChange = this.handleThemeChange.bind(this);
  }

  init() {
    this.themeManager.init();
    this.themeManager.onChange(this.handleThemeChange);
    this.loadPreferences();

    if (this.fileInput) {
      this.fileInput.addEventListener('change', event => this.handleFileSelection(event));
    }

    if (this.nameForm) {
      this.nameForm.addEventListener('submit', event => this.handlePreferenceSubmit(event));
    }
  }

  async handleFileSelection(event) {
    const file = event.target.files?.[0];
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
      const normaliser = Parser.normaliseArray ?? Parser.normalizeArray;
      const cleaned = typeof normaliser === 'function' ? normaliser(candidates) : [];

      if (!cleaned.length) {
        throw new Error('未找到可用于统计的 user/assistant 文本；请检查导出格式。');
      }

      this.activeMessages = cleaned;

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
      this.dashboard.render(analysis);
      this.dashboardElement.hidden = false;
    } catch (error) {
      console.error(error);
      this.updateStatus('error', error.message || '生成分析数据失败。');
      this.dashboardElement.hidden = true;
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

  extractMessages(raw) {
    let msgs = Array.isArray(raw)
      ? raw
      : Array.isArray(raw?.messages)
      ? raw.messages
      : Array.isArray(raw?.items)
      ? raw.items
      : raw?.mapping
      ? Object.values(raw.mapping)
          .map(node => node?.message)
          .filter(Boolean)
      : [];

    if (!Array.isArray(msgs)) msgs = [];

    if (!msgs.length && Array.isArray(raw?.data)) {
      msgs = raw.data.flatMap(item => {
        if (Array.isArray(item?.messages)) return item.messages;
        if (Array.isArray(item?.items)) return item.items;
        if (item?.mapping) {
          return Object.values(item.mapping)
            .map(node => node?.message)
            .filter(Boolean);
        }
        return [];
      });
    }

    if (!msgs.length && Array.isArray(raw?.conversations)) {
      msgs = raw.conversations.flatMap(conversation => {
        if (Array.isArray(conversation?.messages)) return conversation.messages;
        if (Array.isArray(conversation?.items)) return conversation.items;
        if (conversation?.mapping) {
          return Object.values(conversation.mapping)
            .map(node => node?.message)
            .filter(Boolean);
        }
        return [];
      });
    }

    if (!Array.isArray(msgs)) {
      return [];
    }

    return msgs;
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
