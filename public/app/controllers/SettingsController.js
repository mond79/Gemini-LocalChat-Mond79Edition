// [Controller] Orchestrates all settings-related modules for the settings page view.
import { appState } from '../state/AppState.js';
import { saveData } from '../../utils/storage.js';
import { ApiSettings } from '../modules/settings/ApiSettings.js';
import { UsageReporter } from '../modules/settings/UsageReporter.js';
import { GeneralSettings } from '../modules/settings/GeneralSettings.js';
import { MemoryVisualizer } from '../modules/settings/MemoryVisualizer.js'; 
import { MemoryBrowser } from '../modules/settings/MemoryBrowser.js'; 
import { LunaDiary } from '../modules/settings/LunaDiary.js';

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
    
    // 탭을 클릭했을 때, 해당 탭에 맞는 모듈의 render 함수를 호출합니다.
    if (targetTabId === 'tab-usage') {
        UsageReporter.render();
    } else if (targetTabId === 'tab-data') {
        MemoryVisualizer.render();
    } else if (targetTabId === 'tab-memory-browser') {
        MemoryBrowser.render();
    } else if (targetTabId === 'tab-luna-diary') {
        LunaDiary.render();
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
            focusMinutesInput: document.getElementById('focus-minutes-input')
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

        // 페이지가 처음 로드될 때 활성화된 탭을 확인하고,
        // 만약 '데이터 관리' 탭이라면 차트를 바로 그리도록 합니다.
        const activeTab = document.querySelector('#settings-tabs-list .tab-btn.active')?.dataset.tab;
        if (activeTab === 'tab-data') {
            MemoryVisualizer.render();
        } else if (activeTab === 'tab-memory-browser') { 
            MemoryBrowser.render();
        } else if (activeTab === 'tab-luna-diary') { 
                LunaDiary.render();
        }

        // ✨ '집중 시간' 입력창 이벤트 리스너
        if (elements.focusMinutesInput) {
            elements.focusMinutesInput.addEventListener('change', async (e) => {
                const minutes = e.target.value;
                try {
                    const response = await fetch('/api/settings/focus-minutes', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ minutes: minutes })
                    });
                    const data = await response.json();
                    if (data.success) {
                        e.target.value = data.minutes; // 서버가 보정한 값으로 UI 업데이트
                        console.log('집중 시간이 성공적으로 저장되었습니다:', data.minutes);
                    }
                } catch (error) {
                    console.error('집중 시간 저장 실패:', error);
                }
            });
        }

        isInitialized = true;
        console.log('SettingsController Initialized.');
    },
    async render() {
        if (!isInitialized) this.init();
        ApiSettings.render();
        GeneralSettings.render();

        // ✨ 2. 서버에서 현재 '집중 시간' 설정을 가져와 UI에 표시
        if (elements.focusMinutesInput) {
            try {
                const response = await fetch('/api/settings/focus-minutes');
                const data = await response.json();
                elements.focusMinutesInput.value = data.minutes;
            } catch (error) {
                console.error('집중 시간 로드 실패:', error);
                elements.focusMinutesInput.value = 25; // 로드 실패 시 기본값 25로 설정
            }
        }
        
        // 현재 활성화된 탭을 찾아서, 그 탭에 맞는 모듈의 render 함수를 호출합니다.
        const activeTab = document.querySelector('#settings-tabs-list .tab-btn.active')?.dataset.tab;
        
        if (activeTab === 'tab-usage') {
            UsageReporter.render();
        } else if (activeTab === 'tab-data') {
            MemoryVisualizer.render();
        } else if (activeTab === 'tab-memory-browser') {
            MemoryBrowser.render();
        } else if (activeTab === 'tab-luna-diary') {
            LunaDiary.render();
        }
    }
};