// [Module] Manages API usage reporting and chart rendering.
import { createDOMElement } from '../../../components/common.js';

let appState, elements, controller;

const dateRangeOptions = {
    '1d': '오늘',
    '7d': '최근 7일',
    '30d': '최근 30일',
    'mtd': '이번 달',
    'all': '전체 기간'
};

export const UsageReporter = {
    filters: { dateRange: '7d', tags: [], model: null },
    pagination: { currentPage: 1, itemsPerPage: 50 },
    historyViewMode: 'day', // 'day', 'week', 'month'
    chartViewMode: 'cost',
    barChart: null,
    lineChart: null,

    init(_appState, _elements, _controller) {
        appState = _appState;
        elements = _elements;
        controller = _controller;
        this.filters.tags = [];
        this.filters.model = null;
    },

    applyFilter(filterType, value) {
        this.pagination.currentPage = 1;
        if (filterType === 'dateRange') this.filters.dateRange = value;
        else if (filterType === 'tags') {
            const index = this.filters.tags.indexOf(value);
            if (index > -1) this.filters.tags.splice(index, 1);
            else this.filters.tags.push(value);
        } else if (filterType === 'chartView') this.chartViewMode = value;
        else if (filterType === 'model') this.filters.model = this.filters.model === value ? null : value;
        else if (filterType === 'page') this.pagination.currentPage = parseInt(value, 10);
        else if (filterType === 'grouping') this.historyViewMode = value;
        this.render();
    },

    getFilteredData() {
        const { usage, sessions } = appState;
        if (!usage) return [];
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        let startDate;
        switch (this.filters.dateRange) {
            case '1d': startDate = today; break;
            case '7d': startDate = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000); break;
            case '30d': startDate = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000); break;
            case 'mtd': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
            default: startDate = new Date(0); break;
        }
        startDate.setHours(0, 0, 0, 0);
        let filtered = usage.filter(item => item.timestamp >= startDate.getTime());
        if (this.filters.tags.length > 0) {
            filtered = filtered.filter(item => {
                const session = sessions[item.sessionId];
                if (!session || !session.tags) return false;
                return this.filters.tags.every(filterTag => session.tags.includes(filterTag));
            });
        }
        if (this.filters.model) {
            filtered = filtered.filter(item => item.model === this.filters.model);
        }
        return filtered.sort((a, b) => b.timestamp - a.timestamp);
    },

    aggregateData(filteredData) { /* ... unchanged ... */ const { modelCosts } = appState.settings; const summary = { totalCost: 0, totalCalls: filteredData.length, totalTokens: 0, promptTokens: 0, outputTokens: 0, byModel: {}, byDate: {} }; const modelDataForChart = this.filters.model ? this.getFilteredData() : filteredData; for (const item of modelDataForChart) { const costInfo = modelCosts[item.model]; const itemCost = costInfo ? ((item.promptTokens / 1_000_000) * costInfo.input) + ((item.outputTokens / 1_000_000) * costInfo.output) : 0; if (!summary.byModel[item.model]) summary.byModel[item.model] = { cost: 0, tokens: 0, promptTokens: 0, outputTokens: 0, calls: 0 }; summary.byModel[item.model].cost += itemCost; summary.byModel[item.model].tokens += item.totalTokens; summary.byModel[item.model].promptTokens += item.promptTokens; summary.byModel[item.model].outputTokens += item.outputTokens; summary.byModel[item.model].calls++; } for (const item of filteredData) { summary.totalTokens += item.totalTokens; summary.promptTokens += item.promptTokens; summary.outputTokens += item.outputTokens; const costInfo = modelCosts[item.model]; const itemCost = costInfo ? ((item.promptTokens / 1_000_000) * costInfo.input) + ((item.outputTokens / 1_000_000) * costInfo.output) : 0; summary.totalCost += itemCost; const dateKey = new Date(item.timestamp).toISOString().split('T')[0]; if (!summary.byDate[dateKey]) summary.byDate[dateKey] = { cost: 0, tokens: 0 }; summary.byDate[dateKey].cost += itemCost; summary.byDate[dateKey].tokens += item.totalTokens; } return summary; },

    renderFilters() { /* ... unchanged ... */ const dateRangeContainer = document.getElementById('filter-date-range'); const tagsContainer = document.getElementById('filter-tags'); if (!dateRangeContainer || !tagsContainer) return; dateRangeContainer.innerHTML = ''; Object.entries(dateRangeOptions).forEach(([key, text]) => { const button = createDOMElement('button', { className: `filter-btn ${this.filters.dateRange === key ? 'active' : ''}`, 'data-filter-type': 'dateRange', 'data-value': key }, text); dateRangeContainer.appendChild(button); }); tagsContainer.innerHTML = ''; const allTags = [...new Set(Object.values(appState.sessions).flatMap(s => s.tags || []))]; if (allTags.length > 0) { tagsContainer.style.display = 'flex'; allTags.forEach(tag => { const button = createDOMElement('button', { className: `filter-btn ${this.filters.tags.includes(tag) ? 'active' : ''}`, 'data-filter-type': 'tags', 'data-value': tag }, `#${tag}`); tagsContainer.appendChild(button); }); } else { tagsContainer.style.display = 'none'; } if (this.filters.model) { const modelFilterTag = createDOMElement('button', { className: 'filter-btn active', 'data-filter-type': 'model', 'data-value': this.filters.model }, `모델: ${this.filters.model} (해제)`); tagsContainer.appendChild(modelFilterTag); } },

    renderSummary(summaryData) { /* ... unchanged ... */ const container = document.getElementById('usage-summary-grid'); if (!container) return; container.innerHTML = ''; const createCard = (title, value, subtext = '') => { const card = createDOMElement('div', { className: 'summary-card' }); card.append(createDOMElement('div', { className: 'card-title' }, title), createDOMElement('div', { className: 'card-value' }, value)); if (subtext) card.appendChild(createDOMElement('div', { className: 'card-subtext' }, subtext)); return card; }; container.appendChild(createCard('총 예상 비용', `$${summaryData.totalCost.toFixed(4)}`)); container.appendChild(createCard('총 호출 횟수', summaryData.totalCalls.toLocaleString())); container.appendChild(createCard('총 토큰 사용량', summaryData.totalTokens.toLocaleString(), `입력 ${summaryData.promptTokens.toLocaleString()} / 출력 ${summaryData.outputTokens.toLocaleString()}`)); },

    _getThemeColors() { /* ... unchanged ... */ const s = getComputedStyle(document.body); return { textColor: s.getPropertyValue('--text-primary').trim(), gridColor: s.getPropertyValue('--chart-grid-color').trim(), tooltipBg: s.getPropertyValue('--chart-tooltip-bg').trim(), tooltipText: s.getPropertyValue('--chart-tooltip-text').trim() }; },

    _handleChartClick(e) { /* ... unchanged ... */ const points = this.barChart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true); if (points.length) { const firstPoint = points[0]; const label = this.barChart.data.labels[firstPoint.index]; this.applyFilter('model', label); } },

    renderCharts(summaryData) {
        const grid = document.getElementById('usage-charts-grid');
        if (!grid) return;
        grid.innerHTML = '';
        if (this.barChart) this.barChart.destroy();
        if (this.lineChart) this.lineChart.destroy();
        if (Object.keys(summaryData.byModel).length === 0) return;

        const theme = this._getThemeColors();
        const colors = { input: 'rgba(54, 162, 235, 0.7)', output: 'rgba(255, 99, 132, 0.7)' };

        const barWrapper = createDOMElement('div', { className: 'chart-wrapper' });
        const barHeader = createDOMElement('div', { className: 'usage-toolbar' });
        const barTitle = createDOMElement('h3', {}, '모델별 사용량');
        const barToggle = createDOMElement('div', { className: 'filter-group' });
        barToggle.innerHTML = `<button class="filter-btn ${this.chartViewMode === 'cost' ? 'active' : ''}" data-filter-type="chartView" data-value="cost">비용</button><button class="filter-btn ${this.chartViewMode === 'tokens' ? 'active' : ''}" data-filter-type="chartView" data-value="tokens">토큰</button>`;
        barHeader.append(barTitle, barToggle);
        const barCanvas = createDOMElement('canvas');
        barWrapper.append(barHeader, barCanvas);

        const sortedModels = Object.entries(summaryData.byModel).sort((a,b) => b[1][this.chartViewMode] - a[1][this.chartViewMode]);
        const barLabels = sortedModels.map(e => e[0]);
        const inputData = sortedModels.map(e => this.chartViewMode === 'cost' ? ((e[1].promptTokens / 1_000_000) * (appState.settings.modelCosts[e[0]]?.input || 0)) : e[1].promptTokens);
        const outputData = sortedModels.map(e => this.chartViewMode === 'cost' ? ((e[1].outputTokens / 1_000_000) * (appState.settings.modelCosts[e[0]]?.output || 0)) : e[1].outputTokens);

        this.barChart = new Chart(barCanvas, { type: 'bar', data: { labels: barLabels, datasets: [{ label: '입력', data: inputData, backgroundColor: colors.input }, { label: '출력', data: outputData, backgroundColor: colors.output }] }, options: { indexAxis: 'y', onClick: (e) => this._handleChartClick(e), scales: { x: { stacked: true, ticks: { color: theme.textColor }, grid: { color: theme.gridColor } }, y: { stacked: true, ticks: { color: theme.textColor }, grid: { display: false } } }, plugins: { legend: { labels: { color: theme.textColor } }, tooltip: { mode: 'index', backgroundColor: theme.tooltipBg, titleColor: theme.tooltipText, bodyColor: theme.tooltipText } } } });

        const lineWrapper = createDOMElement('div', { className: 'chart-wrapper' });
        const lineHeader = createDOMElement('div', { className: 'usage-toolbar' });
        lineHeader.innerHTML = '<h3>기간별 추이</h3>';
        const lineCanvas = createDOMElement('canvas');
        lineWrapper.append(lineHeader, lineCanvas);

        const sortedDates = Object.keys(summaryData.byDate).sort();
        const lineLabels = sortedDates.map(d => new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }));
        const lineData = sortedDates.map(d => summaryData.byDate[d][this.chartViewMode]);

        this.lineChart = new Chart(lineCanvas, {
            type: 'line',
            data: {
                labels: lineLabels,
                datasets: [{
                    label: this.chartViewMode === 'cost' ? '비용 (USD)' : '토큰',
                    data: lineData,
                    borderColor: 'rgba(75, 192, 192, 1)',
                    backgroundColor: 'rgba(75, 192, 192, 0.2)',
                    fill: true,
                    tension: 0.1
                }]
            },
            options: {
                scales: {
                    x: { ticks: { color: theme.textColor }, grid: { color: theme.gridColor } },
                    y: {
                        ticks: {
                            color: theme.textColor,
                            callback: (value) => {
                                // [MODIFIED] Full formatting logic implemented
                                if (this.chartViewMode === 'cost') {
                                    if (value === 0) return '$0';
                                    return `$${value.toFixed(8)}`;
                                }
                                return value.toLocaleString();
                            }
                        },
                        grid: { color: theme.gridColor }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                         backgroundColor: theme.tooltipBg, titleColor: theme.tooltipText, bodyColor: theme.tooltipText,
                         callbacks: {
                            label: (context) => {
                                let label = context.dataset.label || '';
                                if (label) { label += ': '; }
                                if (context.parsed.y !== null) {
                                     if (this.chartViewMode === 'cost') {
                                        label += `$${context.parsed.y.toFixed(8)}`;
                                     } else {
                                        label += context.parsed.y.toLocaleString();
                                     }
                                }
                                return label;
                            }
                         }
                    }
                }
            }
        });

        grid.append(barWrapper, lineWrapper);
    },

    _renderDailyView(paginatedData) { /* ... same as old renderHistoryTable ... */ const container = document.getElementById('usage-history-container'); if (!container) return; if (paginatedData.length === 0) { container.innerHTML = '<p style="text-align:center; padding: 20px; color: var(--text-secondary);">표시할 기록이 없습니다.</p>'; return; } const table = createDOMElement('table', { className: 'usage-history-table' }); table.innerHTML = `<thead><tr><th>시간</th><th>세션</th><th>모델</th><th>태그</th><th>입력 토큰</th><th>출력 토큰</th><th>총 토큰</th><th>예상 비용</th></tr></thead>`; const tbody = createDOMElement('tbody'); paginatedData.forEach(item => { const session = appState.sessions[item.sessionId]; const costInfo = appState.settings.modelCosts[item.model]; const itemCost = costInfo ? ((item.promptTokens / 1_000_000) * costInfo.input) + ((item.outputTokens / 1_000_000) * costInfo.output) : 0; const tr = createDOMElement('tr'); const tagsHtml = (session?.tags || []).map(tag => `<span class="session-tag">${tag}</span>`).join(' '); tr.innerHTML = `<td>${new Date(item.timestamp).toLocaleTimeString('ko-KR')}</td><td>${session ? session.title : 'N/A'}</td><td>${item.model}</td><td>${tagsHtml}</td><td>${item.promptTokens.toLocaleString()}</td><td>${item.outputTokens.toLocaleString()}</td><td>${item.totalTokens.toLocaleString()}</td><td>$${itemCost.toFixed(5)}</td>`; tbody.appendChild(tr); }); table.appendChild(tbody); container.innerHTML = ''; container.appendChild(table); },
    _renderGroupedView(groupedData) { /* ... To be implemented ... */ const container = document.getElementById('usage-history-container'); container.innerHTML = '<p style="text-align:center; padding: 20px; color: var(--text-secondary);">그룹별 보기는 다음 단계에서 구현됩니다.</p>'; },

    renderHistoryControls(totalItems) {
        const toolbar = document.querySelector('.usage-details-toolbar');
        if (!toolbar) return;
        const toggleContainer = document.getElementById('history-grouping-toggle');
        toggleContainer.innerHTML = '';
        const views = { day: '일별', week: '주별', month: '월별' };
        Object.entries(views).forEach(([key, text]) => {
             const button = createDOMElement('button', { className: `filter-btn ${this.historyViewMode === key ? 'active' : ''}`, 'data-filter-type': 'grouping', 'data-value': key }, text);
             toggleContainer.appendChild(button);
        });
        this.renderPaginationControls(totalItems);
    },

    renderPaginationControls(totalItems) { /* ... unchanged ... */ const container = document.getElementById('pagination-controls'); if (!container) return; container.innerHTML = ''; const { currentPage, itemsPerPage } = this.pagination; const totalPages = Math.ceil(totalItems / itemsPerPage); if (totalPages <= 1) return; const prevButton = createDOMElement('button', { 'data-filter-type': 'page', 'data-value': currentPage - 1 }, '이전'); if (currentPage === 1) prevButton.disabled = true; const nextButton = createDOMElement('button', { 'data-filter-type': 'page', 'data-value': currentPage + 1 }, '다음'); if (currentPage === totalPages) nextButton.disabled = true; const pageInfo = createDOMElement('span', {}, `${currentPage} / ${totalPages}`); container.append(prevButton, pageInfo, nextButton); },

    render() {
        if (!appState) return;
        this.renderFilters();
        const filteredData = this.getFilteredData();
        const summaryData = this.aggregateData(filteredData);
        this.renderSummary(summaryData);
        this.renderCharts(summaryData);

        const { currentPage, itemsPerPage } = this.pagination;
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const paginatedData = filteredData.slice(startIndex, endIndex);

        this._renderDailyView(paginatedData);
        this.renderHistoryControls(filteredData.length);
    }
};