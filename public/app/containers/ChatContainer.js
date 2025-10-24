// [Container] This module now manages the lifecycle of all session views.
import { $, $$ } from '../../utils/dom.js';
import { createDOMElement } from '../../components/common.js';
import { appState } from '../state/AppState.js';
import { CommentaryEngine } from '../controllers/CommentaryEngine.js'; 
import { getCategorizedModels } from '../state/ModelManager.js';
import { manage as manageThinkingIndicatorHelper } from '../components/ThinkingIndicator.js';
import { create as createMessageElement } from '../components/Message.js';
import * as AnimationManager from '../modules/AnimationManager.js';
import { applySyntaxHighlighting } from '../utils/highlighter.js';
import { renderMathInElement } from '../utils/MathRenderer.js';

let elements;
const sessionViewCache = new Map();
let activeActionsEl = null;
let lastMouseY = 0;
let hoveredMessageEl = null;
let rafId = null;
let hideTimeout = null;
let isTransitioning = false;

function updateScrollShadows() {
    if (!elements.chatBox || !elements.chatHeader || !elements.scrollFadeBottom) return;
    const { scrollTop, scrollHeight, clientHeight } = elements.chatBox;
    const threshold = 1;
    elements.chatHeader.classList.toggle('header-scrolled', scrollTop > threshold);
    const isAtBottom = scrollHeight - scrollTop - clientHeight <= threshold;
    elements.scrollFadeBottom.classList.toggle('visible', !isAtBottom);
}

function updateActionsPosition() {
    if (!activeActionsEl || !hoveredMessageEl) return;
    const messageRect = hoveredMessageEl.getBoundingClientRect();
    const chatBoxRect = elements.chatBox.getBoundingClientRect();
    const left = messageRect.right < (chatBoxRect.left + chatBoxRect.width - activeActionsEl.offsetWidth) ? messageRect.right + 10 : chatBoxRect.right - activeActionsEl.offsetWidth - 10;
    activeActionsEl.style.left = `${left}px`;
    const top = Math.max(chatBoxRect.top + 10, Math.min(lastMouseY - 20, chatBoxRect.bottom - activeActionsEl.offsetHeight - 10));
    activeActionsEl.style.top = `${top}px`;
    rafId = requestAnimationFrame(updateActionsPosition);
}

function handleMouseMove(e) {
    lastMouseY = e.clientY;
    const targetEl = e.target;
    const messageEl = targetEl.closest('.message');

    if (targetEl.closest('.message-actions')) {
        clearTimeout(hideTimeout);
        return;
    }

    if (messageEl && (messageEl.classList.contains('user') || messageEl.classList.contains('model') || messageEl.classList.contains('system'))) {
        clearTimeout(hideTimeout);
        hoveredMessageEl = messageEl;
        const actionsEl = messageEl.querySelector('.message-actions');
        if (actionsEl && actionsEl !== activeActionsEl) {
            hideActiveActions(true);
            activeActionsEl = actionsEl;
            activeActionsEl.classList.add('visible');
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(updateActionsPosition);
        }
    } else {
        clearTimeout(hideTimeout);
        hideTimeout = setTimeout(() => hideActiveActions(true), 200);
    }
}

function hideActiveActions(immediate = false) {
    if (activeActionsEl) {
        activeActionsEl.classList.remove('visible');
        activeActionsEl = null;
    }
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
}

function createAndCacheSessionView(sessionId) {
    const session = appState.sessions[sessionId];
    if (!session) return null;
    const viewContainer = createDOMElement('div', { id: `session-view-${sessionId}`, className: 'message-list-container' });
    session.history.forEach((message) => {
        viewContainer.appendChild(createMessageElement(message, session));
    });
    applySyntaxHighlighting(viewContainer);
    renderMathInElement(viewContainer);
    elements.chatBox.appendChild(viewContainer);
    sessionViewCache.set(sessionId, viewContainer);
    return viewContainer;
}

function renderHeader(state) {
    const activeSession = state.sessions[state.activeSessionId];
    elements.sessionTitleHeader.textContent = activeSession ? activeSession.title : '...';
}

function renderModelSelector(state) {
    const activeSession = state.sessions[state.activeSessionId];
    if (!activeSession) return;

    const { availableModels } = state;
    const currentModel = availableModels.find(m => m.id === activeSession.model);
    
    console.log('Rendering model selector:', {
        activeSessionId: state.activeSessionId,
        sessionModel: activeSession.model,
        currentModelFound: !!currentModel,
        currentModelName: currentModel?.name,
        availableModelsCount: availableModels.length,
        triggerElement: !!elements.modelSelectorTrigger
    });
    
    // 모델 이름을 깔끔하게 표시하는 함수 (위에서 정의한 것과 동일)
    const getCleanModelName = (model) => {
        let name = model.name || model.id;
        name = name.replace(/\s*\([^)]*\)$/, '');
        if (name.trim().length < 3) {
            name = model.name || model.id;
        }
        return name.trim();
    };

    // UI 업데이트 강제 실행
    const triggerElement = elements.modelSelectorTrigger || document.querySelector('#model-selector-trigger');
    if (triggerElement) {
        const newText = currentModel ? getCleanModelName(currentModel) : '모델 선택';
        triggerElement.textContent = newText;
        
        // 강제로 DOM 업데이트 트리거
        triggerElement.style.display = 'none';
        triggerElement.offsetHeight; // 강제 리플로우
        triggerElement.style.display = '';
        
        console.log('Model selector trigger updated to:', newText);
    } else {
        console.error('Model selector trigger element not found!');
    }
    elements.modelSelectorDropdown.innerHTML = '';

    const { favoriteModels, otherModels } = getCategorizedModels(state);
    const totalModels = favoriteModels.length + otherModels.length;

    // 모델이 없을 때 설정으로 안내하는 버튼 표시
    if (totalModels === 0) {
        const noModelsMessage = createDOMElement('div', { className: 'no-models-container' });
        const messageText = createDOMElement('div', { className: 'no-models-text' }, '사용 가능한 모델이 없습니다');
        const settingsBtn = createDOMElement('div', { 
            className: 'model-item settings-guide-btn', 
            id: 'go-to-model-settings-btn' 
        });
        
        const settingsIcon = createDOMElement('span', { className: 'settings-icon' }, '⚙️');
        const settingsText = createDOMElement('span', { className: 'settings-text' }, '모델 설정으로 이동');
        
        settingsBtn.appendChild(settingsIcon);
        settingsBtn.appendChild(settingsText);
        
        noModelsMessage.appendChild(messageText);
        noModelsMessage.appendChild(settingsBtn);
        elements.modelSelectorDropdown.appendChild(noModelsMessage);
        return;
    }



    const createModelItem = model => {
        const isSelected = model.id === activeSession.model;
        const item = createDOMElement('div', { className: `model-item ${isSelected ? 'selected' : ''}`, 'data-model-id': model.id });
        const modelName = createDOMElement('span', { className: 'model-name' }, getCleanModelName(model));
        item.appendChild(modelName);
        if (isSelected) {
            const checkmark = createDOMElement('span', { className: 'checkmark' }, '✓');
            item.appendChild(checkmark);
        }
        return item;
    };

    // 즐겨찾기 모델들을 먼저 표시
    if (favoriteModels.length > 0) {
        favoriteModels.forEach(model => elements.modelSelectorDropdown.appendChild(createModelItem(model)));
    }

    // 즐겨찾기와 일반 모델 사이에 구분선 추가 (둘 다 있을 때만)
    if (favoriteModels.length > 0 && otherModels.length > 0) {
        elements.modelSelectorDropdown.appendChild(createDOMElement('div', { className: 'model-list-separator' }));
    }

    // 모든 일반 모델들을 바로 표시 (More models 버튼 없이)
    if (otherModels.length > 0) {
        otherModels.forEach(model => elements.modelSelectorDropdown.appendChild(createModelItem(model)));
    }
}

function renderSystemPromptSelector(state) {
    const activeSession = state.sessions[state.activeSessionId];
    if (!activeSession) {
        elements.systemPromptSelectorArea.classList.add('hidden');
        return;
    }
    // 활성 세션이 있으면 관리 버튼을 표시
    elements.systemPromptSelectorArea.classList.remove('hidden');
}

export function init() {
    elements = {
        chatArea: $('.chat-area'),
        inputArea: $('.input-area'),
        chatBox: $('#chat-box'),
        chatHeader: $('.chat-header'),
        sessionTitleHeader: $('#session-title-header'),
        scrollFadeBottom: $('#scroll-fade-bottom'),
        systemPromptSelectorArea: $('#system-prompt-selector-area'),
        modelSelectorTrigger: $('#model-selector-trigger'),
        modelSelectorDropdown: $('#model-selector-dropdown'),
        welcomeContainer: $('#welcome-container'),
        chatBoxWrapper: $('#chat-box-wrapper'),
    };
    elements.chatBox.addEventListener('scroll', () => { hideActiveActions(true); updateScrollShadows(); }, true);
    elements.chatBox.addEventListener('mousemove', handleMouseMove);
    elements.chatBox.addEventListener('mouseleave', () => { hideTimeout = setTimeout(() => hideActiveActions(true), 200); });
    const resizeObserver = new ResizeObserver(() => updateScrollShadows());
    resizeObserver.observe(elements.chatBox);
    updateScrollShadows();
}

function _updateViewForSession(newSessionId) {
    if (isTransitioning) return;

    CommentaryEngine.stop();

    const parentContainer = elements.chatBox;
    const outgoingView = parentContainer.querySelector('.message-list-container[style*="display: flex"]');
    let incomingView = sessionViewCache.get(newSessionId);
    if (!incomingView) {
        incomingView = createAndCacheSessionView(newSessionId);
    }

    if (!incomingView || (outgoingView && outgoingView.id === incomingView.id)) return;

    isTransitioning = true;

    try {
        const session = appState.sessions[newSessionId];
        const isEmpty = !session || session.history.length === 0;
        elements.chatArea.classList.toggle('is-empty', isEmpty);
        elements.welcomeContainer.classList.toggle('hidden', !isEmpty);
        elements.chatBoxWrapper.classList.toggle('hidden', isEmpty);

        incomingView.style.opacity = '0';
        incomingView.classList.add('view-transitioning');
        incomingView.style.display = 'flex';

        if (outgoingView) {
            outgoingView.classList.add('view-transitioning');
        }
        parentContainer.style.height = `${parentContainer.offsetHeight}px`;

        requestAnimationFrame(() => {
            incomingView.style.opacity = '1';
            if (outgoingView) {
                outgoingView.style.opacity = '0';
            }

            setTimeout(() => {
                parentContainer.style.height = '';
                incomingView.classList.remove('view-transitioning');
                if (outgoingView) {
                    outgoingView.classList.remove('view-transitioning');
                    outgoingView.style.display = 'none';
                }
                updateScrollShadows();
                isTransitioning = false;
            }, 300);
        });

        // [MODIFIED] Always scroll to bottom, remove scrollPosition logic.
        parentContainer.scrollTop = parentContainer.scrollHeight;

        renderHeader(appState);
        renderModelSelector(appState);
        renderSystemPromptSelector(appState);
    } catch (error) {
        console.error("Error during session transition:", error);
        isTransitioning = false;
    }
}

export function switchActiveView(sessionId) {
    if (!sessionId) return;
    _updateViewForSession(sessionId);
}

export function appendMessage(sessionId, message) {
    const session = appState.sessions[sessionId];
    if (!session) return;

    if (session.history.length === 1) {
        elements.chatArea.classList.remove('is-empty');
        elements.welcomeContainer.classList.add('hidden');
        elements.chatBoxWrapper.classList.remove('hidden');
    }

    let view = sessionViewCache.get(sessionId);
    if (!view) view = createAndCacheSessionView(sessionId);
    if (!view) return;
    const messageEl = createMessageElement(message, session);
    view.appendChild(messageEl);
    const isAtBottom = elements.chatBox.scrollHeight - elements.chatBox.scrollTop - elements.chatBox.clientHeight < 50;
    if (isAtBottom) elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
    if (message.role === 'model' && message.receivedAt) {
        const textPartDiv = messageEl.querySelector('.text-part');
        if (textPartDiv) AnimationManager.start(sessionId, message, textPartDiv);
    }
}

export function rerenderSessionView(sessionId) {
    const oldView = sessionViewCache.get(sessionId);
    if (oldView) {
        oldView.remove();
        sessionViewCache.delete(sessionId);
    }
    const newView = createAndCacheSessionView(sessionId);
    if (appState.activeSessionId === sessionId && newView) {
        newView.style.display = 'flex';
    }
    const session = appState.sessions[sessionId];
    if (session && session.history.length === 0) {
        elements.chatArea.classList.add('is-empty');
        elements.welcomeContainer.classList.remove('hidden');
        elements.chatBoxWrapper.classList.add('hidden');
    } else {
        elements.chatArea.classList.remove('is-empty');
    }
}

export function manageThinkingIndicator(sessionId, show) {
    const view = sessionViewCache.get(sessionId);
    if (!view) return;
    manageThinkingIndicatorHelper(show, show ? Date.now() : null, view);
    if (show) elements.chatBox.scrollTop = elements.chatBox.scrollHeight;
}

export function render(state) {
    switchActiveView(state.activeSessionId);
    
    // 모델 변경 시 UI 업데이트를 위해 항상 렌더링
    renderHeader(state);
    renderModelSelector(state);
    renderSystemPromptSelector(state);
}