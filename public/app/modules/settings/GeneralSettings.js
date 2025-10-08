// [Module] Manages general app settings like typing speed and data reset.
import { saveData } from '../../../utils/storage.js';

let appState, elements, controller;

function getTodaysUTCDateString() {
    const now = new Date();
    return new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
}

function handleResetAllSessions() {
    const confirmationText = '초기화';
    const userInput = prompt(`모든 폴더와 대화 기록이 영구적으로 삭제됩니다.\n이 작업을 확인하려면 "${confirmationText}" 라고 입력해주세요.`);
    if (userInput === confirmationText) {
        document.dispatchEvent(new CustomEvent('request-session-reset'));
        alert("모든 세션이 초기화되었습니다.");
    } else {
        alert("입력이 일치하지 않아 취소되었습니다.");
    }
}

function handleClearUsageHistory() {
    if (confirm('정말로 모든 API 사용 기록을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
        appState.usage = [];
        appState.dailyUsage = { date: getTodaysUTCDateString(), usageByKey: {} };
        saveData(appState);
        alert("모든 API 사용 기록이 삭제되었습니다.");
        // [MODIFIED] Request a full re-render from the parent controller
        if (controller) {
            controller.render();
        }
    }
}

export const GeneralSettings = {
    init(_appState, _elements, _controller) {
        appState = _appState;
        elements = _elements;
        controller = _controller; // Store reference to parent controller

        elements.resetSessionsBtn.addEventListener('click', handleResetAllSessions);
        elements.clearUsageHistoryBtn.addEventListener('click', handleClearUsageHistory);

        elements.typingSpeedSlider.addEventListener('input', (e) => {
            const speed = parseInt(e.target.value, 10);
            appState.settings.typingSpeed = speed;
            elements.typingSpeedValue.textContent = speed;
            saveData(appState);
        });
        elements.mathRendererRadios.forEach(radio => radio.addEventListener('change', e => {
            if(e.target.checked) {
                appState.settings.mathRenderer = e.target.value;
                saveData(appState);
            }
        }));
        elements.historyTokenLimitInput.addEventListener('input', e => {
            appState.settings.historyTokenLimit = parseInt(e.target.value, 10) || 0;
            saveData(appState);
        });
    },
    render() {
        elements.historyTokenLimitInput.value = appState.settings?.historyTokenLimit || 0;
        const typingSpeed = appState.settings?.typingSpeed ?? 30;
        elements.typingSpeedSlider.value = typingSpeed;
        elements.typingSpeedValue.textContent = typingSpeed;
        elements.mathRendererRadios.forEach(radio => {
            radio.checked = radio.value === (appState.settings?.mathRenderer || 'katex');
        });
    }
};