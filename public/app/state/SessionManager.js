// [CoreDNA] A collection of pure functions for session and sidebar state manipulation.
import { saveData } from '../../utils/storage.js';
import * as Toast from '../../components/Toast.js';
import { StudyLoop } from '../controllers/StudyLoop.js';

// --- Helper ---
function findItemRecursive(items, itemId, parent = null) {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.id === itemId) {
            return { item, parent, parentList: items, index: i };
        }
        if (item.type === 'folder') {
            const found = findItemRecursive(item.children, itemId, item);
            if (found) return found;
        }
    }
    return null;
}

function _checkLimitAndNotify(state, modelId, apiKeyIdentifier) {
    const limit = state.settings.dailyLimits?.[modelId] || 0;
    if (limit === 0) return;

    const currentUsage = state.dailyUsage.usageByKey?.[apiKeyIdentifier]?.calls?.[modelId] || 0;
    const threshold = Math.floor(limit * 0.8);

    if (currentUsage >= threshold && currentUsage < limit) {
        const notifiedKey = `${apiKeyIdentifier}-${modelId}`;
        if (!state.dailyUsage.notifiedLimits) {
            state.dailyUsage.notifiedLimits = {};
        }
        if (!state.dailyUsage.notifiedLimits[notifiedKey]) {
            Toast.show(`경고: ${modelId} 모델의 일일 한도(${limit}회) 중 ${currentUsage}회를 사용했습니다.`);
            state.dailyUsage.notifiedLimits[notifiedKey] = true;
        }
    }
}

// --- Session Management ---
export function newSession(state) {
    StudyLoop.forceStop();
    const now = Date.now();
    const newId = `session-${now}`;
    const lastActiveModel = state.sessions[state.activeSessionId]?.model;
    
    // 기본 시스템 프롬프트 결정 로직:
    // 1. 기본 템플릿이 설정되어 있으면 사용
    // 2. 기본 템플릿이 없으면 null (시스템 프롬프트 없음)
    // 주의: 사용자가 기본 템플릿을 해제했다면 이전 세션의 프롬프트를 상속받지 않음
    const defaultSystemPromptId = state.settings.defaultSystemPromptId || null;
    
    console.log('Creating new session with system prompt:', {
        newSessionId: newId,
        defaultSystemPromptId: state.settings.defaultSystemPromptId,
        finalSystemPromptId: defaultSystemPromptId,
        hasDefaultTemplate: !!state.settings.defaultSystemPromptId
    });
    
    state.sessions[newId] = {
        id: newId,
        title: '새 대화',
        createdAt: now,
        lastModified: now,
        model: lastActiveModel || state.settings.defaultModel || '',
        history: [],
        isPinned: false,
        systemPromptId: defaultSystemPromptId,
        tags: [],
        // [REMOVED] scrollPosition is no longer needed.
    };
    state.activeSessionId = newId;
    state.attachedFiles = [];
    state.sidebarItems.unshift({ type: 'session', id: newId });
    saveData(state);
    return state;
}

export function deleteSession(state, sessionId) {
    const found = findItemRecursive(state.sidebarItems, sessionId);
    if (found) {
        found.parentList.splice(found.index, 1);
    }
    delete state.sessions[sessionId];
    if (state.activeSessionId === sessionId) {
        const findFirstSession = (items) => {
            for (const item of items) {
                if (item.type === 'session') return item.id;
                if (item.type === 'folder') {
                    const foundId = findFirstSession(item.children);
                    if (foundId) return foundId;
                }
            }
            return null;
        };
        state.activeSessionId = findFirstSession(state.sidebarItems);
        if (!state.activeSessionId) {
            newSession(state); // newSession already saves
            return state;
        }
    }
    saveData(state);
    return state;
}
export function switchSession(state, sessionId) {
    StudyLoop.forceStop();
    if (state.sessions[sessionId]) {
        state.activeSessionId = sessionId;
        state.attachedFiles = [];
    }
    // No state mutation that needs saving, just a view change.
    return state;
}

export function addMessage(state, sessionId, role, parts, metadata = {}) {
    const session = state.sessions[sessionId];
    const message = { id: `msg-${Date.now()}-${Math.random()}`, role, parts, ...metadata };
    if (session) {
        session.history.push(message);
        session.lastModified = Date.now();
    } else {
        console.error(`Attempted to add a message to a non-existent session: ${sessionId}`);
    }
    saveData(state);
    return message; // [MODIFIED] Return the created message object
}

export function markTypingAsComplete(state, sessionId, messageId) {
    const session = state.sessions[sessionId];
    if (!session) return;
    const message = session.history.find(m => m.id === messageId);
    if (message && message.receivedAt) {
        delete message.receivedAt;
        saveData(state);
    }
}

export function deleteMessage(state, sessionId, messageId) {
    const session = state.sessions[sessionId];
    if (session) {
        const messageIndex = session.history.findIndex(m => m.id === messageId);
        if (messageIndex > -1) {
            session.history.splice(messageIndex, 1);
            session.lastModified = Date.now();
            saveData(state);
        }
    }
    return state;
}

function updateMessageEditingState(state, sessionId, messageId, isEditing) {
    const session = state.sessions[sessionId];
    if (!session) return state;
    const message = session.history.find(m => m.id === messageId);
    if (message) {
        if (isEditing) {
            message.isEditing = true;
        } else {
            delete message.isEditing;
        }
    }
    return state;
}
export const startEditingMessage = (state, sessionId, messageId) => updateMessageEditingState(state, sessionId, messageId, true);
export const cancelEditingMessage = (state, sessionId, messageId) => updateMessageEditingState(state, sessionId, messageId, false);

export function saveEditedMessage(state, sessionId, messageId, newParts) {
    const session = state.sessions[sessionId];
    if (!session) return state;
    const messageIndex = session.history.findIndex(m => m.id === messageId);
    if (messageIndex === -1) return state;
    session.history.splice(messageIndex + 1);
    const message = session.history[messageIndex];
    message.parts = newParts;
    delete message.isEditing;
    session.lastModified = Date.now();
    saveData(state);
    return state;
}

export function recordApiUsage(state, sessionId, modelId, usageMetadata, apiKeyIdentifier, forceIncrement = false) {
    if (!apiKeyIdentifier) { console.warn('[Usage] API Key Identifier not provided. Usage not recorded.'); return state; }
    const totalTokens = usageMetadata.totalTokenCount || 0;
    if (!state.dailyUsage.usageByKey) state.dailyUsage.usageByKey = {};
    if (!state.dailyUsage.usageByKey[apiKeyIdentifier]) { state.dailyUsage.usageByKey[apiKeyIdentifier] = { calls: {}, tokens: {} }; }
    const keyUsage = state.dailyUsage.usageByKey[apiKeyIdentifier];
    if (forceIncrement || totalTokens > 0) { keyUsage.calls[modelId] = (keyUsage.calls[modelId] || 0) + 1; }
    keyUsage.tokens[modelId] = (keyUsage.tokens[modelId] || 0) + totalTokens;
    if (totalTokens > 0) {
        if (!state.usage) state.usage = [];
        state.usage.push({ sessionId, timestamp: Date.now(), model: modelId, promptTokens: usageMetadata.promptTokenCount || 0, outputTokens: usageMetadata.candidatesTokenCount || 0, totalTokens: totalTokens });
    }
    _checkLimitAndNotify(state, modelId, apiKeyIdentifier);
    saveData(state);
    return state;
}

export function updateTitleFromHistory(state, sessionId) {
    const session = state.sessions[sessionId];
    if (session && session.history.length > 0 && session.title === '새 대화') {
        const firstUserMessage = session.history.find(m => m.role === 'user');
        if (firstUserMessage) {
            const textPart = firstUserMessage.parts.find(p => p.type === 'text');
            if (textPart) {
                const titleText = textPart.text;
                session.title = titleText.substring(0, 30) + (titleText.length > 30 ? '...' : '');
                session.lastModified = Date.now();
                saveData(state);
            }
        }
    }
    return state;
}

export function updateSessionModel(state, modelId) {
    const activeSession = state.sessions[state.activeSessionId];
    if (activeSession) {
        console.log('Updating session model:', {
            sessionId: state.activeSessionId,
            oldModel: activeSession.model,
            newModel: modelId
        });
        
        activeSession.model = modelId;
        activeSession.lastModified = Date.now();
        saveData(state);
        
        console.log('Session model updated successfully');
    } else {
        console.warn('No active session found for model update');
    }
    return state;
}

export function updateSystemPromptId(state, templateId) {
    const activeSession = state.sessions[state.activeSessionId];
    if (activeSession) {
        activeSession.systemPromptId = templateId === 'none' ? null : templateId;
        activeSession.lastModified = Date.now();
        saveData(state);
    }
    return state;
}

// --- Tag Management ---
export function addTagToSession(state, sessionId, tag) {
    const session = state.sessions[sessionId];
    const trimmedTag = tag.trim();
    if (session && trimmedTag) {
        if (!session.tags) {
            session.tags = [];
        }
        if (!session.tags.includes(trimmedTag)) {
            session.tags.push(trimmedTag);
            saveData(state);
        }
    }
    return state;
}

export function removeTagFromSession(state, sessionId, tag) {
    const session = state.sessions[sessionId];
    const trimmedTag = tag.trim();
    if (session && session.tags && trimmedTag) {
        const index = session.tags.indexOf(trimmedTag);
        if (index > -1) {
            session.tags.splice(index, 1);
            saveData(state);
        }
    }
    return state;
}

// --- Sidebar Item Management ---
export { findItemRecursive };

export function togglePinSession(state, sessionId) {
    const session = state.sessions[sessionId];
    if (session) {
        session.isPinned = !session.isPinned;
        saveData(state);
    }
    return state;
}

export function renameItem(state, itemId, newName) {
    if (!newName.trim()) return state;
    const found = findItemRecursive(state.sidebarItems, itemId);
    if (found) {
        if (found.item.type === 'session') {
             if(state.sessions[itemId]) {
                 state.sessions[itemId].title = newName.trim();
                 state.sessions[itemId].lastModified = Date.now();
             }
        } else { // folder
            found.item.name = newName.trim();
        }
        saveData(state);
    }
    return state;
}

export function createFolder(state) {
    const newFolder = { type: 'folder', id: `folder-${Date.now()}`, name: '새 폴더', isOpen: true, children: [] };
    state.sidebarItems.unshift(newFolder);
    saveData(state);
    return state;
}

export function toggleFolder(state, folderId) {
    const found = findItemRecursive(state.sidebarItems, folderId);
    if (found && found.item.type === 'folder') {
        found.item.isOpen = !found.item.isOpen;
        saveData(state);
    }
    return state;
}

export function deleteFolder(state, folderId) {
    const found = findItemRecursive(state.sidebarItems, folderId);
    if (found && found.item.type === 'folder') {
        found.parentList.splice(found.index, 1, ...found.item.children);
        saveData(state);
    }
    return state;
}

export function moveItem(state, itemId, targetId) {
    const itemResult = findItemRecursive(state.sidebarItems, itemId);
    if (!itemResult || itemId === targetId) return state;
    const [movedItem] = itemResult.parentList.splice(itemResult.index, 1);
    if (!targetId) {
        state.sidebarItems.unshift(movedItem);
    } else {
        const targetResult = findItemRecursive(state.sidebarItems, targetId);
        if (!targetResult) {
            itemResult.parentList.splice(itemResult.index, 0, movedItem);
        } else if (targetResult.item.type === 'folder') {
            targetResult.item.children.unshift(movedItem);
            targetResult.item.isOpen = true;
        } else {
            targetResult.parentList.splice(targetResult.index + 1, 0, movedItem);
        }
    }
    saveData(state);
    return state;
}

export function resetAllSessions(state) {
    state.sessions = {};
    state.sidebarItems = [];
    state.activeSessionId = null;
    newSession(state); // newSession already saves
    return state;
}

export function updateMessageParts(state, sessionId, messageId, newParts) {
    const session = state.sessions[sessionId];
    if (!session) {
        console.warn(`[SessionManager] updateMessageParts: 세션 ID ${sessionId}를 찾을 수 없습니다.`);
        return state;
    }
    
    const message = session.history.find(m => m.id === messageId);
    if (message) {
        message.parts = newParts;
        session.lastModified = Date.now();
        saveData(state); // 변경사항을 영구 저장
        console.log(`[SessionManager] 메시지 ID ${messageId}의 내용이 성공적으로 업데이트되었습니다.`);
    } else {
        console.warn(`[SessionManager] updateMessageParts: 메시지 ID ${messageId}를 세션 ${sessionId}에서 찾을 수 없습니다.`);
    }
    return state;
}