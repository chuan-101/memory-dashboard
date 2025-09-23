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
      const text = await this.readFile(file);
      const parsed = this.parseJson(text);
      const rawMessages = this.extractMessages(parsed);
      const messages = this.validateMessages(rawMessages);

      if (!cleaned.length) {
        throw new Error('未找到可用于统计的 user/assistant 文本；请检查导出格式。');
      }

      this.activeMessages = cleaned;
      await this.refreshDashboard();
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

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取文件失败。'));
      reader.onload = event => resolve(event.target.result);
      reader.readAsText(file, 'utf-8');
    });
  }

  parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error('文件内容不是合法的 JSON。');
    }
  }

  validateMessages(raw) {
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

    if (!msgs.length) {
      throw new Error('无法在导出文件中找到消息数组。');
    }

    const parser = this.parser || new Parser();
    const skippedIds = [];
    const validMessages = [];

    const resolveMessageId = message =>
      message?.id ??
      message?.message_id ??
      message?.uuid ??
      message?.key ??
      message?.conversation_id ??
      message?.metadata?.message_id ??
      message?.message?.id ??
      null;

    messages.forEach(message => {
      if (!message || typeof message !== 'object') {
        skippedIds.push('unknown');
        return;
      }

      const role =
        message.role ??
        message?.author?.role ??
        message.author_role ??
        (typeof message.author === 'string' ? message.author : null) ??
        message.participant ??
        message.sender ??
        null;

      const text = (parser.extractText(message) || '').trim();

      if (role && text) {
        validMessages.push(message);
        return;
      }

      skippedIds.push(resolveMessageId(message) || 'unknown');
    });

    if (!validMessages.length) {
      throw new Error('未找到可解析的消息文本内容。');
    }

    if (skippedIds.length && typeof console !== 'undefined' && typeof console.debug === 'function') {
      console.debug('跳过缺少文本内容或角色信息的消息：', skippedIds);
main
    }

    return validMessages;
  }

  updateStatus(type, message) {
    if (!this.statusElement) return;
    this.statusElement.textContent = message;
    this.statusElement.className = `status ${type}`;
  }
}
