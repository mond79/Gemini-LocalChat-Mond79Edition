// StudyLoop.js - 자율 공부/휴식 루프 UI 및 상태 관리

// --- 모듈 상태 변수 ---
let currentSession = {
    id: null,        // DB에 기록된 현재 활동 로그의 ID
    timer: null,     // setInterval 객체
    container: null  // UI가 그려지고 있는 HTML 요소
};

// --- 내부 헬퍼 함수 ---

// API 호출을 위한 범용 함수
async function api(path, body) {
    try {
        const res = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
        if (!res.ok) throw new Error(`API 요청 실패: ${res.statusText}`);
        return await res.json();
    } catch (error) {
        console.error(`[StudyLoop] API 오류 (${path}):`, error);
        return { success: false, message: error.message };
    }
}

// ✨ '집중'이 끝나거나 '휴식'이 끝난 후, 다음 '공부' 세션을 시작하는 함수
async function startNextStudySession(container, previousActivity) {
    // 이전 활동에 대한 메시지를 표시
    const message = (previousActivity === 'break') ? 
        "휴식이 끝났습니다. 다음 집중 세션을 시작합니다!" : 
        "휴식을 건너뛰고 다음 집중 세션을 시작합니다.";
    
    container.innerHTML = `<p style="text-align:center; color:var(--text-color-secondary);">${message}</p>`;

    // 백엔드에 새로운 세션 시작을 알림
    const startResult = await StudyLoop.start(`루프 재시작`);
    if (startResult.success) {
        const focusMinutes = await loadFocusMinutes(); // 사용자 설정 시간 가져오기
        // 새로운 타이머 UI 렌더링
        StudyLoop.renderTimerUI(container, focusMinutes * 60);
    } else {
        container.innerHTML = `<p style="color:red;">새로운 세션 시작 실패: ${startResult.message}</p>`;
    }
}

// ✨ 휴식 타이머 UI를 그리고, 중간 종료 기능을 제공하는 새로운 함수
function renderBreakTimer(container, minutes) {
    let remainingSeconds = minutes * 60;
    if (currentSession.timer) clearInterval(currentSession.timer);

    // 휴식이 끝나거나 중단되면 다음 공부 세션을 시작하는 함수
    const onBreakFinish = () => startNextStudySession(container, 'break');

    const updateDisplay = () => {
        const m = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
        const s = String(remainingSeconds % 60).padStart(2, '0');
        container.innerHTML = `
            <div class="study-timer" style="padding: 15px; background-color: var(--background-color-secondary); border-radius: 8px; text-align: center;">
                <p style="margin: 0 0 10px 0; font-size: 1.2em;">☕ 휴식 중...</p>
                <h2 style="margin: 0 0 15px 0; font-size: 3em; font-weight: bold;">${m}:${s}</h2>
                <button id="finish-break-btn" class="action-btn">휴식 건너뛰기</button>
            </div>
        `;
        const btn = container.querySelector('#finish-break-btn');
        if (btn) btn.onclick = () => { clearInterval(currentSession.timer); onBreakFinish(); };
    };

    updateDisplay();
    currentSession.timer = setInterval(() => {
        remainingSeconds--;
        if (remainingSeconds < 0) {
            clearInterval(currentSession.timer);
            onBreakFinish();
        } else {
            const timerDisplay = container.querySelector('h2');
            if (timerDisplay) {
                 timerDisplay.textContent = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;
            }
        }
    }, 1000);
}

// ✨ '집중'이 끝났을 때 호출될 단일 함수
async function handleFinish() {
    if (!currentSession.id) return;

    const result = await StudyLoop.finish();
    const event = new CustomEvent('add-system-message', {
        detail: { text: result.success ? `✅ 집중 시간이 종료되었습니다. (${result.durationMinutes}분)` : `❌ 타이머 종료 중 오류: ${result.message}` }
    });
    document.dispatchEvent(event);

    // ✨ 종료 후, '휴식 선택 UI'를 렌더링!
    if (currentSession.container) {
        const container = currentSession.container;
        currentSession.container = null; // 컨테이너 참조 초기화
        StudyLoop.renderBreakChoices(container, (breakMinutes) => {
            if (breakMinutes > 0) {
                // 사용자가 휴식 시간을 선택하면 휴식 타이머 시작
                renderBreakTimer(container, breakMinutes);
            } else {
                // 사용자가 '건너뛰기'를 선택하면 바로 다음 공부 세션 시작
                startNextStudySession(container, 'skip');
            }
        });
    }
}

// 사용자 설정에서 '집중 시간'을 가져오는 함수
async function loadFocusMinutes() {
    try {
        const res = await fetch('/api/settings/focus-minutes');
        const data = await res.json();
        return data.minutes || 25;
    } catch {
        return 25; // 오류 시 기본값 25분
    }
}


// --- 외부에서 호출할 수 있는 함수들 (Public API) ---
export const StudyLoop = {
    async start(notes = '') {
        const res = await api('/api/activity/start', { activityType: 'study', notes });
        if (res.success) {
            currentSession.id = res.logId;
        }
        return res;
    },

    async finish() {
        if (!currentSession.id) return { success: false, message: '진행 중인 세션이 없습니다.' };
        if (currentSession.timer) clearInterval(currentSession.timer);
        
        const logIdToFinish = currentSession.id;
        currentSession.id = null;
        currentSession.timer = null;
        
        return await api('/api/activity/finish', { logId: logIdToFinish });
    },
    
    getCurrentSessionId: () => currentSession.id,

    renderTimerUI(container, seconds) {
        if (currentSession.timer) clearInterval(currentSession.timer);
        
        currentSession.container = container;
        let remainingSeconds = seconds;

        const updateDisplay = () => {
            if (remainingSeconds < 0) return;
            const minutes = String(Math.floor(remainingSeconds / 60)).padStart(2, '0');
            const secondsValue = String(remainingSeconds % 60).padStart(2, '0');
            
            container.innerHTML = `
                <div class="study-timer" style="padding: 15px; background-color: var(--background-color-secondary); border-radius: 8px; text-align: center;">
                    <p style="margin: 0 0 10px 0; font-size: 1.2em;">⏳ 집중 시간</p>
                    <h2 style="margin: 0 0 15px 0; font-size: 3em; font-weight: bold;">${minutes}:${secondsValue}</h2>
                    <button id="finish-study-btn" class="danger-btn">지금 종료하기</button>
                </div>
            `;
            
            const finishButton = container.querySelector('#finish-study-btn');
            if (finishButton) {
                finishButton.onclick = handleFinish;
            }
        };

        updateDisplay();

        currentSession.timer = setInterval(() => {
            remainingSeconds--;
            if (remainingSeconds < 0) {
                clearInterval(currentSession.timer);
                handleFinish();
            } else {
                const timerDisplay = container.querySelector('h2');
                if (timerDisplay) {
                     timerDisplay.textContent = `${String(Math.floor(remainingSeconds / 60)).padStart(2, '0')}:${String(remainingSeconds % 60).padStart(2, '0')}`;
                }
            }
        }, 1000);
    },

    renderBreakChoices(container, onPick) {
        container.innerHTML = `
            <div class="break-choices" style="padding: 15px; background-color: var(--background-color-secondary); border-radius: 8px; text-align: center;">
                <p style="margin:0 0 10px 0;">고생하셨어요. 다음 단계를 선택해주세요. 😊</p>
                <div style="display:flex; gap:10px; justify-content: center;">
                    <button data-minutes="5" class="file-task-btn">5분 휴식</button>
                    <button data-minutes="10" class="file-task-btn">10분 휴식</button>
                    <button data-minutes="0" class="action-btn primary">바로 다음 세션</button>
                </div>
            </div>`;
        container.querySelectorAll('button').forEach(btn => {
            btn.onclick = () => onPick(parseInt(btn.dataset.minutes, 10));
        });
    }
};