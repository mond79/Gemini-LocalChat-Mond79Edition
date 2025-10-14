// 메인 앱의 상태를 직접 import
import { appState, saveState } from './app/state/AppState.js';
import * as Session from './app/state/SessionManager.js';

let elements = {};

function renderPromptTemplates() {
    if (!elements.templateListBody) return;
    
    elements.templateListBody.innerHTML = '';
    const templates = appState.promptTemplates || [];
    
    if (templates.length === 0) {
        elements.templateListBody.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                    <polyline points="14,2 14,8 20,8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
                <h3>저장된 템플릿이 없습니다</h3>
                <p>새로운 시스템 프롬프트 템플릿을 추가해보세요</p>
            </div>
        `;
        return;
    }
    
    templates.forEach(template => {
        const templateCard = document.createElement('div');
        templateCard.className = 'template-card';
        templateCard.setAttribute('data-template-id', template.id);
        templateCard.innerHTML = `
            <div class="template-header">
                <h3 class="template-title">${template.title}</h3>
                <div class="template-actions">
                    <button class="btn-icon apply-template-btn" data-id="${template.id}" title="현재 세션에 적용">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="20,6 9,17 4,12"></polyline>
                        </svg>
                    </button>
                    <button class="btn-icon set-default-btn ${appState.settings.defaultSystemPromptId === template.id ? 'active' : ''}" data-id="${template.id}" title="기본 템플릿으로 설정">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"></polygon>
                        </svg>
                    </button>
                    <button class="btn-icon edit-template-btn" data-id="${template.id}" title="템플릿 수정">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                    </button>
                    <button class="btn-icon delete-template-btn" data-id="${template.id}" title="템플릿 삭제">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3,6 5,6 21,6"></polyline>
                            <path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="template-content">
                <p class="template-preview">${template.text.length > 120 ? template.text.substring(0, 120) + '...' : template.text}</p>
            </div>
        `;
        
        templateCard.querySelector('.apply-template-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleApplyTemplate(e.currentTarget.dataset.id);
        });
        
        templateCard.querySelector('.set-default-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleSetDefaultTemplate(e.currentTarget.dataset.id);
        });
        
        templateCard.querySelector('.edit-template-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleEditTemplate(e.currentTarget.dataset.id);
        });
        
        templateCard.querySelector('.delete-template-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            handleDeleteTemplate(e.currentTarget.dataset.id);
        });
        
        elements.templateListBody.appendChild(templateCard);
    });
}

function handleCreateTemplate() {
    const title = elements.newTemplateTitleInput.value.trim();
    const text = elements.newTemplateTextInput.value.trim();
    const editingId = elements.saveTemplateBtn.getAttribute('data-editing-id');
    
    if (!title || !text) {
        showNotification('템플릿 제목과 내용을 모두 입력해주세요.', 'warning');
        return;
    }
    
    if (!appState.promptTemplates) appState.promptTemplates = [];
    
    if (editingId) {
        // 수정 모드
        const templateIndex = appState.promptTemplates.findIndex(t => t.id === editingId);
        if (templateIndex !== -1) {
            appState.promptTemplates[templateIndex] = {
                ...appState.promptTemplates[templateIndex],
                title,
                text
            };
            showNotification('템플릿이 수정되었습니다.', 'success');
        }
        
        // 수정 모드 해제
        elements.saveTemplateBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17,21 17,13 7,13 7,21"></polyline>
                <polyline points="7,3 7,8 15,8"></polyline>
            </svg>
            템플릿 저장
        `;
        elements.saveTemplateBtn.removeAttribute('data-editing-id');
        
        // 취소 버튼 숨기기
        if (elements.cancelEditBtn) {
            elements.cancelEditBtn.classList.add('hidden');
        }
        
        // 폼에서 수정 모드 클래스 제거
        const promptForm = elements.saveTemplateBtn.closest('.prompt-form');
        if (promptForm) {
            promptForm.classList.remove('editing-mode');
        }
    } else {
        // 새 템플릿 생성 모드
        const newTemplate = { id: `template-${Date.now()}`, title, text };
        appState.promptTemplates.push(newTemplate);
        showNotification('새 템플릿이 저장되었습니다.', 'success');
        
        // 새로 추가된 템플릿에 애니메이션 효과 적용
        setTimeout(() => {
            const newCard = elements.templateListBody.querySelector(`[data-template-id="${newTemplate.id}"]`);
            if (newCard) {
                newCard.classList.add('new-template');
            }
        }, 50);
    }
    
    saveState();
    
    // 폼 초기화
    elements.newTemplateTitleInput.value = '';
    elements.newTemplateTextInput.value = '';
    
    // 템플릿 목록 다시 렌더링
    renderPromptTemplates();
}

function showNotification(message, type = 'info') {
    // 간단한 알림 표시 (기존 toast 시스템이 있다면 그것을 사용)
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 12px 20px;
        background: ${type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        font-size: 0.9em;
        font-weight: 500;
        animation: slideInRight 0.3s ease;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.animation = 'slideOutRight 0.3s ease forwards';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

function handleApplyTemplate(templateId) {
    // 현재 활성 세션에 시스템 프롬프트 적용
    if (appState.activeSessionId && appState.sessions[appState.activeSessionId]) {
        const template = appState.promptTemplates.find(t => t.id === templateId);
        const activeSession = appState.sessions[appState.activeSessionId];
        
        // 직접 시스템 프롬프트 업데이트
        activeSession.systemPromptId = templateId === 'none' ? null : templateId;
        activeSession.lastModified = Date.now();
        
        // 상태 저장
        saveState();
        
        // 적용 완료 알림
        showNotification(`"${template?.title}" 템플릿이 현재 세션에 적용되었습니다.`, 'success');
        
        console.log('Template applied:', {
            templateId,
            templateTitle: template?.title,
            sessionId: appState.activeSessionId,
            systemPromptId: activeSession.systemPromptId,
            sessionData: activeSession
        });
        
        // 모달 닫기 이벤트 발생
        setTimeout(() => {
            document.dispatchEvent(new CustomEvent('modal-closed'));
        }, 1000);
    } else {
        console.warn('No active session found:', {
            activeSessionId: appState.activeSessionId,
            sessions: Object.keys(appState.sessions || {})
        });
        showNotification('활성 세션이 없습니다. 먼저 채팅을 시작해주세요.', 'warning');
    }
}

function handleSetDefaultTemplate(templateId) {
    const template = appState.promptTemplates.find(t => t.id === templateId);
    
    // 현재 기본 템플릿과 같다면 기본 설정 해제
    if (appState.settings.defaultSystemPromptId === templateId) {
        appState.settings.defaultSystemPromptId = null;
        showNotification('기본 템플릿 설정이 해제되었습니다.\n새로운 채팅에서는 시스템 프롬프트가 적용되지 않습니다.', 'success');
    } else {
        // 새로운 기본 템플릿 설정
        appState.settings.defaultSystemPromptId = templateId;
        showNotification(`"${template?.title}" 템플릿이 기본 템플릿으로 설정되었습니다.\n새로운 채팅에서 자동으로 적용됩니다.`, 'success');
    }
    
    // 상태 저장
    saveState();
    
    // 템플릿 목록 다시 렌더링 (별표 표시 업데이트)
    renderPromptTemplates();
    
    console.log('Default template updated:', {
        templateId,
        templateTitle: template?.title,
        defaultSystemPromptId: appState.settings.defaultSystemPromptId,
        currentSettings: appState.settings
    });
}

function handleEditTemplate(templateId) {
    const template = appState.promptTemplates.find(t => t.id === templateId);
    if (!template) return;
    
    // 폼에 기존 데이터 채우기
    elements.newTemplateTitleInput.value = template.title;
    elements.newTemplateTextInput.value = template.text;
    
    // 저장 버튼을 수정 모드로 변경
    elements.saveTemplateBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        템플릿 수정
    `;
    elements.saveTemplateBtn.setAttribute('data-editing-id', templateId);
    
    // 취소 버튼 표시
    if (elements.cancelEditBtn) {
        elements.cancelEditBtn.classList.remove('hidden');
    }
    
    // 폼에 수정 모드 클래스 추가
    const promptForm = elements.saveTemplateBtn.closest('.prompt-form');
    if (promptForm) {
        promptForm.classList.add('editing-mode');
    }
    
    // 폼으로 스크롤
    elements.newTemplateTitleInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    elements.newTemplateTitleInput.focus();
    
    showNotification(`"${template.title}" 템플릿을 수정 중입니다.`, 'info');
}

function handleCancelEdit() {
    // 폼 초기화
    elements.newTemplateTitleInput.value = '';
    elements.newTemplateTextInput.value = '';
    
    // 저장 버튼을 원래 상태로 복원
    elements.saveTemplateBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17,21 17,13 7,13 7,21"></polyline>
            <polyline points="7,3 7,8 15,8"></polyline>
        </svg>
        템플릿 저장
    `;
    elements.saveTemplateBtn.removeAttribute('data-editing-id');
    
    // 취소 버튼 숨기기
    if (elements.cancelEditBtn) {
        elements.cancelEditBtn.classList.add('hidden');
    }
    
    // 폼에서 수정 모드 클래스 제거
    const promptForm = elements.saveTemplateBtn.closest('.prompt-form');
    if (promptForm) {
        promptForm.classList.remove('editing-mode');
    }
    
    showNotification('수정이 취소되었습니다.', 'info');
}

function handleDeleteTemplate(templateId) {
    const template = appState.promptTemplates.find(t => t.id === templateId);
    if (!template) return;
    
    // 더 세련된 확인 대화상자 (실제로는 커스텀 모달을 사용하는 것이 좋음)
    if (confirm(`"${template.title}" 템플릿을 정말로 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`)) {
        // 기본 템플릿으로 설정되어 있다면 해제
        if (appState.settings.defaultSystemPromptId === templateId) {
            appState.settings.defaultSystemPromptId = null;
        }
        
        // 삭제 애니메이션
        const templateCard = document.querySelector(`[data-template-id="${templateId}"]`);
        if (templateCard) {
            templateCard.style.animation = 'templateSlideOut 0.3s ease forwards';
            setTimeout(() => {
                appState.promptTemplates = appState.promptTemplates.filter(t => t.id !== templateId);
                saveState();
                renderPromptTemplates();
                showNotification('템플릿이 삭제되었습니다.', 'success');
            }, 300);
        } else {
            appState.promptTemplates = appState.promptTemplates.filter(t => t.id !== templateId);
            saveState();
            renderPromptTemplates();
            showNotification('템플릿이 삭제되었습니다.', 'success');
        }
    }
}

export function init(contentWrapper) {
    // contentWrapper가 제공되면 해당 컨테이너 내에서 요소를 찾고, 아니면 document에서 찾음
    const container = contentWrapper || document;
    
    elements = {
        newTemplateTitleInput: container.querySelector('#new-template-title'),
        newTemplateTextInput: container.querySelector('#new-template-text'),
        saveTemplateBtn: container.querySelector('#save-template-btn'),
        cancelEditBtn: container.querySelector('#cancel-edit-btn'),
        templateListBody: container.querySelector('#template-list-body'),
        closeBtn: container.querySelector('#prompt-editor-close'),
    };
    
    console.log('Prompt editor initialized with state:', {
        activeSessionId: appState.activeSessionId,
        sessionsCount: Object.keys(appState.sessions || {}).length,
        templatesCount: (appState.promptTemplates || []).length
    });

    if (elements.saveTemplateBtn) {
        elements.saveTemplateBtn.addEventListener('click', handleCreateTemplate);
    }
    
    if (elements.cancelEditBtn) {
        elements.cancelEditBtn.addEventListener('click', handleCancelEdit);
    }
    
    if (elements.closeBtn) {
        elements.closeBtn.addEventListener('click', () => {
            // 모달 닫기 이벤트 발생
            document.dispatchEvent(new CustomEvent('modal-close-requested'));
        });
    }
    
    renderPromptTemplates();
}