require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const { exec } = require('child_process');

const app = express();
const port = 3333;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

app.use(cors());
app.use(express.json({ limit: '100mb' }));

// [MODIFIED FOR PKG] Use path.join to create an absolute path to the 'public' directory.
app.use(express.static(path.join(__dirname, 'public')));

// [FINAL FIX] Add a specific route for the root path '/' to explicitly serve index.html.
// This is the most robust way to ensure the main page loads in a pkg environment.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function fetchAvailableModels(apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    try {
        const response = await fetch(url);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error.message || `API 요청 실패: ${response.status}`);
        }
        const data = await response.json();
        return data.models
            .filter(model => model.supportedGenerationMethods.includes('generateContent'))
            .map(model => ({ id: model.name.replace('models/', ''), name: model.displayName }));
    } catch (error) {
        console.error('모델 목록 조회 중 오류:', error.message);
        throw error;
    }
}

app.post('/api/validate', async (req, res) => {
    if (!GEMINI_API_KEY) return res.status(400).json({ valid: false, message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    try {
        await fetchAvailableModels(GEMINI_API_KEY);
        res.json({ valid: true, message: '서버의 API 키가 유효합니다.' });
    } catch (error) {
        res.status(400).json({ valid: false, message: `API 키 검증 실패: ${error.message}` });
    }
});

app.post('/api/models', async (req, res) => {
    if (!GEMINI_API_KEY) return res.status(400).json({ message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    try {
        const models = await fetchAvailableModels(GEMINI_API_KEY);
        res.json({ models });
    } catch (error) {
        res.status(500).json({ message: `모델 목록 조회 실패: ${error.message}` });
    }
});

app.post('/api/extract-text', async (req, res) => {
    const { fileData } = req.body;
    if (!fileData) {
        return res.status(400).json({ message: 'PDF 파일 데이터가 필요합니다.' });
    }
    try {
        const buffer = Buffer.from(fileData.split(',')[1], 'base64');
        const data = await pdf(buffer);
        res.json({ text: data.text });
    } catch (error) {
        console.error('PDF 텍스트 추출 중 오류:', error);
        res.status(500).json({ message: `PDF 처리 중 오류가 발생했습니다: ${error.message}` });
    }
});

function trimHistoryByTokenLimit(history, limit) {
    if (!limit || limit <= 0) return history;
    let totalTokens = 0;
    const trimmedHistory = [];
    for (let i = history.length - 1; i >= 0; i--) {
        const message = history[i];
        const messageTokens = message.parts.reduce((acc, part) => {
            if (part.type === 'text') return acc + Math.ceil((part.text || '').length / 4);
            if (part.type === 'image') return acc + Math.ceil((part.data || '').length * 0.75 / 1000) * 250;
            return acc;
        }, 0);
        if (totalTokens + messageTokens <= limit) {
            trimmedHistory.unshift(message);
            totalTokens += messageTokens;
        } else {
            break;
        }
    }
    console.log(`[History Trimmer] Original: ${history.length} messages. Trimmed: ${trimmedHistory.length} messages. (~${totalTokens} tokens)`);
    return trimmedHistory;
}

async function processAttachmentsForAI(history) {
    return Promise.all(history.map(async (message) => {
        if (message.role !== 'user') return message;
        const newParts = await Promise.all(message.parts.map(async (part) => {
            if (part.type === 'code-summary' && part.summary) {
                const { filename, fullCode } = part.summary;
                return { type: 'text', text: `--- START OF FILE: ${filename} ---\n\n${fullCode}\n\n--- END OF FILE: ${filename} ---\n\n` };
            } else if (part.type === 'pdf-attachment') {
                try {
                    console.log(`[Attachment Processor] Processing PDF: ${part.name}`);
                    const buffer = Buffer.from(part.data.split(',')[1], 'base64');
                    const data = await pdf(buffer);
                    return { type: 'text', text: `--- START OF DOCUMENT: ${part.name} ---\n\n${data.text}\n\n--- END OF DOCUMENT ---` };
                } catch (error) {
                    console.error('Server-side PDF processing error:', error);
                    return { type: 'text', text: `[PDF 처리 실패: ${error.message}]` };
                }
            }
            return part;
        }));
        const textParts = newParts.filter(p => p.type === 'text').map(p => p.text);
        const otherParts = newParts.filter(p => p.type !== 'text');
        if (textParts.length > 0) {
            otherParts.push({ type: 'text', text: textParts.join('\n\n') });
        }
        return { ...message, parts: otherParts };
    }));
}

function formatHistoryForGoogleAI(history) {
    return history.map(msg => ({
        role: msg.role === 'system' ? 'user' : msg.role,
        parts: msg.parts
            .map(part => {
                if (part.type === 'text') return { text: part.text };
                if (part.type === 'image') {
                    const dataParts = (part.data || '').split(',');
                    return { inlineData: { mimeType: part.mimeType, data: dataParts[1] || '' } };
                }
                return null;
            })
            .filter(Boolean)
    })).filter(msg => msg.parts.length > 0);
}

app.post('/api/chat', async (req, res) => {
    const { model: modelName, history, historyTokenLimit, systemPrompt, temperature, topP } = req.body;
    console.log(`[API] Chat request - Model: ${modelName}, Temperature: ${temperature}, Top-P: ${topP}`);
    if (!GEMINI_API_KEY) {
        return res.status(400).json({ message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }
    if (!modelName || !Array.isArray(history)) {
        return res.status(400).json({ message: '모델과 올바른 형식의 대화 내용이 모두 필요합니다.' });
    }
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        
        // 생성 설정 구성
        const generationConfig = {};
        if (temperature !== undefined && temperature >= 0 && temperature <= 2) {
            generationConfig.temperature = temperature;
        }
        if (topP !== undefined && topP >= 0.1 && topP <= 1.0) {
            generationConfig.topP = topP;
        }
        
        console.log(`[API] Generation config:`, generationConfig);
        
        const model = genAI.getGenerativeModel({ 
            model: modelName,
            generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined
        });
        let conversationHistory = [...history];
        if (systemPrompt && systemPrompt.trim() !== '') {
            conversationHistory.unshift(
                { role: 'user', parts: [{ type: 'text', text: systemPrompt }] },
                { role: 'model', parts: [{ type: 'text', text: '알겠습니다. 이제부터 당신의 지시에 따라 응답하겠습니다.' }] }
            );
        }
        const processedHistory = await processAttachmentsForAI(conversationHistory);
        const effectiveHistory = trimHistoryByTokenLimit(processedHistory, historyTokenLimit);
        const lastMessage = effectiveHistory.pop();
        const chatHistoryForAI = formatHistoryForGoogleAI(effectiveHistory);
        const userMessageParts = lastMessage ? formatHistoryForGoogleAI([lastMessage])[0].parts : [];
        if (!userMessageParts || userMessageParts.length === 0) {
            return res.status(400).json({ message: "Cannot send an empty message." });
        }
        const chat = model.startChat({ history: chatHistoryForAI });
        const result = await chat.sendMessage(userMessageParts);
        const response = result.response;
        const text = response.text();
        res.json({ reply: { type: 'text', text }, usage: response.usageMetadata });
    } catch (error) {
        console.error('채팅 API 오류:', error);
        res.status(500).json({ message: `대화 생성 중 오류: ${error.message}` });
    }
});

app.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`서버가 ${url} 에서 실행 중입니다.`);
  
  // 자동으로 브라우저 열기
  const start = process.platform === 'darwin' ? 'open' : 
                process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${start} ${url}`, (error) => {
    if (error) {
      console.log('브라우저를 자동으로 열 수 없습니다. 수동으로 브라우저에서 접속해주세요.');
    } else {
      console.log('브라우저가 자동으로 열렸습니다.');
    }
  });
  
  if (!GEMINI_API_KEY) {
    console.warn(`[경고] .env 파일에 GEMINI_API_KEY가 설정되지 않았습니다. API가 작동하지 않을 수 있습니다.`);
  }
});