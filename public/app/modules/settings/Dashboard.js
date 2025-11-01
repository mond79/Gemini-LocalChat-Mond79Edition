import { createDOMElement } from '../../../components/common.js';

// --- API 호출부 ---
async function fetchData(endpoint) {
    try {
        const response = await fetch(`/api/${endpoint}`);
        if (!response.ok) throw new Error(`${endpoint} API 응답 실패`);
        return await response.json();
    } catch (error) {
        console.error(`[Dashboard] ${endpoint} 데이터 로딩 오류:`, error);
        return [];
    }
}

// --- 렌더링 함수들 ---

function renderMemories(container, data) {
    container.innerHTML = ""; // <<< [핵심] 중복 렌더링 방지
    if (data.length === 0) {
        container.innerHTML = '<p class="dashboard-empty-state">아직 기록된 대화가 없어요. 🧠</p>';
        return;
    }
    
    data.forEach(item => {
        const card = createDOMElement('div', { className: 'dashboard-card memory-card' });
        card.innerHTML = `
            <p class="card-meta">${new Date(item.timestamp).toLocaleString('ko-KR')}</p>
            <p class="card-content user-message"><b>You:</b> ${item.user_message.slice(0, 100)}...</p>
            <p class="card-content model-response"><b>Luna:</b> ${item.luna_response.slice(0, 100)}...</p>
            <p class="card-footer">Emotion: ${item.emotion_tag}</p>
        `;
        container.appendChild(card);
    });
}

function renderFiles(container, data) {
    container.innerHTML = ""; // <<< [핵심] 중복 렌더링 방지
    if (data.length === 0) {
        container.innerHTML = '<p class="dashboard-empty-state">아직 분석된 파일이 없어요. 📂</p>';
        return;
    }

    data.forEach(item => {
        const card = createDOMElement('div', { className: 'dashboard-card file-card' });
        card.innerHTML = `
            <h4 class="card-title">${item.filename}</h4>
            <p class="card-meta">${item.extension} / ${item.file_size_kb || '?'}KB</p>
            <p class="card-summary">${(item.summary || '요약 없음').slice(0, 150)}...</p>
            <p class="card-footer">${new Date(item.uploaded_at).toLocaleDateString()}</p>
        `;
        container.appendChild(card);
    });
}

// Reports 렌더링 함수 
function renderReports(container, data) {
    container.innerHTML = ""; // <<< [핵심] 중복 렌더링 방지
    if (data.length === 0) {
        container.innerHTML = '<p class="dashboard-empty-state">아직 생성된 리포트가 없어요. 🧾</p>';
        return;
    }

    data.forEach(item => {
        const card = createDOMElement('div', { className: 'dashboard-card report-card' });
        card.innerHTML = `
            <h4 class="card-title">${item.title}</h4>
            <p class="card-meta">Type: ${item.type}</p>
            <div class="card-summary markdown-body">${window.marked.parse((item.content_md || '').slice(0, 200))}...</div>
            <p class="card-footer">${new Date(item.created_at).toLocaleDateString()}</p>
        `;
        // 새로 추가된 마크다운 콘텐츠에 코드 하이라이팅 적용
        card.querySelectorAll('pre code').forEach(block => hljs.highlightElement(block));
        container.appendChild(card);
    });
}

// Tasks 렌더링 함수 
function renderTasks(container, data) {
    container.innerHTML = ""; // <<< [핵심] 중복 렌더링 방지
    if (data.length === 0) {
        container.innerHTML = '<p class="dashboard-empty-state">아직 기록된 작업이 없어요. 📅</p>';
        return;
    }

    data.forEach(item => {
        const card = createDOMElement('div', { className: 'dashboard-card task-card' });
        const statusClass = `status-${item.status || 'todo'}`;
        card.innerHTML = `
            <h4 class="card-title">${item.title}</h4>
            <p class="card-meta">Category: ${item.category} / ${item.duration_minutes || 0}분</p>
            <p class="card-summary">감정: ${item.emotion_snapshot || 'N/A'} / 집중도: ${item.focus_level || 'N/A'}</p>
            <p class="card-footer ${statusClass}">${item.status}</p>
        `;
        container.appendChild(card);
    });
}


// --- 메인 컨트롤러 ---
export const Dashboard = {
    async render(tabId) {
        const paneId = `dashboard-${tabId}`;
        const container = document.getElementById(paneId);
        if (!container) return;

        container.innerHTML = `<p>${tabId} 데이터를 불러오는 중...</p>`;
        const data = await fetchData(tabId);

        if (tabId === 'memories') renderMemories(container, data);
        else if (tabId === 'files') renderFiles(container, data);
        else if (tabId === 'reports') renderReports(container, data); // <<<--- 연결
        else if (tabId === 'tasks') renderTasks(container, data);     // <<<--- 연결
    },

    init() {
        const tabContainer = document.querySelector('.dashboard-tabs');
        if (!tabContainer || tabContainer.dataset.initialized) return; // 중복 초기화 방지

        tabContainer.addEventListener('click', (e) => {
            const button = e.target.closest('.dashboard-tab-btn');
            if (!button) return;

            tabContainer.querySelector('.active').classList.remove('active');
            button.classList.add('active');

            document.querySelector('.dashboard-pane.active').classList.remove('active');
            const targetPaneId = button.dataset.dashboardTab;
            document.getElementById(targetPaneId).classList.add('active');

            const tabId = targetPaneId.replace('dashboard-', '');
            this.render(tabId);
        });

        // 초기 탭 로드
        this.render('memories');
        tabContainer.dataset.initialized = 'true';
        console.log('📊 루나 대시보드 모듈이 초기화되었습니다.');
    }
};