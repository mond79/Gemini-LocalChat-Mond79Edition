// [Component] Renders a single message UI, including all its parts and actions.
import { createDOMElement } from '../../../components/common.js';
import { appState } from '../state/AppState.js';
import * as CodeBlock from './CodeBlock.js';
import * as CodeSummary from './CodeSummary.js';
import * as PdfSummary from './PdfSummary.js';
import { StudyLoop } from '../controllers/StudyLoop.js';

function formatCompletionTime(timestamp) {
    const now = new Date();
    const then = new Date(timestamp);
    const isToday = now.toDateString() === then.toDateString();
    if (isToday) {
        return then.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    } else {
        return then.toLocaleString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }).replace(/\. /g, '/').slice(0, -1);
    }
}

function renderMetadata(container, message) {
    const { completionTimestamp, thinkingTime, modelUsed } = message;
    if (!completionTimestamp) return;

    const timeStr = formatCompletionTime(completionTimestamp);
    const durationStr = (thinkingTime / 1000).toFixed(1) + '초';
    const modelStr = modelUsed;
    const metadataText = `(답변 완료: ${timeStr} / ${durationStr} / ${modelStr})`;

    const metadataEl = createDOMElement('div', { className: 'message-metadata' }, metadataText);
    container.appendChild(metadataEl);
}

function renderMessageParts(parts, role, receivedAt) {
    const textView = createDOMElement('div', { className: 'message-text-view' });
    (parts || []).forEach(part => {
        let partContent = null;
        switch(part.type) {
            case 'text':
                if (part.text) {
                    partContent = createDOMElement('div', { className: 'text-part' });
                    let rawText = part.text;

                    // ✨ 안전장치 추가: rawText가 유효한 문자열일 때만 검문소 로직 실행
                    if (role === 'model' && typeof rawText === 'string' && (rawText.includes('구글 캘린더 연동하기') || rawText.includes('/authorize'))) {
                        const authLink = `<a href="/authorize" target="_blank" class="auth-link">여기를 클릭하여 인증하세요.</a>`;
                        rawText = "OK. 구글 캘린더를 연결하겠습니다. 먼저 접근 권한을 부여해야 합니다. 아래 링크를 방문하여 권한을 부여해주세요:\n\n" + authLink;
                        console.log('[Link Interceptor] 인증 링크를 감지하고 /authorize 경로로 수정했습니다.');
                    }

                    const rawHtml = window.marked.parse(rawText);
                    const sanitizedHtml = window.DOMPurify.sanitize(rawHtml);
                    partContent.innerHTML = CodeBlock.enhance(sanitizedHtml);
                }
                break;
            
            case 'study_timer':
                if (part.seconds) {
                    partContent = createDOMElement('div', { className: 'study-timer-container' });
                    
                    // ✨ 1. 타이머를 렌더링하기 전에, 먼저 백엔드에 '세션 시작'을 알립니다.
                    //    'async' IIFE (즉시 실행 함수)를 사용하여 비동기 로직을 처리합니다.
                    (async () => {
                        try {
                            // 2. StudyLoop.start()를 호출하고, 성공적으로 세션이 시작될 때까지 기다립니다.
                            const startResult = await StudyLoop.start('자율 루프 집중 세션');
                            
                            if (startResult.success) {
                                // 3. 세션이 성공적으로 시작된 후에만, 타이머 UI를 렌더링합니다.
                                StudyLoop.renderTimerUI(partContent, part.seconds);
                            } else {
                                // 만약 세션 시작에 실패하면, 사용자에게 오류 메시지를 보여줍니다.
                                partContent.innerHTML = `<p style="color:red;">타이머 세션을 시작하는 데 실패했습니다: ${startResult.message}</p>`;
                            }
                        } catch (error) {
                            console.error('StudyLoop.start() 실행 중 오류:', error);
                            partContent.innerHTML = `<p style="color:red;">타이머 시작 중 오류가 발생했습니다.</p>`;
                        }
                    })(); // 즉시 실행!
                }
                break;

            case 'image':
                if (part.data) partContent = createDOMElement('img', { src: part.data, className: 'message-image' });
                break;
            case 'code-summary':
                if (part.summary) partContent = CodeSummary.create(part.summary);
                break;
            case 'pdf-attachment':
                if (part.name) partContent = PdfSummary.create(part);
                break;
        }
        if (partContent) textView.appendChild(partContent);
    });
    return textView;
}

function renderEditView(parts, messageId) {
    const editView = createDOMElement('div', { className: 'message-edit-view'});
    const textToEdit = (parts || []).filter(p => p.type === 'text').map(p => p.text).join('\n\n');
    const textarea = createDOMElement('textarea', { className: 'edit-textarea' }, textToEdit);
    const saveBtn = createDOMElement('button', { className: 'edit-action-btn save', 'data-action': 'save-edit', 'data-message-id': messageId }, '저장 및 제출');
    const cancelBtn = createDOMElement('button', { className: 'edit-action-btn cancel', 'data-action': 'cancel-edit', 'data-message-id': messageId }, '취소');
    const editActions = createDOMElement('div', { className: 'edit-actions' }, saveBtn, cancelBtn);
    editView.append(textarea, editActions);
    return editView;
}

function renderActions(message, session, messageEl) {
    const { role, id, parts = [] } = message;
    const messageIndex = session.history.findIndex(m => m.id === id);
    const isLoading = !!appState.loadingStates[session.id];
    const disabledTitle = '응답 생성 중에는 사용할 수 없습니다.';
    const mainActions = [];
    const secondaryActions = [];

    // --- Main Actions ---
    if (role === 'user' || role === 'model' || role === 'system') {
        const deleteIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
        const deleteBtn = createDOMElement('button', { 
            'data-action': 'delete-message', 
            'data-message-id': id, 
            title: isLoading ? disabledTitle : '삭제',
            disabled: isLoading
        });
        deleteBtn.innerHTML = deleteIcon;
        mainActions.push(deleteBtn);
    }

    if (role === 'user' || role === 'model') {
        const copyIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
        const copyBtn = createDOMElement('button', { 'data-action': 'copy-message', 'data-message-id': id, title: '복사' });
        copyBtn.innerHTML = copyIcon;
        mainActions.unshift(copyBtn);
    }

    if (role === 'model') {
        const regenerateIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M21 21v-5h-5"></path></svg>';
        const regenerateBtn = createDOMElement('button', { 
             'data-action': 'regenerate-message', 
             'data-message-id': id, 
             title: isLoading ? disabledTitle : '재생성',
             disabled: isLoading
        });
        regenerateBtn.innerHTML = regenerateIcon;
        mainActions.push(regenerateBtn);

        // 'PPT로 내보내기' 버튼 추가
        const exportPptIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2Z"/><path d="M12 2v10"/><path d="m7 6 5 5 5-5"/></svg>';
        const exportPptBtn = createDOMElement('button', {
            'data-action': 'export-ppt',
            'data-message-id': id,
            title: 'PPT로 내보내기'
        });
        exportPptBtn.innerHTML = exportPptIcon;
        mainActions.push(exportPptBtn); // [중요] 버튼을 mainActions 배열에 추가!

        // --- '이메일로 변환' 버튼 추가] ---
        const convertEmailIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>';
        const convertEmailBtn = createDOMElement('button', {
            'data-action': 'convert-to-email',
            'data-message-id': id,
            title: '이메일 초안으로 변환'
        });
        convertEmailBtn.innerHTML = convertEmailIcon;
        mainActions.push(convertEmailBtn);

        // --- ['블로그로 변환' 버튼 추가] ---
        const convertBlogIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>';
        const convertBlogBtn = createDOMElement('button', {
            'data-action': 'convert-to-blog',
            'data-message-id': id,
            title: '블로그 포스트로 변환'
        });
        convertBlogBtn.innerHTML = convertBlogIcon;
        mainActions.push(convertBlogBtn);

    } else if (role === 'user') {
        const editIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
        const editBtn = createDOMElement('button', { 
            'data-action': 'edit-message', 
            'data-message-id': id, 
            title: isLoading ? disabledTitle : '수정',
            disabled: isLoading
        });
        editBtn.innerHTML = editIcon;
        mainActions.push(editBtn);
        if (session && session.history && messageIndex === session.history.length - 1) {
            const getResponseIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"></polyline><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>';
            const getResponseBtn = createDOMElement('button', { 
                'data-action': 'get-response', 
                'data-message-id': id, 
                title: isLoading ? disabledTitle : '응답 받기',
                disabled: isLoading
            });
            getResponseBtn.innerHTML = getResponseIcon;
            mainActions.push(getResponseBtn);
        }
    }

    // --- Secondary Actions (Math Switcher) ---
    const hasMath = parts.some(p => p.type === 'text' && p.text.includes('$'));
    if (role === 'model' && hasMath) {
        const currentRenderer = messageEl.dataset.mathRenderer || appState.settings.mathRenderer;
        const nextRenderer = currentRenderer === 'katex' ? 'mathjax' : 'katex';
        const btnText = `Use ${nextRenderer.charAt(0).toUpperCase() + nextRenderer.slice(1)}`;
        const mathIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.48 18.18c-3.03-.5-5.65-1.51-8.13-3.11S.5 10.36.5 8.19c0-2.29 2.1-3.64 4.5-3.64 2.89 0 4.5 1.64 4.5 4.36 0 1.09-.36 2.09-.82 3.09s-1.12 1.72-2 2.32c-.5.3-1.09.45-1.68.45-.59 0-1.18-.15-1.68-.45-.6-.36-1.1-.91-1.42-1.64"/><path d="M17.5 4.5c3.03.5 5.65 1.51 8.13 3.11s2.85 4.67 2.85 6.84c0 2.29-2.1 3.64-4.5-3.64-2.89 0-4.5-1.64-4.5-4.36 0-1.09.36 2.09-.82-3.09s1.12-1.72 2-2.32c.5-.3 1.09.45 1.68-.45.59 0 1.18.15 1.68.45.6.36 1.1.91 1.42 1.64"/></svg>';
        const switchBtn = createDOMElement('button', { 
            'data-action': 'switch-math-renderer', 
            'data-message-id': id, 
            title: `Switch to ${nextRenderer}`,
            className: 'math-switch-btn' 
        });
        switchBtn.innerHTML = mathIcon;
        secondaryActions.push(switchBtn); // [THE FIX] This line was missing.
    }

    const allActions = [...mainActions];
    if (secondaryActions.length > 0) {
        if (mainActions.length > 0) {
            allActions.push(createDOMElement('div', { className: 'action-separator' }));
        }
        allActions.push(...secondaryActions);
    }

    return createDOMElement('div', { className: 'message-actions' }, ...allActions);
}

export function create(message, session, rendererOverride = null) {
    if (!message) return createDOMElement('div');

    const { role, parts = [], receivedAt, isEditing, id } = message;

    const messageWrapperClass = `message ${role}${isEditing ? ' is-editing' : ''}`;
    const messageWrapper = createDOMElement('div', { 
        className: messageWrapperClass, 
        'data-message-id': id || `msg-${Date.now()}`
    });

    if (rendererOverride) {
        messageWrapper.dataset.mathRenderer = rendererOverride;
    }

    const textView = renderMessageParts(parts, role, receivedAt);
    const editView = (role === 'user') ? renderEditView(parts, id) : createDOMElement('div', {className: 'message-edit-view'});

    const messageContent = createDOMElement('div', { className: 'message-content' }, textView, editView);
    messageWrapper.appendChild(messageContent);

    if (session) {
        const actionsToolbar = renderActions(message, session, messageWrapper);
        messageWrapper.appendChild(actionsToolbar);
    }

    if (role !== 'model' || !receivedAt) {
        renderMetadata(messageWrapper, message);
    }
    return messageWrapper;
}