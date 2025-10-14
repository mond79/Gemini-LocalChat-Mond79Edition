// [Controller] Orchestrates all settings-related modules for the settings page view.
import { appState } from '../state/AppState.js';
import { saveData } from '../../utils/storage.js';
import { ApiSettings } from '../modules/settings/ApiSettings.js';
import { UsageReporter } from '../modules/settings/UsageReporter.js';
import { GeneralSettings } from '../modules/settings/GeneralSettings.js';

let elements = {};
let isInitialized = false;
let countdownInterval = null;

function getTodaysUTCDateString() {
    const now = new Date();
    return new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
}

function checkAndResetDailyUsage() {
    const todayStr = getTodaysUTCDateString();
    if (!appState.dailyUsage || appState.dailyUsage.date !== todayStr) {
        console.log('[SettingsController] New day detected, resetting daily usage stats.');
        appState.dailyUsage = { date: todayStr, usageByKey: {}, notifiedLimits: {} };
        saveData(appState);
    }
}

function handleTabClick(e) {
    const button = e.target.closest('.tab-btn');
    if (!button || button.classList.contains('active')) return;
    const targetTabId = button.dataset.tab;
    elements.tabButtons.forEach(btn => btn.classList.remove('active'));
    button.classList.add('active');
    elements.tabContents.forEach(content => content.classList.remove('active'));
    document.getElementById(targetTabId).classList.add('active');
    if (targetTabId === 'tab-usage') {
        UsageReporter.render();
    }
}

function startResetCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        try {
            const now = new Date();
            const ptTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
            const nextReset = new Date(ptTime);
            nextReset.setDate(ptTime.getDate() + 1);
            nextReset.setHours(0, 0, 0, 0);
            const diff = nextReset.getTime() - ptTime.getTime();
            if (diff < 0) { elements.resetCountdownTimer.textContent = '초기화 중...'; return; }
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            const pad = (num) => String(num).padStart(2, '0');
            elements.resetCountdownTimer.textContent = `다음 초기화까지: ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
        } catch (e) {
            elements.resetCountdownTimer.textContent = '시간 계산 오류';
            clearInterval(countdownInterval);
        }
    }, 1000);
}

function handleFilterClick(e) {
    const button = e.target.closest('.filter-btn, .pagination-controls button');
    if (!button) return;
    e.preventDefault();
    const filterType = button.dataset.filterType;
    const value = button.dataset.value;
    if (filterType && value) {
        UsageReporter.applyFilter(filterType, value);
    }
}

export const SettingsController = {
    init() {
        if (isInitialized) return;
        elements = {
            tabList: document.getElementById('settings-tabs-list'),
            tabButtons: document.querySelectorAll('#settings-tabs-list .tab-btn'),
            tabContents: document.querySelectorAll('.settings-content .tab-content'),
            apiKeyInput: document.getElementById('api-key'),
            validateKeyBtn: document.getElementById('validate-key-btn'),
            validationStatus: document.getElementById('validation-status'),
            fallbackKeysList: document.getElementById('fallback-keys-list'),
            addFallbackKeyBtn: document.getElementById('add-fallback-key-btn'),
            historyTokenLimitInput: document.getElementById('history-token-limit'),
            typingSpeedSlider: document.getElementById('typing-speed-slider'),
            typingSpeedValue: document.getElementById('typing-speed-value'),
            mathRendererRadios: document.querySelectorAll('input[name="math-renderer"]'),
            resetCountdownTimer: document.getElementById('reset-countdown-timer'),
            resetSessionsBtn: document.getElementById('reset-sessions-btn'),
            clearUsageHistoryBtn: document.getElementById('clear-usage-history-btn'),
            usageFilterGroup: document.getElementById('usage-filter-group'),
            chartsGrid: document.getElementById('usage-charts-grid'),
            usageDetails: document.querySelector('.usage-details'),
        };
        ApiSettings.init(appState, elements, this);
        UsageReporter.init(appState, elements, this);
        GeneralSettings.init(appState, elements, this);
        elements.tabList.addEventListener('click', handleTabClick);
        if (elements.usageFilterGroup) {
            elements.usageFilterGroup.addEventListener('click', handleFilterClick);
        }
        if (elements.chartsGrid) {
             elements.chartsGrid.addEventListener('click', handleFilterClick);
        }
        if (elements.usageDetails) {
             elements.usageDetails.addEventListener('click', handleFilterClick);
        }
        checkAndResetDailyUsage();
        startResetCountdown();
        isInitialized = true;
        console.log('SettingsController Initialized.');
    },
    render() {
        if (!isInitialized) this.init();
        ApiSettings.render();
        GeneralSettings.render();
        const activeTab = document.querySelector('#settings-tabs-list .tab-btn.active')?.dataset.tab;
        if (activeTab === 'tab-usage') {
            UsageReporter.render();
        }
    }
};