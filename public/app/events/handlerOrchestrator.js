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

let recognition = null; // ✅ 음성 인식 객체를 저장할 변수

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
        // 이제 이 함수는 어떤 조건도 확인하지 않습니다.
        // 사용자가 '새 채팅'을 원하면, 우리는 그냥 만들어주면 됩니다.
        console.log('[New Chat] 사용자가 새 대화를 요청했습니다. 현재 상태와 관계없이 새 대화를 생성합니다.');
        
        handlers.handleHideSettings(); // 설정 화면이 열려있으면 닫고,
        Session.newSession(appState);  // 무조건 새로운 세션을 만들고,
        renderAll();                   // 화면을 다시 그립니다.
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

        const optionsContainer = $('#file-process-options');
        optionsContainer.style.display = appState.attachedFiles.length > 0 ? 'flex' : 'none';
    },
    handleRemoveAttachedFile(index) {
        if (index > -1 && index < appState.attachedFiles.length) {
            appState.attachedFiles.splice(index, 1);
            InputArea.render(appState);

            const optionsContainer = $('#file-process-options');
            optionsContainer.style.display = appState.attachedFiles.length > 0 ? 'flex' : 'none';
        }
    },
    // ==========================================================
    // [✅ 바로 이 부분이 추가/수정된 부분입니다!]
    handleMicClick() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            Toast.show("죄송합니다, 이 브라우저는 음성 인식을 지원하지 않습니다.");
            return;
        }

        const micButton = $('#mic-btn');
        const isActive = micButton.classList.contains('active');

        // recognition 객체가 파일 상단에 선언되어 있어야 합니다. (let recognition = null;)
        if (recognition && isActive) {
            recognition.stop();
            // onend 이벤트 핸들러가 알아서 active 클래스를 제거해 줄 것입니다.
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'ko-KR';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            micButton.classList.add('active');
            Toast.show("듣고 있어요. 말씀해주세요...");
        };

        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            console.log('음성 인식 결과:', transcript);
            
            // InputArea.js에 텍스트를 설정하는 기능이 있는지 확인해야 합니다.
            // 이 프로젝트 구조상 InputArea 모듈을 통해 제어하는 것이 좋습니다.
            InputArea.setTextValue(transcript); 

            handlers.handleSendMessage();
        };

        recognition.onend = () => {
            micButton.classList.remove('active');
            console.log('음성 인식 종료.');
            recognition = null; // 다음 인식을 위해 객체 정리
        };

        recognition.onerror = (event) => {
            console.error('음성 인식 오류:', event.error);
            Toast.show(`음성 인식 오류: ${event.error}`);
            // onend가 호출되므로 여기서 active 클래스를 제거할 필요가 없습니다.
        };
        
        recognition.start();
    },

    // [✅ 새로운 핸들러 추가]
     handleTtsClick() {
         const ttsButton = $('#tts-btn');
         const isActive = ChatService.toggleTTS();
         ttsButton.classList.toggle('active', isActive);
     },

     // [✅ 새로운 핸들러 추가]
    handleToggleContinuousMode() {
        // TTS가 꺼져있으면 이 모드를 켤 수 없다고 알려줍니다.
        if (!appState.settings.ttsEnabled) {
            Toast.show("음성 답변(TTS)이 활성화되어야 사용할 수 있습니다.");
            return;
        }
        // appState의 상태를 변경합니다.
        if (typeof appState.settings.continuousConversationMode === 'undefined') {
            appState.settings.continuousConversationMode = false;
        }
        appState.settings.continuousConversationMode = !appState.settings.continuousConversationMode;
        saveData(appState);

        Toast.show(appState.settings.continuousConversationMode ? "연속 대화 모드가 활성화되었습니다." : "연속 대화 모드가 비활성화되었습니다.");
        
        // UI 버튼의 'active' 상태를 업데이트합니다.
        $('#continuous-mode-btn').classList.toggle('active', appState.settings.continuousConversationMode);
    },
     
    // --- [새로운 핸들러 추가] ---
    async handleFileTaskClick(event) {
        // 1. 사용자가 어떤 버튼을 눌렀는지 'data-task' 값을 읽어옵니다.
        const task = event.target.closest('.file-task-btn')?.dataset.task;
        if (!task) return;

        console.log(`파일 작업 버튼 클릭: ${task}`);

        // 2. ChatService를 호출하여 'task' 정보와 함께 메시지를 보냅니다.
        //    (다음 단계에서 ChatService.js를 수정할 예정입니다!)
        await ChatService.sendMessage({ task });

        // 3. 메시지를 보낸 후에는 버튼들을 다시 숨깁니다.
        $('#file-process-options').style.display = 'none';
    },

    // 새로운 PPT 내보내기 핸들러 추가
    async handleExportToPpt(messageId) {
        // 1. 필요한 정보들을 appState에서 가져옵니다.
        const session = appState.sessions[appState.activeSessionId];
        const message = session?.history.find(m => m.id === messageId);

        if (!message || !session) {
            Toast.show('오류: 메시지 정보를 찾을 수 없습니다.');
            return;
        }

        // 2. 메시지 내용과 제목을 준비합니다.
        const jsonString = message.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
        const title = session.title || 'AI 생성 프레젠테이션';

        if (!jsonString.trim()) {
            Toast.show('PPT로 만들 텍스트 내용이 없습니다.');
            return;
        }

        Toast.show('PPT 파일 생성을 시작합니다...');
        try {
            // 3. 서버에 PPT 생성을 요청합니다.
            const response = await fetch('/api/create-presentation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonString: jsonString, title: title })
            });
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'PPT 생성에 실패했습니다.');
            }

            // 4. 성공 시, 받은 URL로 파일을 다운로드합니다.
            const link = document.createElement('a');
            link.href = data.downloadUrl;
            link.setAttribute('download', `${title.replace(/ /g, '_')}.pptx`);
            document.body.appendChild(link);
            link.click();
            link.remove();

            Toast.show('PPT 파일 다운로드가 완료되었습니다!');

        } catch (error) {
            console.error('PPT 내보내기 오류:', error);
            Toast.show(`오류: ${error.message}`);
        }
    },

    // [이메일 변환 핸들러 추가]
    async handleConvertToEmail(messageId) {
        // 1. 필요한 정보들을 appState에서 가져옵니다.
        const session = appState.sessions[appState.activeSessionId];
        const message = session?.history.find(m => m.id === messageId);

        if (!message) {
            Toast.show('오류: 원본 메시지를 찾을 수 없습니다.');
            return;
        }

        // 2. AI에게 보낼 새로운 '지시사항'을 만듭니다.
        const originalText = message.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
        
        // 3. 이것이 핵심! 우리는 새로운 'task'를 만들지 않고,
        //    사용자가 직접 입력한 것처럼 프롬프트를 구성하여 전송합니다.
        //    이렇게 하면 기존의 파일 처리 로직과 섞이지 않아 안전합니다.
        const newPrompt = `이 내용을 바탕으로 이메일 초안을 작성해줘:\n\n---\n\n${originalText}`;

        // 4. InputArea.js 모듈을 사용해 입력창에 새로운 프롬프트를 설정하고,
        //    마치 사용자가 직접 '전송' 버튼을 누른 것처럼 행동합니다.
        InputArea.setTextValue(newPrompt);
        handlers.handleSendMessage();

        Toast.show('이메일 초안 생성을 시작합니다...');
    },

    // [블로그 변환 핸들러 추가]
    async handleConvertToBlog(messageId) {
        const session = appState.sessions[appState.activeSessionId];
        const message = session?.history.find(m => m.id === messageId);

        if (!message) {
            Toast.show('오류: 원본 메시지를 찾을 수 없습니다.');
            return;
        }

        const originalText = message.parts.filter(p => p.type === 'text').map(p => p.text).join('\n\n');
        
        // AI에게 내릴 새로운 지시사항
        const newPrompt = `이 내용을 바탕으로 블로그 포스트를 작성해줘:\n\n---\n\n${originalText}`;

        // 입력창에 새로운 프롬프트를 설정하고, 자동으로 전송
        InputArea.setTextValue(newPrompt);
        handlers.handleSendMessage();

        Toast.show('블로그 포스트 생성을 시작합니다...');
    },
    // ['브리핑 시작' 마법 추가!]
    async handleStartDailyBriefing() {
        // 1. 현재 채팅방이 비어있는지 확인 (안전장치)
        const session = appState.sessions[appState.activeSessionId];
        if (session && session.history.length > 0) {
            Toast.show('브리핑은 빈 채팅에서만 시작할 수 있습니다.');
            return;
        }
        
        // 2. 입력창에 "오늘의 브리핑 시작해줘" 라고 우리가 대신 입력해줌
        InputArea.setTextValue("오늘의 브리핑 시작해줘");

        // 3. 그리고 '전송' 버튼을 누른 것과 똑같은 효과를 냄!
        handlers.handleSendMessage();
    },
    // =========================================================
    async handleSendMessage() { await ChatService.sendMessage(); $('#file-process-options').style.display = 'none';},
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