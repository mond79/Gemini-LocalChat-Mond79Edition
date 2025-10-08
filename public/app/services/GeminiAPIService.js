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

export async function chat(apiKey, model, history, chatId, historyTokenLimit, systemPrompt, temperature, topP, signal) { // 1. 매개변수에 chatId 추가
    const body = { apiKey, model, history, chatId, historyTokenLimit, systemPrompt, temperature, topP }; // 2. body 객체에 chatId 추가

    const response = await apiCall('/api/chat', body, signal);
    
    // 3. 서버가 보내준 chatId를 응답에 포함시켜서 돌려줍니다.
    return { reply: response.reply, usage: response.usage, chatId: response.chatId, usedApiKey: apiKey };
}

export async function extractTextFromPdf(base64Pdf, signal) {
    const data = await apiCall('/api/extract-text', { fileData: base64Pdf }, signal);
    return data.text;
}