// [CoreDNA] Encapsulates all low-level communication with the backend API proxy.

// This function is the single point of contact for all backend API calls.
async function apiCall(endpoint, body, signal) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal // Pass the signal to fetch
    });
    const data = await response.json();
    if (!response.ok) {
        const error = new Error(data.message || 'API request failed');
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

export async function getModels(apiKey, signal) { 
    const data = await apiCall('/api/models', { apiKey }, signal); 
    return data.models; 
}

export async function validateApiKey(apiKey, signal) {
    const data = await apiCall('/api/validate', { apiKey }, signal);
    return data;
}

export async function chat(apiKey, model, history, chatId, historyTokenLimit, systemPrompt, temperature, topP, signal, options = {}) { // 1. [✅ 수정] options 매개변수 추가
    const { task } = options; // 2. options에서 task 추출

    // 3. body 객체에 task 추가
    const body = { apiKey, model, history, chatId, historyTokenLimit, systemPrompt, temperature, topP, task }; 

    const response = await apiCall('/api/chat', body, signal);
    
    return { reply: response.reply, usage: response.usage, chatId: response.chatId, usedApiKey: apiKey };
}

export async function extractTextFromPdf(base64Pdf, signal) {
    const data = await apiCall('/api/extract-text', { fileData: base64Pdf }, signal);
    return data.text;
}