export const THEMES = {
  echoes: {
    key: 'echoes',
    name: 'Echoes',
    palette: ['#38bdf8', '#60a5fa', '#818cf8', '#a855f7', '#f472b6'],
    cssVars: {
      '--bg-color': '#0f172a',
      '--text-color': '#e2e8f0',
      '--card-bg': 'rgba(15, 23, 42, 0.68)',
      '--accent-color': '#38bdf8',
      '--border-color': 'rgba(148, 163, 184, 0.35)'
    }
  },
  logic: {
    key: 'logic',
    name: 'Logic',
    palette: ['#f97316', '#facc15', '#22d3ee', '#34d399', '#a3e635'],
    cssVars: {
      '--bg-color': '#111827',
      '--text-color': '#f3f4f6',
      '--card-bg': 'rgba(17, 24, 39, 0.72)',
      '--accent-color': '#f97316',
      '--border-color': 'rgba(249, 115, 22, 0.25)'
    }
  },
  emotion: {
    key: 'emotion',
    name: 'Emotion',
    palette: ['#fb7185', '#f472b6', '#c084fc', '#fbbf24', '#f97316'],
    cssVars: {
      '--bg-color': '#1f0a28',
      '--text-color': '#fdf2f8',
      '--card-bg': 'rgba(88, 28, 135, 0.58)',
      '--accent-color': '#f472b6',
      '--border-color': 'rgba(244, 114, 182, 0.35)'
    }
  }
};

const THEME_STORAGE_KEY = 'memory-dashboard-theme';

export class ThemeManager {
  constructor(selectElement) {
    this.selectElement = selectElement || null;
    this.activeKey = 'echoes';
    this.listeners = new Set();
  }

  init() {
    const stored = this.readStorage();
    if (stored && THEMES[stored]) {
      this.activeKey = stored;
    }

    if (this.selectElement) {
      this.selectElement.value = this.activeKey;
      this.selectElement.addEventListener('change', event => {
        this.applyTheme(event.target.value);
      });
    }

    this.applyTheme(this.activeKey, { skipPersist: true });
  }

  applyTheme(themeKey, { skipPersist = false } = {}) {
    const resolvedKey = THEMES[themeKey] ? themeKey : 'echoes';
    this.activeKey = resolvedKey;
    const theme = THEMES[resolvedKey];

    this.updateSelect(theme.key);
    this.applyCssVariables(theme.cssVars);

    if (!skipPersist) {
      this.writeStorage(theme.key);
    }

    this.notify(theme);
  }

  updateSelect(value) {
    if (this.selectElement && this.selectElement.value !== value) {
      this.selectElement.value = value;
    }
  }

  applyCssVariables(cssVars = {}) {
    const root = document.documentElement;
    Object.entries(cssVars).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  }

  getPalette() {
    return THEMES[this.activeKey]?.palette || THEMES.echoes.palette;
  }

  getActiveTheme() {
    return THEMES[this.activeKey] || THEMES.echoes;
  }

  onChange(callback) {
    if (typeof callback !== 'function') return () => {};
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(theme) {
    this.listeners.forEach(callback => {
      try {
        callback(theme || this.getActiveTheme());
      } catch (error) {
        console.error('主题切换回调执行失败', error);
      }
    });
  }

  readStorage() {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      return window.localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      console.warn('读取主题配置失败：', error);
      return null;
    }
  }

  writeStorage(value) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch (error) {
      console.warn('保存主题配置失败：', error);
    }
  }
}
