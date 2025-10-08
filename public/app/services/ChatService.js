// [CoreDNA] This service module orchestrates the entire chat business logic.
import { appState } from '../state/AppState.js';
import * as Session from '../state/SessionManager.js';
import * as GeminiAPIService from './GeminiAPIService.js';
import * as Toast from '../../components/Toast.js';
import * as InputArea from '../../components/InputArea.js';
import * as ChatContainer from '../containers/ChatContainer.js';
import * as AnimationManager from '../modules/AnimationManager.js';
import * as SessionList from '../../components/SessionList.js';
import { saveData } from '../../utils/storage.js';

let currentRequestController = null;

const getApiKeyIdentifier = (key) => key ? `key_${key.slice(-4)}` : 'no_key';

// [VPC] A clear, non-negotiable rule for the AI about LaTeX formatting.
const LATEX_FORMATTING_RULE = `--- SYSTEM RULE --- You MUST NOT wrap LaTeX formulas in \`\`\`latex code blocks. Instead, you MUST present all mathematical formulas using standard LaTeX delimiters ($$...$$ for display, $...$ for inline) directly within the text. This is a strict rendering requirement.`;

function filterHistoryForApi(history) {
    const lastUserMessageIndex = history.findLastIndex(m => m.role === 'user');
    return history.map((message, index) => {
        if (index === lastUserMessageIndex || message.role !== 'user') return message;
        const filteredParts = message.parts.filter(part => part.type === 'text' || part.type === 'image');
        return { ...message, parts: filteredParts };
    });
}

async function callChatApi(sessionId, model, history, chatId, historyTokenLimit, systemPrompt, temperature, topP, signal) {
    const { settings, dailyUsage } = appState;
    const primaryKey = settings.apiKey;
    const fallbackKeys = settings.fallbackApiKeys || [];
    const allKeys = [primaryKey, ...fallbackKeys].filter(Boolean);
    const limits = settings.dailyLimits || {};
    const modelLimit = limits[model] || 0;
    const usableKeys = allKeys.filter(key => {
        if (modelLimit === 0) return true;
        const keyId = getApiKeyIdentifier(key);
        const usage = dailyUsage.usageByKey?.[keyId]?.calls?.[model] || 0;
        return usage < modelLimit;
    });
    if (usableKeys.length === 0) {
        throw new Error(`일일 호출 제한에 도달했습니다. 이 모델(${model})은 오늘 더 이상 사용할 수 없습니다.`);
    }
    let apiResponse;
    for (const apiKey of usableKeys) {
        try {
            // [수정됨] GeminiAPIService.chat 함수를 호출할 때 chatId를 함께 전달합니다.
            apiResponse = await GeminiAPIService.chat(apiKey, model, history, chatId, historyTokenLimit, systemPrompt, temperature, topP, signal);
            break;
        } catch (error) {
            if (error.name === 'AbortError') throw error;
            const isQuotaError = error.message.toLowerCase().includes('quota') || error.status === 429;
            if (isQuotaError) {
                console.warn(`API key ${getApiKeyIdentifier(apiKey)} reached quota for model ${model}. Trying next key...`);
                Session.recordApiUsage(appState, sessionId, model, { totalTokenCount: 0 }, getApiKeyIdentifier(apiKey), true);
            } else { throw error; }
        }
    }
    if (!apiResponse) throw new Error("모든 API 키의 할당량이 소진되었거나 유효하지 않습니다.");
    return apiResponse;
}

async function executeChat(sessionId, signal) {
    const session = appState.sessions[sessionId];
    if (!session) return;
    try {
        // localStorage에서 직접 최신 상태를 가져와서 템플릿 정보를 확인
        let freshTemplates = [];
        try {
            const freshData = JSON.parse(localStorage.getItem('geminiChatApp') || '{}');
            freshTemplates = freshData.promptTemplates || [];
        } catch (e) {
            console.error('Failed to load fresh templates:', e);
        }
        
        const template = freshTemplates.find(t => t.id === session.systemPromptId);
        const userSystemPrompt = template ? template.text : '';
        const systemPrompt = userSystemPrompt ? 
            `${userSystemPrompt}\n\n${LATEX_FORMATTING_RULE}`.trim() : 
            LATEX_FORMATTING_RULE;
        
        console.log('System prompt processing:', {
            sessionId,
            systemPromptId: session.systemPromptId,
            templateFound: !!template,
            templateTitle: template?.title,
            totalTemplates: freshTemplates.length,
            allTemplateIds: freshTemplates.map(t => t.id),
            appStateTemplates: appState.promptTemplates.length,
            userSystemPrompt: userSystemPrompt.substring(0, 100) + (userSystemPrompt.length > 100 ? '...' : ''),
            finalSystemPrompt: systemPrompt.substring(0, 300) + (systemPrompt.length > 300 ? '...' : ''),
            willSendToAPI: !!userSystemPrompt
        });

        const { historyTokenLimit } = appState.settings;
        const filteredHistory = filterHistoryForApi(session.history);
        const { temperature, topP } = appState.settings;
        const currentChatId = session.chatId || null;

        const apiResponse = await callChatApi(sessionId, session.model, filteredHistory, currentChatId, historyTokenLimit, systemPrompt, temperature, topP, signal);
        
        // [수정됨!] 여기가 바로 올바른 작업 방식입니다.
        if (apiResponse.chatId && !session.chatId) {
            session.chatId = apiResponse.chatId; // 1. 직접 session 객체에 chatId를 추가하고,
            saveData(appState);                   // 2. saveData를 호출해서 변경 내용을 저장합니다.
            console.log(`[Session] ChatID ${apiResponse.chatId} saved for session ${sessionId}.`);
        }

        const keyIdentifier = getApiKeyIdentifier(apiResponse.usedApiKey);
        Session.recordApiUsage(appState, sessionId, session.model, apiResponse.usage, keyIdentifier);
        const fullResponseText = apiResponse.reply.text;
        const thinkingTime = Date.now() - (appState.loadingStates[sessionId]?.startTime || Date.now());
        const metadata = { thinkingTime, modelUsed: session.model, completionTimestamp: Date.now(), receivedAt: Date.now() };
        const newMessage = Session.addMessage(appState, sessionId, 'model', [{ type: 'text', text: fullResponseText }], metadata);
        ChatContainer.appendMessage(sessionId, newMessage);
        Session.updateTitleFromHistory(appState, sessionId);

        // ==========================================================
        // [✅ 최종 수정] Google Cloud TTS를 호출하여 음성을 재생합니다.
        // appState.settings.ttsEnabled는 설정(settings)에서 관리될 TTS ON/OFF 상태입니다.
        if (appState.settings.ttsEnabled && fullResponseText) {
            playAudioFromText(fullResponseText);
        }
        // ==========================================================

        SessionList.render(appState);
        if (appState.activeSessionId !== sessionId) {
            Toast.show(`'${session.title || "이전"}' 세션의 답변이 완료되었습니다.`);
        }
    } catch (error) {
        console.error(`Error in session ${sessionId}:`, error);
        const errorMessageText = (error.name === 'AbortError') ? '응답 생성이 취소되었습니다.' : `오류: ${error.message}`;
        const errorMessage = Session.addMessage(appState, sessionId, 'system', [{ type: 'text', text: errorMessageText }]);
        ChatContainer.appendMessage(sessionId, errorMessage);
        if (appState.loadingStates[sessionId]) {
            delete appState.loadingStates[sessionId];
            document.dispatchEvent(new CustomEvent('animation-complete', { detail: { sessionId } }));
        }
    }
}

export function cancelCurrentRequest() {
    if (currentRequestController) {
        currentRequestController.abort();
        console.log("Request cancelled by user.");
    }
}

async function runChatLifecycle(sessionId) {
    currentRequestController = new AbortController();
    try {
        appState.loadingStates[sessionId] = { status: 'thinking', startTime: Date.now() };
        InputArea.render(appState);
        SessionList.render(appState);
        ChatContainer.manageThinkingIndicator(sessionId, true);
        await executeChat(sessionId, currentRequestController.signal);
    } catch (error) {
        console.error("Critical error in chat lifecycle:", error);
        const errorMessage = Session.addMessage(appState, sessionId, 'system', [{ type: 'text', text: `전송 중 치명적 오류 발생: ${error.message}` }]);
        ChatContainer.appendMessage(sessionId, errorMessage);
    } finally {
        currentRequestController = null;
        // [REMOVED] All loading state management is now handled by AnimationManager or the API error catch block.
    }
}

export async function sendMessage() {
    const sessionId = appState.activeSessionId;
    if (!sessionId || appState.loadingStates[sessionId]) return;
    const messageText = InputArea.getTextValue();
    const files = [...appState.attachedFiles];
    if (!messageText && files.length === 0) {
        Toast.show("메시지를 입력하거나 파일을 첨부해주세요.");
        return;
    }
    AnimationManager.stop(sessionId);
    const userMessageParts = await prepareMessageParts(messageText, files);
    const newMessage = Session.addMessage(appState, sessionId, 'user', userMessageParts);
    ChatContainer.appendMessage(sessionId, newMessage);
    InputArea.clearInput();
    appState.attachedFiles = [];
    await runChatLifecycle(sessionId);
}

export async function regenerate(sessionId, messageId) {
    const session = appState.sessions[sessionId];
    if (!session || appState.loadingStates[sessionId]) return;
    AnimationManager.stop(sessionId);
    const messageIndex = session.history.findIndex(m => m.id === messageId);
    if (messageIndex < 1 || session.history[messageIndex].role !== 'model') return;
    const lastUserMessageIndex = session.history.slice(0, messageIndex).findLastIndex(m => m.role === 'user');
    if (lastUserMessageIndex === -1) return;
    session.history.splice(lastUserMessageIndex + 1);
    ChatContainer.rerenderSessionView(sessionId);
    await runChatLifecycle(sessionId);
}

export async function resubmit(sessionId) {
    if (appState.loadingStates[sessionId]) return;
    AnimationManager.stop(sessionId);
    await runChatLifecycle(sessionId);
}

// --- Utility Functions ---
function getLanguageName(filename) {
    const extension = (filename || '').split('.').pop().toLowerCase();
    const map = { js: 'JavaScript', py: 'Python', html: 'HTML', css: 'CSS', json: 'JSON', md: 'Markdown', java: 'Java', c: 'C', cpp: 'C++', cs: 'C#', go: 'Go', php: 'PHP', rb: 'Ruby', rs: 'Rust', sh: 'Shell', ts: 'TypeScript', xml: 'XML', yaml: 'YAML', yml: 'YAML', txt: 'Text', pdf: 'PDF' };
    return map[extension] || extension.toUpperCase() || 'File';
}

function createCodeSummary(file, content) {
    const lines = content.split('\n');
    const lineCount = lines.length;
    return { filename: file.name, size: file.size, language: getLanguageName(file.name), lineCount: lineCount, fullCode: content };
}

export async function prepareMessageParts(messageText, attachedFiles = []) {
    const parts = [];
    for (const file of attachedFiles) {
        if (file.type.startsWith('image/')) {
            parts.push({ type: 'image', mimeType: file.type, data: file.data });
        } else if (file.type === 'application/pdf') {
            parts.push({ type: 'pdf-attachment', name: file.name, data: file.data });
        } else {
            const summary = createCodeSummary(file, file.data);
            parts.push({ type: 'code-summary', summary: summary });
        }
    }
    if (messageText) {
        parts.push({ type: 'text', text: messageText });
    }
    return parts;
}

export function readFileAsPromise(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (error) => reject(error);
        if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
            reader.readAsDataURL(file);
        } else {
            reader.readAsText(file);
        }
    });
}

// 현재 재생 중인 오디오를 제어하기 위한 변수
let currentAudio = null;

// [✅ 새로운 함수 1] 우리 서버의 TTS 엔드포인트를 호출하고 오디오를 재생하는 함수
async function playAudioFromText(text) {
    // 만약 이전에 재생 중인 오디오가 있다면 중지
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    try {
        const response = await fetch('/api/synthesize-speech', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || '음성 파일 생성에 실패했습니다.');
        }

        const data = await response.json();
        const audioContent = data.audioContent;

        const audioSource = `data:audio/mp3;base64,${audioContent}`;
        currentAudio = new Audio(audioSource);
        
        await currentAudio.play();

    } catch (error) {
        console.error('음성 재생 오류:', error);
        Toast.show(`음성 재생 오류: ${error.message}`);
    } finally {
        // 재생이 끝나면 currentAudio를 null로 만들어 다음 재생을 준비
        if (currentAudio) {
            currentAudio.onended = () => {
                currentAudio = null;
            };
        }
    }
}

// [✅ 새로운 함수 2] TTS 버튼의 상태를 토글하고, appState에 저장하는 함수
export function toggleTTS() {
    // appState에 ttsEnabled 상태가 없으면 초기화
    if (typeof appState.settings.ttsEnabled === 'undefined') {
        appState.settings.ttsEnabled = false;
    }

    appState.settings.ttsEnabled = !appState.settings.ttsEnabled;
    saveData(appState); // 변경된 설정을 localStorage에 저장

    Toast.show(appState.settings.ttsEnabled ? "음성 답변이 활성화되었습니다." : "음성 답변이 비활성화되었습니다.");
    
    // 비활성화 시 재생 중인 오디오 중지
    if (!appState.settings.ttsEnabled && currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }

    return appState.settings.ttsEnabled;
}