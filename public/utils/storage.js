// [CoreDNA] This module is solely responsible for localStorage interactions.
const STORAGE_KEY = 'geminiChatApp';

export function loadData() {
    try {
        const storedData = localStorage.getItem(STORAGE_KEY);
        return storedData ? JSON.parse(storedData) : {};
    } catch (error) {
        console.error('Failed to load data from localStorage:', error);
        return {};
    }
}

export function saveData(state) {
    try {
        // [THE FIX] Create a new object excluding transient (in-memory) states.
        // This prevents states like 'loadingStates' from being incorrectly persisted.
        const { loadingStates, ...stateToSave } = state;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
        console.error('Failed to save data to localStorage:', error);
    }
}