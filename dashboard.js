export class Dashboard {
  constructor({ themeManager, lightMode = true } = {}) {
    this.themeManager = themeManager || null;
    this.charts = new Map();
    this.pendingChartFrames = new Map();
    this.resizeObservers = new Map();
    this.lastData = null;
    this.lightMode = !!lightMode;
    this.detailPageSize = 100;
    this.detailCurrentPage = 1;
    this.detailRows = [];
    this.detailElements = {
      section: null,
      panel: null,
      count: null,
      content: null,
      tableBody: null,
      pagination: null,
      pageInfo: null,
      prev: null,
      next: null
    };

    this.handleDetailToggle = this.handleDetailToggle.bind(this);
    this.handleDetailPrev = this.handleDetailPrev.bind(this);
    this.handleDetailNext = this.handleDetailNext.bind(this);

    if (typeof document !== 'undefined') {
      this.cacheDetailElements();
      this.bindDetailEvents();
    }
  }

  setThemeManager(themeManager) {
    this.themeManager = themeManager;
  }

  render(data) {
    if (!data) return;
    this.lastData = data;
    this.updateLightModeVisibility();
    this.renderKpis(data);
    this.renderCharts(data);
    const keywords = Array.isArray(data.keywords) ? data.keywords : [];
    const keywordSample = this.lightMode ? keywords.slice(0, 50) : keywords;
    this.renderWordCloud(keywordSample);
    if (this.lightMode) {
      this.resetDetailView();
    } else {
      this.prepareDetailView(data);
    }
  }

  updateTheme() {
    if (!this.lastData) return;
    this.updateLightModeVisibility();
    this.applyChartDefaults();
    this.renderCharts(this.lastData);
    const keywords = Array.isArray(this.lastData.keywords) ? this.lastData.keywords : [];
    const keywordSample = this.lightMode ? keywords.slice(0, 50) : keywords;
    this.renderWordCloud(keywordSample);
    if (!this.lightMode) {
      this.renderDetailPage();
    }
  }

  renderKpis(data) {
    this.updateKpiCard('kpi-earliest', data.earliestMessage ? {
      value: data.earliestMessage.formatted,
      detail: `来自 ${data.earliestMessage.role}`
    } : {
      value: '--',
      detail: '等待导入数据'
    });

    this.updateKpiCard('kpi-streak', data.streak?.longest ? {
      value: `${data.streak.longest} 天`,
      detail: this.describeRange(data.streak.range)
    } : {
      value: '0 天',
      detail: '暂无连续记录'
    });

    this.updateKpiCard('kpi-peak-hour', data.peakHour ? {
      value: data.peakHour.label,
      detail: `共有 ${data.peakHour.count} 条消息`
    } : {
      value: '--',
      detail: '等待导入数据'
    });
  }

  updateKpiCard(id, { value, detail }) {
    const card = document.getElementById(id);
    if (!card) return;
    const valueEl = card.querySelector('.kpi-value');
    const detailEl = card.querySelector('.kpi-detail');
    if (valueEl) valueEl.textContent = value;
    if (detailEl) detailEl.textContent = detail;
  }

  describeRange(range) {
    if (!range?.start || !range?.end) return '';
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return `${formatter.format(range.start)} → ${formatter.format(range.end)}`;
  }

  renderCharts(data) {
    this.applyChartDefaults();
    const palette = this.themeManager?.getPalette?.() || ['#38bdf8', '#f97316', '#a855f7'];

    this.createOrUpdateChart('f1', 'chartF1', {
      type: 'bar',
      data: {
        labels: data.monthlyHistogram?.labels || [],
        datasets: [{
          label: '消息数',
          data: data.monthlyHistogram?.data || [],
          backgroundColor: palette[0] || '#38bdf8',
          borderRadius: 6
        }]
      },
      options: this.buildBarOptions({ suggestedMax: this.suggestedMax(data.monthlyHistogram?.data) })
    });

    if (!this.lightMode) {
      this.createOrUpdateChart('f2', 'chartF2', {
        type: 'bar',
        data: {
          labels: data.hourlyHistogram?.labels || [],
          datasets: [{
            label: '消息数',
            data: data.hourlyHistogram?.data || [],
            backgroundColor: palette[1] || palette[0] || '#38bdf8',
            borderRadius: 6
          }]
        },
        options: this.buildBarOptions({ suggestedMax: this.suggestedMax(data.hourlyHistogram?.data) })
      });
    } else {
      this.destroyChart('f2', 'chartF2');
    }

    const roleLabels = (data.roleStats || []).map(item => item.displayRole);
    const roleMessageCounts = (data.roleStats || []).map(item => item.messageCount);
    if (this.lightMode) {
      this.createOrUpdateChart('f3', 'chartF3', {
        type: 'doughnut',
        data: {
          labels: roleLabels,
          datasets: [{
            label: '消息占比',
            data: roleMessageCounts,
            backgroundColor: this.buildRepeatingPalette(palette, roleLabels.length)
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });
    } else {
      this.createOrUpdateChart('f3', 'chartF3', {
        type: 'bar',
        data: {
          labels: roleLabels,
          datasets: [{
            label: '消息数',
            data: roleMessageCounts,
            backgroundColor: palette.slice(0, roleLabels.length),
            borderRadius: 6
          }]
        },
        options: this.buildBarOptions({ indexAxis: 'y', suggestedMax: this.suggestedMax(roleMessageCounts) })
      });
    }

    if (!this.lightMode) {
      this.createOrUpdateChart('f4', 'chartF4', {
        type: 'bar',
        data: {
          labels: roleLabels,
          datasets: [{
            label: '字数',
            data: (data.roleStats || []).map(item => item.wordCount),
            backgroundColor: palette
              .slice(0, roleLabels.length)
              .map(color => this.withOpacity(color, 0.8)),
            borderRadius: 6
          }]
        },
        options: this.buildBarOptions({ indexAxis: 'y', suggestedMax: this.suggestedMax((data.roleStats || []).map(item => item.wordCount)) })
      });
    } else {
      this.destroyChart('f4', 'chartF4');
    }

    this.createOrUpdateChart('f5', 'chartF5', {
      type: 'doughnut',
      data: {
        labels: data.modelDistribution?.labels || [],
        datasets: [{
          label: '模型调用',
          data: data.modelDistribution?.data || [],
          backgroundColor: this.buildRepeatingPalette(palette, data.modelDistribution?.labels?.length || 0)
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });

    if (!this.lightMode) {
      this.createOrUpdateChart('f6', 'chartF6', {
        type: 'line',
        data: {
          labels: data.dailyTrend?.labels || [],
          datasets: [{
            label: '每日互动',
            data: data.dailyTrend?.data || [],
            fill: false,
            borderColor: palette[0] || '#38bdf8',
            backgroundColor: palette[0] || '#38bdf8',
            tension: 0.25,
            pointRadius: 2
          }]
        },
        options: this.buildLineOptions({ suggestedMax: this.suggestedMax(data.dailyTrend?.data) })
      });

      this.createOrUpdateChart('f7', 'chartF7', {
        type: 'radar',
        data: {
          labels: data.weekdayHistogram?.labels || [],
          datasets: [{
            label: '周内活跃度',
            data: data.weekdayHistogram?.data || [],
            borderColor: palette[2] || palette[0] || '#38bdf8',
            backgroundColor: this.withOpacity(palette[2] || palette[0] || '#38bdf8', 0.2),
            pointBackgroundColor: palette[2] || palette[0] || '#38bdf8'
          }]
        },
        options: this.buildRadarOptions({ suggestedMax: this.suggestedMax(data.weekdayHistogram?.data) })
      });
    } else {
      this.destroyChart('f6', 'chartF6');
      this.destroyChart('f7', 'chartF7');
    }
  }

  renderWordCloud(keywords) {
    const container = document.getElementById('wordCloud');
    if (!container) return;

    if (typeof window !== 'undefined' && typeof window.WordCloud === 'function' && typeof window.WordCloud.stop === 'function') {
      window.WordCloud.stop();
    }

    container.innerHTML = '';

    if (!keywords.length || typeof window === 'undefined' || typeof window.WordCloud !== 'function') {
      const placeholder = document.createElement('p');
      placeholder.textContent = keywords.length ? '无法加载词云脚本。' : '暂无关键词数据。';
      placeholder.className = 'wordcloud-placeholder';
      container.appendChild(placeholder);
      return;
    }

    const palette = this.themeManager?.getPalette?.() || ['#38bdf8', '#f97316', '#a855f7'];
    const list = keywords.map(item => [item.word, Math.max(1, Math.round(item.weight || 1))]);

    const renderCloud = () => {
      window.WordCloud(container, {
        list,
        backgroundColor: 'rgba(0,0,0,0)',
        rotateRatio: 0,
        fontFamily: 'inherit',
        weightFactor: weight => Math.max(1, Math.min(4, weight)),
        color: () => {
          const index = Math.floor(Math.random() * palette.length);
          return palette[index];
        }
      });
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(renderCloud);
    } else {
      renderCloud();
    }
  }

  setLightMode(enabled) {
    this.lightMode = !!enabled;
    this.updateLightModeVisibility();
    if (this.lightMode) {
      this.resetDetailView();
    } else if (this.lastData) {
      this.prepareDetailView(this.lastData);
    }
  }

  updateLightModeVisibility() {
    if (typeof document === 'undefined') {
      return;
    }

    const allChartCards = [
      'chart-card-f1',
      'chart-card-f2',
      'chart-card-f3',
      'chart-card-f4',
      'chart-card-f5',
      'chart-card-f6',
      'chart-card-f7'
    ];
    const lightModeVisible = new Set(['chart-card-f1', 'chart-card-f3', 'chart-card-f5']);

    allChartCards.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const shouldShow = this.lightMode ? lightModeVisible.has(id) : true;
      el.hidden = !shouldShow;
    });

    const dashboardRoot = document.getElementById('dashboard');
    if (dashboardRoot) {
      dashboardRoot.dataset.mode = this.lightMode ? 'light' : 'full';
    }

    if (this.detailElements?.section) {
      this.detailElements.section.hidden = this.lightMode;
      if (this.lightMode) {
        this.closeDetailPanel();
      }
    }
  }

  cacheDetailElements() {
    if (typeof document === 'undefined') {
      return;
    }

    const section = document.getElementById('detailSection');
    const panel = document.getElementById('detailPanel');
    this.detailElements = {
      section: section || null,
      panel: panel || null,
      count: section?.querySelector('[data-detail-count]') || null,
      content: section?.querySelector('[data-detail-content]') || null,
      tableBody: section?.querySelector('[data-detail-body]') || null,
      pagination: section?.querySelector('[data-detail-pagination]') || null,
      pageInfo: section?.querySelector('[data-detail-page-info]') || null,
      prev: section?.querySelector('[data-detail-prev]') || null,
      next: section?.querySelector('[data-detail-next]') || null
    };
  }

  bindDetailEvents() {
    const { panel, prev, next } = this.detailElements;
    if (panel) {
      panel.addEventListener('toggle', this.handleDetailToggle);
    }
    if (prev) {
      prev.addEventListener('click', this.handleDetailPrev);
    }
    if (next) {
      next.addEventListener('click', this.handleDetailNext);
    }
  }

  handleDetailToggle() {
    if (!this.isDetailOpen()) {
      this.clearDetailTable();
      return;
    }

    if (!this.detailRows.length && this.lastData) {
      this.prepareDetailView(this.lastData);
    } else {
      this.renderDetailPage();
    }
  }

  handleDetailPrev(event) {
    event.preventDefault();
    if (this.detailCurrentPage <= 1) {
      return;
    }
    this.detailCurrentPage -= 1;
    this.renderDetailPage();
  }

  handleDetailNext(event) {
    event.preventDefault();
    const totalPages = Math.max(1, Math.ceil(this.detailRows.length / this.detailPageSize));
    if (this.detailCurrentPage >= totalPages) {
      return;
    }
    this.detailCurrentPage += 1;
    this.renderDetailPage();
  }

  prepareDetailView(data) {
    this.detailRows = this.buildDetailRows(data);
    this.detailCurrentPage = 1;
    this.updateDetailCount();
    if (!this.isDetailOpen()) {
      this.clearDetailTable();
      this.updatePaginationControls();
      return;
    }
    this.renderDetailPage();
  }

  buildDetailRows(data) {
    if (!data || !Array.isArray(data.dailyTrend?.labels)) {
      return [];
    }

    const labels = data.dailyTrend.labels;
    const counts = Array.isArray(data.dailyTrend.data) ? data.dailyTrend.data : [];
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });

    const rows = labels.map((label, index) => {
      const count = counts[index] ?? 0;
      const date = new Date(label);
      const isValidDate = !Number.isNaN(date.getTime());
      return {
        key: label,
        iso: label,
        formatted: isValidDate ? formatter.format(date) : label,
        weekday: isValidDate ? this.weekdayName(date.getDay()) : '未知',
        count
      };
    });

    return rows.sort((a, b) => b.iso.localeCompare(a.iso));
  }

  renderDetailPage() {
    const { tableBody } = this.detailElements;
    if (!tableBody) {
      return;
    }

    tableBody.innerHTML = '';

    if (!this.detailRows.length) {
      this.renderEmptyDetailRow();
      this.updatePaginationControls();
      return;
    }

    const totalPages = Math.max(1, Math.ceil(this.detailRows.length / this.detailPageSize));
    if (this.detailCurrentPage > totalPages) {
      this.detailCurrentPage = totalPages;
    }
    if (this.detailCurrentPage < 1) {
      this.detailCurrentPage = 1;
    }

    const start = (this.detailCurrentPage - 1) * this.detailPageSize;
    const end = Math.min(start + this.detailPageSize, this.detailRows.length);
    const slice = this.detailRows.slice(start, end);

    slice.forEach(row => {
      const tr = document.createElement('tr');

      const dateCell = document.createElement('td');
      dateCell.textContent = row.formatted;
      tr.appendChild(dateCell);

      const weekdayCell = document.createElement('td');
      weekdayCell.textContent = row.weekday;
      tr.appendChild(weekdayCell);

      const countCell = document.createElement('td');
      countCell.textContent = row.count.toString();
      tr.appendChild(countCell);

      tableBody.appendChild(tr);
    });

    this.updatePaginationControls();
  }

  renderEmptyDetailRow() {
    const { tableBody } = this.detailElements;
    if (!tableBody) {
      return;
    }

    const emptyRow = document.createElement('tr');
    emptyRow.className = 'detail-empty-row';
    const cell = document.createElement('td');
    cell.colSpan = 3;
    cell.textContent = '暂无每日互动数据。';
    emptyRow.appendChild(cell);
    tableBody.appendChild(emptyRow);
  }

  clearDetailTable() {
    const { tableBody } = this.detailElements;
    if (!tableBody) {
      return;
    }
    tableBody.innerHTML = '';
    this.renderEmptyDetailRow();
  }

  resetDetailView() {
    this.detailRows = [];
    this.detailCurrentPage = 1;
    this.updateDetailCount();
    this.clearDetailTable();
    this.updatePaginationControls();
  }

  updateDetailCount() {
    const { count } = this.detailElements;
    if (!count) {
      return;
    }
    const total = this.detailRows.length;
    count.textContent = total ? `共 ${total} 天` : '';
  }

  updatePaginationControls() {
    const { pagination, pageInfo, prev, next } = this.detailElements;
    if (!pagination) {
      return;
    }

    const total = this.detailRows.length;
    const totalPages = Math.max(1, Math.ceil(total / this.detailPageSize));

    if (total <= this.detailPageSize) {
      pagination.hidden = true;
    } else {
      pagination.hidden = false;
    }

    if (pageInfo) {
      pageInfo.textContent = total ? `${this.detailCurrentPage} / ${totalPages}` : '';
    }
    if (prev) {
      prev.disabled = this.detailCurrentPage <= 1 || total === 0;
    }
    if (next) {
      next.disabled = this.detailCurrentPage >= totalPages || total === 0;
    }
  }

  closeDetailPanel() {
    const { panel } = this.detailElements;
    if (panel && panel.open) {
      panel.open = false;
    }
  }

  isDetailOpen() {
    return !!this.detailElements?.panel?.open;
  }

  weekdayName(index) {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    if (Number.isInteger(index) && index >= 0 && index < names.length) {
      return names[index];
    }
    return '未知';
  }

  createOrUpdateChart(key, canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof window === 'undefined' || typeof window.Chart === 'undefined') {
      return;
    }

    const schedule = () => {
      this.pendingChartFrames.delete(key);

      if (this.charts.has(key)) {
        try {
          this.charts.get(key).destroy();
        } catch (error) {
          console.warn('销毁旧图表失败', error);
        }
        this.charts.delete(key);
      }

      const context = canvas.getContext('2d');
      const chart = new window.Chart(context, config);
      this.charts.set(key, chart);
      this.observeCanvas(canvas, chart);
    };

    if (typeof window.requestAnimationFrame === 'function') {
      if (this.pendingChartFrames.has(key) && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(this.pendingChartFrames.get(key));
        this.pendingChartFrames.delete(key);
      }
      const frameId = window.requestAnimationFrame(schedule);
      this.pendingChartFrames.set(key, frameId);
    } else {
      schedule();
    }
  }

  destroyChart(key, canvasId) {
    if (this.pendingChartFrames.has(key) && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(this.pendingChartFrames.get(key));
      this.pendingChartFrames.delete(key);
    }

    if (this.charts.has(key)) {
      this.charts.get(key).destroy();
      this.charts.delete(key);
    }

    if (!canvasId) {
      return;
    }

    const canvas = document.getElementById(canvasId);
    if (canvas && this.resizeObservers.has(canvas)) {
      this.resizeObservers.get(canvas).disconnect();
      this.resizeObservers.delete(canvas);
    }
  }

  observeCanvas(canvas, chart) {
    if (!('ResizeObserver' in window)) {
      return;
    }

    if (this.resizeObservers.has(canvas)) {
      this.resizeObservers.get(canvas).disconnect();
    }

    const observer = new ResizeObserver(() => {
      chart.resize();
    });

    observer.observe(canvas);
    this.resizeObservers.set(canvas, observer);
  }

  buildBarOptions({ suggestedMax, indexAxis } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: indexAxis || 'x',
      scales: {
        x: {
          grid: {
            color: this.gridColor()
          }
        },
        y: {
          beginAtZero: true,
          suggestedMax: suggestedMax || undefined,
          ticks: {
            precision: 0
          },
          grid: {
            color: this.gridColor()
          }
        }
      },
      plugins: {
        legend: { display: false }
      }
    };
  }

  buildLineOptions({ suggestedMax } = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: this.gridColor() }
        },
        y: {
          beginAtZero: true,
          suggestedMax: suggestedMax || undefined,
          grid: { color: this.gridColor() }
        }
      },
      plugins: {
        legend: { display: false }
      }
    };
  }

  buildRadarOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          angleLines: { color: this.gridColor() },
          grid: { color: this.gridColor() },
          pointLabels: {
            color: getComputedStyle(document.documentElement).getPropertyValue('--text-color') || '#e2e8f0'
          }
        }
      },
      plugins: {
        legend: { display: false }
      }
    };
  }

  applyChartDefaults() {
    if (typeof window === 'undefined' || typeof window.Chart === 'undefined') {
      return;
    }

    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color') || '#e2e8f0';
    window.Chart.defaults.color = textColor.trim();
    window.Chart.defaults.font.family = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
  }

  gridColor() {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--border-color') || 'rgba(255,255,255,0.1)';
    return color.trim();
  }

  buildRepeatingPalette(palette, length) {
    if (!palette.length) return [];
    const colors = [];
    for (let i = 0; i < length; i += 1) {
      colors.push(palette[i % palette.length]);
    }
    return colors;
  }

  withOpacity(color, opacity = 0.5) {
    if (!color) return `rgba(56, 189, 248, ${opacity})`;
    if (color.startsWith('#')) {
      let hex = color.slice(1);
      if (hex.length === 3) {
        hex = hex.split('').map(ch => ch + ch).join('');
      }
      const bigint = parseInt(hex, 16);
      const r = (bigint >> 16) & 255;
      const g = (bigint >> 8) & 255;
      const b = bigint & 255;
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
    if (color.startsWith('rgb')) {
      return color.replace(/\brgba?\(([^)]+)\)/, (match, rgb) => {
        const parts = rgb.split(',').map(part => part.trim()).slice(0, 3);
        return `rgba(${parts.join(', ')}, ${opacity})`;
      });
    }
    return color;
  }

  suggestedMax(values = []) {
    if (!values.length) return undefined;
    const maxValue = Math.max(...values);
    if (Number.isNaN(maxValue) || maxValue <= 5) return undefined;
    return Math.ceil(maxValue * 1.15);
  }
}
