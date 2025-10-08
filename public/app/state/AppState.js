// [CoreDNA] This module is the single source of truth for the application state.
import { loadData } from '../../utils/storage.js';

const initialState = {
    settings: { 
        apiKey: '', 
        fallbackApiKeys: [],
        defaultModel: '', 
        managedModels: [],
        historyTokenLimit: 0,
        dailyLimits: {},
        favoriteModels: [],
        typingSpeed: 30,
        sidebarSortMode: 'lastModified',
        mathRenderer: 'katex',
        defaultSystemPromptId: null, // 새 세션에 기본으로 적용할 시스템 프롬프트 ID
        temperature: 1.0, // AI 응답의 창의성 조절 (0.0-2.0)
        topP: 0.9, // AI 응답의 다양성 조절 (0.1-1.0)
        modelCosts: {
            'gemini-1.5-pro-latest':   { input: 3.50, output: 10.50 },
            'gemini-1.5-flash-latest': { input: 0.35, output: 1.05  },
            'gemini-1.0-pro':          { input: 0.50, output: 1.50  },
        },
    },
    usage: [],
    dailyUsage: {
        date: '',
        usageByKey: {}
    },
    sessions: {},
    activeSessionId: null,
    sidebarItems: [],
    availableModels: [],
    attachedFiles: [],
    isSidebarCollapsed: false,
    isDarkMode: false,
    promptTemplates: [],
    loadingStates: {}, // This is a transient, in-memory state.
};

// [NEW] Data Sanitization Logic
// This function ensures data loaded from storage is clean and consistent.
function sanitizePersistentState(loadedState) {
    if (!loadedState) return {};

    // Rule 1: Clean up any unfinished streaming states from previous sessions.
    if (loadedState.sessions) {
        Object.values(loadedState.sessions).forEach(session => {
            if (session.history && Array.isArray(session.history)) {
                session.history.forEach(message => {
                    if (message && message.receivedAt) {
                        console.warn(`[Sanitizer] Found and removed stale 'receivedAt' property from a message in session ${session.id}`);
                        delete message.receivedAt;
                    }
                });
            }
        });
    }

    // Rule 2 (Data Migration): Handle legacy message formats (string text to parts array).
    if (loadedState.sessions) {
        Object.values(loadedState.sessions).forEach(session => {
            if (session.history && Array.isArray(session.history)) {
                session.history = session.history.map(message => {
                    if (message && typeof message === 'object' && !message.parts && message.text) {
                        console.log(`[Data Migration] Migrating legacy message in session ${session.id}`);
                        const { text, ...rest } = message;
                        return { ...rest, parts: [{ type: 'text', text: text }] };
                    }
                    return message;
                });
            }
        });
    }

    // Rule 3 (Data Migration): Handle legacy fallbackApiKey.
    if (loadedState.settings && loadedState.settings.fallbackApiKey) {
        if (!loadedState.settings.fallbackApiKeys || loadedState.settings.fallbackApiKeys.length === 0) {
            loadedState.settings.fallbackApiKeys = [loadedState.settings.fallbackApiKey];
        }
        delete loadedState.settings.fallbackApiKey;
    }

    // Rule 4 (Data Migration): Migrate flat session list to hierarchical sidebarItems.
    if (loadedState.sessions && (!loadedState.sidebarItems || loadedState.sidebarItems.length === 0)) {
        console.log("[Data Migration] Migrating flat session list to new hierarchical structure...");
        loadedState.sidebarItems = Object.keys(loadedState.sessions)
            .sort((a, b) => loadedState.sessions[b].createdAt - loadedState.sessions[a].createdAt)
            .map(sessionId => ({ type: 'session', id: sessionId }));
    }

     // Rule 5 (Data Migration): Populate managedModels for backward compatibility.
    if (loadedState.settings && !loadedState.settings.managedModels) {
        const managed = new Set();
        if(loadedState.settings.dailyLimits) Object.keys(loadedState.settings.dailyLimits).forEach(id => managed.add(id));
        if(loadedState.settings.modelCosts) Object.keys(loadedState.settings.modelCosts).forEach(id => managed.add(id));
        loadedState.settings.managedModels = Array.from(managed);
        console.log("[Data Migration] Populating 'managedModels' from existing settings.");
    }

    return loadedState;
}

let rawLoadedState = loadData();
let loadedState = sanitizePersistentState(rawLoadedState);

export const appState = {
    ...initialState,
    ...loadedState,
    settings: {
        ...initialState.settings,
        ...(loadedState.settings || {}),
        managedModels: loadedState.settings?.managedModels || [],
        fallbackApiKeys: loadedState.settings?.fallbackApiKeys || [],
        dailyLimits: loadedState.settings?.dailyLimits || {},
        favoriteModels: loadedState.settings?.favoriteModels || [],
        typingSpeed: loadedState.settings?.typingSpeed ?? initialState.settings.typingSpeed,
        sidebarSortMode: loadedState.settings?.sidebarSortMode || initialState.settings.sidebarSortMode,
        mathRenderer: loadedState.settings?.mathRenderer || initialState.settings.mathRenderer,
        modelCosts: {
             ...initialState.settings.modelCosts,
             ...(loadedState.settings?.modelCosts || {})
        },
    },
    sessions: loadedState.sessions ? Object.entries(loadedState.sessions).reduce((acc, [id, session]) => {
        acc[id] = { ...session, systemPromptId: session.systemPromptId || null, tags: session.tags || [] };
        return acc;
    }, {}) : {},
    sidebarItems: loadedState.sidebarItems || initialState.sidebarItems,
    dailyUsage: loadedState.dailyUsage || initialState.dailyUsage,
    promptTemplates: loadedState.promptTemplates || initialState.promptTemplates,
    // IMPORTANT: loadingStates is always initialized as empty, never loaded from storage.
    loadingStates: {},
    attachedFiles: loadedState.attachedFiles || [],
};

export function refreshState() {
    console.log('[AppState] Refreshing state from localStorage...');
    let freshRawData = loadData();
    let freshData = sanitizePersistentState(freshRawData);

    appState.settings = { 
        ...initialState.settings, 
        ...(freshData.settings || {}), 
        managedModels: freshData.settings?.managedModels || [],
        fallbackApiKeys: freshData.settings?.fallbackApiKeys || [],
        modelCosts: {
            ...initialState.settings.modelCosts,
            ...(freshData.settings?.modelCosts || {})
        }
    };
    appState.usage = freshData.usage || [];
    appState.dailyUsage = freshData.dailyUsage || { ...initialState.dailyUsage };
    appState.promptTemplates = freshData.promptTemplates || [];
    appState.sidebarItems = freshData.sidebarItems || [];
}

export function saveState() {
    console.log('[AppState] Saving state to localStorage...');
    try {
        const STORAGE_KEY = 'geminiChatApp';
        const { loadingStates, ...stateToSave } = appState;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
        console.error('Failed to save state to localStorage:', error);
    }
}