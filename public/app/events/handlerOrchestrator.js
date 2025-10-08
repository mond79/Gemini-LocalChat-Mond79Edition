// [CoreDNA] The central controller. It orchestrates state, services, and UI components.
import { appState } from '../state/AppState.js';
import * as Session from '../state/SessionManager.js';
import * as ChatService from '../services/ChatService.js';
import * as ChatContainer from '../containers/ChatContainer.js';
import * as SessionList from '../../components/SessionList.js';
import * as InputArea from '../../components/InputArea.js';
import * as Toast from '../../components/Toast.js';
import * as ContextMenu from '../../components/ContextMenu.js';
import { renderMathInElement } from '../utils/MathRenderer.js';
import * as Message from '../components/Message.js';
import { applySyntaxHighlighting } from '../utils/highlighter.js';
import { $ } from '../../utils/dom.js';
import { SettingsController } from '../controllers/SettingsController.js';
import { UsageReporter } from '../modules/settings/UsageReporter.js';
import * as AnimationManager from '../modules/AnimationManager.js';
import { saveData } from '../../utils/storage.js';

const views = {
    chat: () => $('.chat-area'),
    settings: () => $('#settings-page')
};



export function renderAll() {
    SessionList.render(appState);
    ChatContainer.render(appState);
    InputArea.render(appState);
    if (views.settings().classList.contains('view-active')) {
        SettingsController.render();
    }
}

export const handlers = {
    handleShowSettings() {
        views.chat().classList.remove('view-active');
        views.settings().classList.add('view-active');
        SettingsController.render();
    },
    handleHideSettings() {
        views.settings().classList.remove('view-active');
        views.chat().classList.add('view-active');
    },

    handleToggleSidebar() { $('.container').classList.toggle('sidebar-collapsed'); },
    handleToggleDarkMode() {
        appState.isDarkMode = !appState.isDarkMode;
        document.body.classList.toggle('dark-mode', appState.isDarkMode);
        saveData(appState);
        if (views.settings().classList.contains('view-active')) {
            UsageReporter.render();
        }
    },
    async handleNewChat() {
        const activeSession = appState.sessions[appState.activeSessionId];
        if (activeSession && activeSession.title === '새 대화' && activeSession.history.length === 0) {
            // Do nothing if the current session is already a blank new chat.
            return;
        }
        handlers.handleHideSettings();
        Session.newSession(appState);
        renderAll();
    },
    async handleSwitchSession(sessionId) {
        handlers.handleHideSettings();
        Session.switchSession(appState, sessionId);
        renderAll();
    },
    async handleDeleteSession(sessionId) { if (confirm('이 대화를 정말 삭제하시겠습니까?')) { Session.deleteSession(appState, sessionId); renderAll(); } },
    async handleTogglePin(sessionId) { Session.togglePinSession(appState, sessionId); SessionList.render(appState); },
    handleBeginRename(itemId) { SessionList.beginRename(itemId); },
    async handleFinishRename(itemId, newTitle) { Session.renameItem(appState, itemId, newTitle); renderAll(); },
    async handleModelChange(modelId) {
        console.log('Model change requested:', {
            modelId,
            activeSessionId: appState.activeSessionId,
            currentModel: appState.sessions[appState.activeSessionId]?.model
        });
        
        Session.updateSessionModel(appState, modelId);
        $('#model-selector-dropdown').classList.add('hidden');
        
        console.log('About to call renderAll...');
        renderAll();
        console.log('renderAll completed');
        
        console.log('Model changed to:', {
            newModel: appState.sessions[appState.activeSessionId]?.model
        });
    },

    async handleInputUpdate() { InputArea.render(appState); },
    handleCreateFolder() { Session.createFolder(appState); renderAll(); },
    handleToggleFolder(folderId) { Session.toggleFolder(appState, folderId); },
    handleDeleteFolder(folderId) { if(confirm("폴더를 삭제하시겠습니까? (내부의 대화는 모두 밖으로 이동됩니다)")) { Session.deleteFolder(appState, folderId); renderAll(); } },
    handleMoveItem(itemId, targetId) { Session.moveItem(appState, itemId, targetId); renderAll(); },
    handleContextMenu(itemId, clientX, clientY) { 
        const result = Session.findItemRecursive(appState.sidebarItems, itemId); 
        if (!result) return; 
        const { item, parent } = result;
        const menuItems = [];
        menuItems.push({ label: '이름 변경', action: () => handlers.handleBeginRename(itemId) });
        if (item.type === 'session') { 
            const session = appState.sessions[itemId];
            menuItems.push({ type: 'separator' });
            menuItems.push({ label: '태그 추가', action: () => handlers.handleAddTag(itemId) });
            if (session && session.tags && session.tags.length > 0) {
                const removeSubmenu = session.tags.map(tag => ({
                    label: tag,
                    action: () => handlers.handleRemoveTag(itemId, tag)
                }));
                menuItems.push({ label: '태그 삭제', submenu: removeSubmenu });
            }
            menuItems.push({ type: 'separator' });
            if (parent) { menuItems.push({ label: '폴더에서 꺼내기', action: () => handlers.handleMoveItem(itemId, null) }); }
            const folders = [];
            const findFoldersRecursive = (items) => { for (const i of items) { if (i.type === 'folder' && i.id !== parent?.id) { folders.push({ label: i.name, action: () => handlers.handleMoveItem(itemId, i.id) }); } if (i.type === 'folder') findFoldersRecursive(i.children); } };
            findFoldersRecursive(appState.sidebarItems);
            if (folders.length > 0) { menuItems.push({ label: '폴더에 넣기', submenu: folders }); }
            menuItems.push({ type: 'separator' });
            menuItems.push({ label: '삭제', action: () => handlers.handleDeleteSession(itemId) }); 
        } else { // Folder
            menuItems.push({ label: '삭제', action: () => handlers.handleDeleteFolder(itemId) }); 
        }
        ContextMenu.show(clientX, clientY, menuItems); 
    },
    handleAddTag(sessionId) {
        const newTag = prompt("추가할 태그를 입력하세요:");
        if (newTag && newTag.trim()) {
            Session.addTagToSession(appState, sessionId, newTag.trim());
            renderAll();
        }
    },
    handleRemoveTag(sessionId, tag) {
        Session.removeTagFromSession(appState, sessionId, tag);
        renderAll();
    },
    handleSortChange(sortMode) { 
        appState.settings.sidebarSortMode = sortMode; 
        saveData(appState); 
        SessionList.render(appState); 
    },
    async handleFileSelect(fileList) { 
        if (!fileList || fileList.length === 0) { return; }
        try { 
            for (const file of fileList) {
                const fileData = await ChatService.readFileAsPromise(file);
                appState.attachedFiles.push({ name: file.name, type: file.type, size: file.size, data: fileData });
            }
        } catch (error) { 
            console.error("Error reading file(s):", error); 
            alert("파일을 읽는 중 오류가 발생했습니다."); 
        } 
        InputArea.render(appState); 
    },
    handleRemoveAttachedFile(index) {
        if (index > -1 && index < appState.attachedFiles.length) {
            appState.attachedFiles.splice(index, 1);
            InputArea.render(appState);
        }
    },
    async handleSendMessage() { await ChatService.sendMessage(); },
    handleCopyMessage(messageId) { if (!messageId) return; const session = appState.sessions[appState.activeSessionId]; if (!session) return; const message = session.history.find(m => m.id === messageId); if (!message) return; const textToCopy = message.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n'); if (textToCopy) { navigator.clipboard.writeText(textToCopy).then(() => { Toast.show('클립보드에 복사되었습니다.'); }).catch(err => { console.error('클립보드 복사 실패:', err); Toast.show('복사에 실패했습니다.'); }); } else { Toast.show('복사할 텍스트가 없습니다.'); } },
    handleCopyCodeBlock(buttonElement) { const wrapper = buttonElement.closest('.code-block-wrapper'); if (!wrapper) return; const codeElement = wrapper.querySelector('pre > code'); if (!codeElement) return; const codeText = codeElement.innerText; navigator.clipboard.writeText(codeText).then(() => { Toast.show('코드가 클립보드에 복사되었습니다.'); }).catch(err => { console.error('코드 블록 복사 실패:', err); Toast.show('코드 복사에 실패했습니다.'); }); },
    async handleRegenerate(messageId) { const sessionId = appState.activeSessionId; await ChatService.regenerate(sessionId, messageId); },
    handleStartEdit(messageId) { Session.startEditingMessage(appState, appState.activeSessionId, messageId); renderAll(); },
    handleCancelEdit(messageId) { Session.cancelEditingMessage(appState, appState.activeSessionId, messageId); renderAll(); },
    async handleSaveEdit(messageId, newText) { const sessionId = appState.activeSessionId; if (!newText.trim()) { Toast.show("메시지는 비워둘 수 없습니다."); return; } const newParts = [{ type: 'text', text: newText.trim() }]; Session.saveEditedMessage(appState, sessionId, messageId, newParts); renderAll(); await ChatService.resubmit(sessionId); },
    handleCancelGeneration() {
        ChatService.cancelCurrentRequest();
        AnimationManager.stop(appState.activeSessionId);
    },
    handleDeleteMessage(messageId) {
        const sessionId = appState.activeSessionId;
        if (!sessionId) return;
        Session.deleteMessage(appState, sessionId, messageId);
        ChatContainer.rerenderSessionView(sessionId);
        SessionList.render(appState);
    },
    async handleGetResponse() { const sessionId = appState.activeSessionId; await ChatService.resubmit(sessionId); },
    handleToggleModelSelector() { $('#model-selector-dropdown').classList.toggle('hidden'); },
    handleGoToModelSettings() { 
        console.log('handleGoToModelSettings called');
        // 모델 셀렉터 드롭다운 닫기
        $('#model-selector-dropdown').classList.add('hidden');
        // 설정 페이지로 이동하고 API 및 모델 탭 활성화
        handlers.handleShowSettings();
        // 설정 페이지가 열린 후 모델 설정 탭으로 이동
        setTimeout(() => {
            const apiTab = document.querySelector('[data-tab="tab-api"]');
            console.log('API tab found:', apiTab);
            if (apiTab) {
                apiTab.click();
            }
        }, 100);
    },
    handleSaveSettings() {
        // 설정을 로컬 스토리지에 저장
        import('../../utils/storage.js').then(({ saveData }) => {
            saveData(appState);
        });
    },
    handleSwitchMathRenderer(messageId) {
        const sessionId = appState.activeSessionId;
        AnimationManager.stop(sessionId);

        const oldMessageEl = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (!oldMessageEl) return;
        const session = appState.sessions[sessionId];
        const message = session?.history.find(m => m.id === messageId);
        if (!session || !message) return;

        const isCurrentlyStreaming = !!message.receivedAt;

        const currentRenderer = oldMessageEl.dataset.mathRenderer || appState.settings.mathRenderer;
        const nextRenderer = currentRenderer === 'katex' ? 'mathjax' : 'katex';

        const newMessageEl = Message.create(message, session, nextRenderer);
        oldMessageEl.parentNode.replaceChild(newMessageEl, oldMessageEl);
        applySyntaxHighlighting(newMessageEl);
        renderMathInElement(newMessageEl);

        if (isCurrentlyStreaming) {
            const newTextPart = newMessageEl.querySelector('.text-part');
            if (newTextPart) {
                AnimationManager.start(sessionId, message, newTextPart);
            }
        }
    },
    handlePaste(event) {
        const files = event.clipboardData.files;
        if (files.length > 0) {
            event.preventDefault();
            handlers.handleFileSelect(files);
        }
    }
};