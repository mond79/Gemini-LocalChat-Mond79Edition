// [Controller] Orchestrates all settings-related modules for the settings page view.
import { appState } from '../state/AppState.js';
import { saveData } from '../../utils/storage.js';
import { ApiSettings } from '../modules/settings/ApiSettings.js';
import { UsageReporter } from '../modules/settings/UsageReporter.js';
import { GeneralSettings } from '../modules/settings/GeneralSettings.js';
import { MemoryVisualizer } from '../modules/settings/MemoryVisualizer.js'; 
import { MemoryBrowser } from '../modules/settings/MemoryBrowser.js'; 
import { LunaDiary } from '../modules/settings/LunaDiary.js';
import { Dashboard } from '../modules/settings/Dashboard.js';

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
    
    // "어떤 탭을 보여줄지"에 대한 결정만 하고,
    // "어떻게 보여줄지"에 대한 구체적인 명령은 showTabContent 함수에게 위임합니다.
    SettingsController.showTabContent(targetTabId);
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
        // --- 1. 각 모듈의 '초기화(init)'를 여기서 단 한번만 실행합니다. ---
        ApiSettings.init(appState, elements, this);
        UsageReporter.init(appState, elements, this);
        GeneralSettings.init(appState, elements, this);
        
        // [핵심 수정 1] LunaDiary의 무거운 초기화 작업을 여기서 딱 한 번만 실행합니다.
        LunaDiary.init(); 

        // --- 2. 이벤트 리스너를 연결합니다. ---
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

        // --- 3. 페이지 첫 로드 시, 활성화된 탭의 콘텐츠를 표시합니다. ---
        const activeTab = document.querySelector('#settings-tabs-list .tab-btn.active')?.dataset.tab;
        this.showTabContent(activeTab);

        isInitialized = true;
        console.log('SettingsController 최종 초기화 완료.');
    },

    // [새로운 기능] '무엇을 그릴지' 결정하는 지휘자 함수
    showTabContent(tabId) {
        if (tabId === 'tab-usage') {
            UsageReporter.render();
        } else if (tabId === 'tab-data') {
            MemoryVisualizer.render();
        } else if (tabId === 'tab-memory-browser') {
            MemoryBrowser.render();
        } else if (tabId === 'tab-luna-diary') {
            // 'show'는 타임라인만 새로고침하는 가벼운 역할을 합니다.
            LunaDiary.show(); 
        } else if (tabId === 'tab-dashboard') { // 대시보드
        Dashboard.init(); // 대시보드의 초기화를 담당하는 init 함수를 호출합니다.
        }
    },
    
    async render() {
        if (!isInitialized) this.init();
        
        ApiSettings.render();
        GeneralSettings.render();

        if (elements.focusMinutesInput) {
            try {
                const response = await fetch('/api/settings/focus-minutes');
                const data = await response.json();
                elements.focusMinutesInput.value = data.minutes;
            } catch (error) {
                console.error('집중 시간 로드 실패:', error);
                elements.focusMinutesInput.value = 25;
            }
        }
        
        // [수정] render 함수는 더 이상 탭 콘텐츠를 직접 그리지 않습니다.
        // 따라서, 기존에 있던 if/else if 블록은 여기서 삭제합니다.
    }
};