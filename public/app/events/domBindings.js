// [CoreDNA] This module's only job is to bind DOM events to handlers.
import { $ } from '../../utils/dom.js';
import * as Modal from '../../components/Modal.js';

let dragOverElement = null;

export function bindEvents(handlers) {
    // --- Header & Global Actions ---
    $('#new-chat-btn').addEventListener('click', handlers.handleNewChat);
    $('#new-folder-btn').addEventListener('click', handlers.handleCreateFolder);
    $('#dark-mode-toggle').addEventListener('click', handlers.handleToggleDarkMode);
    $('#toggle-sidebar-btn').addEventListener('click', handlers.handleToggleSidebar);
    $('#start-briefing-btn').addEventListener('click', handlers.handleStartDailyBriefing);

    // [MODIFIED] Settings button now acts as a toggle
    $('#settings-btn').addEventListener('click', () => {
        if ($('#settings-page').classList.contains('view-active')) {
            handlers.handleHideSettings();
        } else {
            handlers.handleShowSettings();
        }
    });

    // --- Sort Menu ---
    const sortBtn = $('#sort-btn');
    const sortOptions = $('#sort-options');
    sortBtn.addEventListener('click', (e) => { e.stopPropagation(); sortOptions.classList.toggle('hidden'); });
    sortOptions.addEventListener('click', e => { 
        const target = e.target.closest('li'); 
        if (!target) return; 
        const sortMode = target.dataset.sort;
        handlers.handleSortChange(sortMode); 
        sortOptions.classList.add('hidden'); 
    });
    
    document.addEventListener('click', (e) => {
        if (!sortBtn.contains(e.target)) {
            sortOptions.classList.add('hidden');
        }
        const modelSelectorContainer = $('#custom-model-selector');
        const dropdown = $('#model-selector-dropdown');
        if (modelSelectorContainer && !modelSelectorContainer.contains(e.target) && !dropdown.classList.contains('hidden')) {
            dropdown.classList.add('hidden');
        }
    });

    // --- Session List ---
    const sessionList = $('#session-list');
    sessionList.addEventListener('click', e => {
        const itemLi = e.target.closest('li[data-item-id]');
        if (!itemLi || itemLi.classList.contains('editing')) return;
        const itemId = itemLi.dataset.itemId;
        const itemType = itemLi.dataset.itemType;
        if (e.target.closest('.session-action-btn')) {
            if (e.target.closest('.pin-btn')) handlers.handleTogglePin(itemId);
            else if (e.target.closest('.delete-btn')) handlers.handleDeleteSession(itemId);
            return;
        }
        if (itemType === 'folder') {
            handlers.handleToggleFolder(itemId);
            const childrenContainer = itemLi.nextElementSibling;
            if (childrenContainer && childrenContainer.matches('.folder-children-container')) {
                itemLi.querySelector('.toggle-folder-btn').classList.toggle('closed');
                childrenContainer.classList.toggle('collapsed');
            }
        } else if (itemType === 'session') {
            handlers.handleSwitchSession(itemId);
        }
    });
    sessionList.addEventListener('dblclick', e => { const itemLi = e.target.closest('li[data-item-id]'); if (itemLi) handlers.handleBeginRename(itemLi.dataset.itemId); });
    sessionList.addEventListener('contextmenu', e => { e.preventDefault(); const itemLi = e.target.closest('li[data-item-id]'); if (itemLi) { handlers.handleContextMenu(itemLi.dataset.itemId, e.clientX, e.clientY); } });
    sessionList.addEventListener('focusout', e => { if (e.target.matches('.title-input')) { handlers.handleFinishRename(e.target.closest('li').dataset.itemId, e.target.value); } });
    sessionList.addEventListener('keydown', e => { if (e.target.matches('.title-input')) { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { const originalTitle = e.target.closest('li').querySelector('.session-title, .folder-name').textContent; e.target.value = originalTitle; e.target.blur(); } } });

    // --- Drag and Drop ---
    sessionList.addEventListener('dragstart', e => { const itemLi = e.target.closest('li[data-item-id]'); if (itemLi) { e.dataTransfer.setData('text/plain', itemLi.dataset.itemId); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => itemLi.classList.add('dragging'), 0); } });
    sessionList.addEventListener('dragend', e => { const itemLi = e.target.closest('li[data-item-id]'); if (itemLi) itemLi.classList.remove('dragging'); });
    sessionList.addEventListener('dragover', e => { e.preventDefault(); const targetLi = e.target.closest('li[data-item-id]'); if (dragOverElement !== targetLi) { dragOverElement?.classList.remove('drag-over', 'drag-over-folder'); dragOverElement = targetLi; } if (targetLi) { if (targetLi.dataset.itemType === 'folder') { targetLi.classList.add('drag-over-folder'); } else { targetLi.classList.add('drag-over'); } } });
    sessionList.addEventListener('dragleave', e => { if (e.target.closest('li[data-item-id]') === dragOverElement) { dragOverElement?.classList.remove('drag-over', 'drag-over-folder'); dragOverElement = null; } });
    sessionList.addEventListener('drop', e => { e.preventDefault(); dragOverElement?.classList.remove('drag-over', 'drag-over-folder'); const draggedItemId = e.dataTransfer.getData('text/plain'); const targetLi = e.target.closest('li[data-item-id]'); const targetId = targetLi ? targetLi.dataset.itemId : null; if (draggedItemId !== targetId) { handlers.handleMoveItem(draggedItemId, targetId); } dragOverElement = null; });

    // --- Chat Area ---
    const chatBox = $('#chat-box');
    chatBox.addEventListener('click', e => {
        const copyBtn = e.target.closest('.code-block-copy-btn');
        if (copyBtn) { handlers.handleCopyCodeBlock(copyBtn); return; }
        if (e.target.classList.contains('message-image')) { Modal.openImageModal(e.target.src); return; }
        const actionBtn = e.target.closest('[data-action]');
        if (actionBtn) {
            const { action, messageId } = actionBtn.dataset;
            switch (action) {
                case 'copy-message': handlers.handleCopyMessage(messageId); break;
                case 'regenerate-message': handlers.handleRegenerate(messageId); break;
                case 'edit-message': handlers.handleStartEdit(messageId); break;
                case 'cancel-edit': handlers.handleCancelEdit(messageId); break;
                case 'save-edit': { const messageEl = actionBtn.closest('.message.is-editing'); const textarea = messageEl?.querySelector('.edit-textarea'); if (textarea) handlers.handleSaveEdit(messageId, textarea.value); break; }
                case 'export-ppt': handlers.handleExportToPpt(messageId); break;
                case 'convert-to-email': handlers.handleConvertToEmail(messageId); break;
                case 'convert-to-blog': handlers.handleConvertToBlog(messageId); break;
                case 'delete-message': handlers.handleDeleteMessage(messageId); break;
                case 'get-response': handlers.handleGetResponse(); break;
                case 'switch-math-renderer': handlers.handleSwitchMathRenderer(messageId); break;
            }
        }
    });

    // --- Input Area Bindings ---
    // Mic Button Binding
    $('#mic-btn')?.addEventListener('click', handlers.handleMicClick);

    // TTS Button Binding
    $('#tts-btn')?.addEventListener('click', handlers.handleTtsClick);
    $('#continuous-mode-btn')?.addEventListener('click', handlers.handleToggleContinuousMode);
    // ==========================================================
    const messageInput = $('#message-input');
    messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlers.handleSendMessage(); } });
    messageInput.addEventListener('input', handlers.handleInputUpdate);
    // [NEW] Add paste event listener
    messageInput.addEventListener('paste', e => handlers.handlePaste(e));

    $('#send-btn').addEventListener('click', () => {
        if ($('#send-btn').classList.contains('stop-generating')) {
            handlers.handleCancelGeneration();
        } else {
            handlers.handleSendMessage();
        }
    });
    
    // Custom Model Selector
    $('#model-selector-trigger').addEventListener('click', (e) => {
        e.stopPropagation();
        handlers.handleToggleModelSelector();
    });
    $('#model-selector-dropdown').addEventListener('click', (e) => {
        const modelItem = e.target.closest('.model-item');
        if (modelItem && modelItem.dataset.modelId) {
            handlers.handleModelChange(modelItem.dataset.modelId);
        }
        
        // 모델 설정으로 이동 버튼 클릭 처리
        const settingsBtn = e.target.closest('#go-to-model-settings-btn');
        console.log('Clicked element:', e.target);
        console.log('Settings button found:', settingsBtn);
        if (settingsBtn) {
            console.log('Calling handleGoToModelSettings');
            handlers.handleGoToModelSettings();
        }
    });

    $('#image-upload-input').addEventListener('change', e => handlers.handleFileSelect(e.target.files));
    $('#manage-prompts-btn').addEventListener('click', Modal.openPromptEditorModal);

    // [새 기능] 파일 처리 작업 버튼 클릭 이벤트 (이벤트 위임)
    // 문서 전체를 감시하다가, 혹시 '.file-task-btn' 버튼이 눌렸는지 확인하는 가장 안정적인 방법이야.
    document.addEventListener('click', (event) => {
        // 1. 사용자가 클릭한 대상이 '.file-task-btn' 클래스를 가진 버튼인지 확인
        if (event.target.closest('.file-task-btn')) {
            // 2. 만약 맞다면, handlerOrchestrator에 있는 담당자(handleFileTaskClick)를 호출!
            handlers.handleFileTaskClick(event);
        }
    });
}