// [CoreDNA] The main entry point of the application.
import hljs from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/highlight.min.js';
import javascript from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/languages/javascript.min.js';
import python from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/languages/python.min.js';
import css from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/languages/css.min.js';
import xml from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/languages/xml.min.js'; // For HTML
import json from 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/es/languages/json.min.js';

import { appState, refreshState } from './state/AppState.js';
import { setAvailableModels } from './state/ModelManager.js';
import * as Session from './state/SessionManager.js';
import * as GeminiAPIService from './services/GeminiAPIService.js';
import { handlers, renderAll } from './events/handlerOrchestrator.js';
import { bindEvents } from './events/domBindings.js';
import { init as initSessionList } from '../components/SessionList.js';
import * as ChatContainer from './containers/ChatContainer.js';
import { init as initInputArea } from '../components/InputArea.js';
import { init as initModal } from '../components/Modal.js';
import { init as initContextMenu } from '../components/ContextMenu.js';
import { init as initToast } from '../components/Toast.js';
import { load as loadCss } from './utils/CssLoader.js';
import { init as initHighlighter } from './utils/highlighter.js';
import { init as initMathRenderer } from './utils/MathRenderer.js';
import { SettingsController } from './controllers/SettingsController.js';

async function initializeApp() {
    const updateLoadingStatus = (message) => {
        const statusElement = document.querySelector('#app-loading-overlay p');
        if (statusElement) statusElement.textContent = message;
    };

    try {
        // The import of AppState implicitly triggers the sanitization logic from Step 2.
        updateLoadingStatus('데이터 무결성 검사 중...');
        await new Promise(resolve => setTimeout(resolve, 100)); // Short delay for user to see the message

        updateLoadingStatus('UI 리소스 로딩 중...');
        await loadCss([
            './css/base/_reset.css',
            './css/base/theme.css',
            './css/base/global.css',
            './css/layout/main.css',
            './css/utils/helpers.css',
            './css/utils/animations.css',
            './css/components/sidebar.css',
            './css/components/dropdown.css',
            './css/layout/chat-area.css',
            './css/components/message.css',
            './css/components/code-block.css',
            './css/components/input-area.css',
            './css/components/toast.css',
            './css/components/modal.css',
            './css/components/prompt-editor.css',
            './css/pages/settings-page.css',
            './css/pages/settings.css'
        ]);
        
        updateLoadingStatus('핵심 모듈 초기화 중...');
        hljs.registerLanguage('javascript', javascript);
        hljs.registerLanguage('python', python);
        hljs.registerLanguage('css', css);
        hljs.registerLanguage('xml', xml); // HTML
        hljs.registerLanguage('json', json);

        initSessionList();
        ChatContainer.init();
        initInputArea();
        initModal();
        initContextMenu();
        initToast();
        initHighlighter(hljs);
        initMathRenderer();
        SettingsController.init();
        
        if (appState.isDarkMode) document.body.classList.add('dark-mode');
        if (appState.isSidebarCollapsed) document.querySelector('.container').classList.add('sidebar-collapsed');

        bindEvents(handlers);

        document.addEventListener('modal-closed', () => { refreshState(); renderAll(); });
        document.addEventListener('request-session-reset', () => { Session.resetAllSessions(appState); renderAll(); });
        document.addEventListener('model-list-updated', () => { renderAll(); });
        document.addEventListener('animation-complete', (e) => {
            const { sessionId } = e.detail;
            ChatContainer.manageThinkingIndicator(sessionId, false);
            if (appState.loadingStates[sessionId]) delete appState.loadingStates[sessionId];
            renderAll();
        });
        
        // '다시 듣기 시작' 신호를 감지하는 글로벌 이벤트 리스너
        document.addEventListener('start-listening-again', () => {
            // 신호가 감지되면, 마이크 버튼 핸들러를 강제로 호출합니다.
            if (handlers.handleMicClick) {
                handlers.handleMicClick();
            }
        });
        // ==========================================================

        updateLoadingStatus('API 모델 목록 동기화 중...');
        if (appState.settings.apiKey) {
            try {
                const models = await GeminiAPIService.getModels(appState.settings.apiKey);
                setAvailableModels(appState, models);
            } catch (error) {
                console.error('Failed to load models:', error);
                alert(`모델 로드 실패: ${error.message}`);
            }
        }

        updateLoadingStatus('최종 렌더링 준비 중...');
        if (Object.keys(appState.sessions).length === 0) await handlers.handleNewChat();
        renderAll();

    } catch (error) {
        console.error("Application initialization failed:", error);
        updateLoadingStatus(`초기화 실패: ${error.message}`);
        // In case of error, we don't hide the loading screen.
        return;
    }

    // [THE ACTIVATION] Everything is ready. Hide the loading screen.
    document.body.classList.add('loaded');
}

document.addEventListener('DOMContentLoaded', initializeApp);