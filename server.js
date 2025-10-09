require('dotenv').config();
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const KAKAO_API_KEY = process.env.KAKAO_API_KEY; 
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const fs = require('fs/promises'); // <-- 파일 시스템(Promise 기반) 모듈
const { v4: uuidv4 } = require('uuid'); // <-- UUID 생성 모듈
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const { exec } = require('child_process');
const cheerio = require('cheerio');

const chatHistoriesDir = path.join(__dirname, 'chat_histories'); // <-- 이 줄을 추가

const app = express();
const port = 3333;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ==========================================================
// [추가된 부분 1] 우리가 사용할 도구(함수)들을 정의합니다.
// ==========================================================
const tools = {
  getCurrentTime() {
    const now = new Date();
    console.log('[Function Executed] getCurrentTime 실행됨');
    const options = {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul'
    };
    return now.toLocaleString('ko-KR', options);
  },
  // 이제 searchWeb 함수를 여기서 사용해도 컴퓨터가 알아듣습니다.
  searchWeb: searchWeb,
  getWeather: getWeather,
  saveUserProfile, 
  loadUserProfile,
  scrapeWebsite   
};



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
                if (part.type === 'text') {
                    return { text: part.text };
                }

                if (part.type === 'image' || part.type === 'audio') {
                    // 데이터가 "data:[MIME타입];base64," 형식의 URL로 시작하는지 확인
                    if (part.data && part.data.startsWith('data:')) {
                        const base64Data = part.data.split(',')[1] || '';
                        
                        // [✅ 최종 수정] 서버에서 한번 더 확실하게 Base64로 인코딩합니다.
                        // 클라이언트에서 넘어온 데이터가 순수하지 않을 경우를 대비한 최종 안전장치입니다.
                        try {
                            // 이미 Base64인 문자열을 다시 버퍼로 만들었다가 Base64로 인코딩
                            const buffer = Buffer.from(base64Data, 'base64');
                            const reEncodedData = buffer.toString('base64');

                            return { 
                                inlineData: { 
                                    mimeType: part.mimeType, 
                                    data: reEncodedData
                                } 
                            };
                        } catch (e) {
                            console.error('Base64 재인코딩 실패:', e);
                            return null; // 오류 발생 시 이 part는 제외
                        }
                    }
                    return null; // 유효한 데이터 URL이 아니면 제외
                }

                return null;
            })
            .filter(Boolean)
    })).filter(msg => msg.parts.length > 0);
}

// [새로운 도구] 주소를 위도/경도 좌표로 변환하는 함수
async function getCoordinates(address) {
    console.log(`[Geocoding] 주소 좌표 변환 시도: ${address}`);
    if (!KAKAO_API_KEY) {
        console.error('[Geocoding] KAKAO_API_KEY가 .env 파일에 설정되지 않았습니다.');
        return null;
    }
    const url = `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Authorization': `KakaoAK ${KAKAO_API_KEY}` }
        });
        if (!response.ok) throw new Error(`카카오 지도 API 요청 실패: ${response.statusText}`);
        
        const data = await response.json();
        if (data.documents && data.documents.length > 0) {
            const coords = {
                lat: data.documents[0].y, // 위도
                lon: data.documents[0].x  // 경도
            };
            console.log(`[Geocoding] 변환 성공:`, coords);
            return coords;
        } else {
            console.log(`[Geocoding] '${address}'에 대한 좌표를 찾을 수 없음`);
            return null;
        }
    } catch (error) {
        console.error('[Geocoding] 좌표 변환 중 오류:', error);
        return null;
    }
}

const userProfilePath = path.join(__dirname, 'user_profile.json');

// [새로운 도구 1] 사용자 정보를 파일에 저장하는 함수
async function saveUserProfile({ fact }) {
    console.log(`[Profile] 사용자 정보 저장 시도: ${fact}`);
    try {
        const fileContent = await fs.readFile(userProfilePath, 'utf-8');
        const profile = JSON.parse(fileContent);
        
        // 중복되는 사실이 없다면 추가
        if (!profile.facts.includes(fact)) {
            profile.facts.push(fact);
            await fs.writeFile(userProfilePath, JSON.stringify(profile, null, 2));
            console.log(`[Profile] 정보 저장 완료.`);
            return `${fact} 라는 정보를 당신에 대해 기억하겠습니다.`;
        } else {
            console.log(`[Profile] 이미 저장된 정보입니다.`);
            return `이미 알고 있는 내용입니다.`;
        }
    } catch (error) {
        console.error('[Profile] 프로필 저장 중 오류:', error);
        return '죄송합니다, 당신에 대한 정보를 저장하는 데 실패했습니다.';
    }
}

// [새로운 도구 2] 저장된 사용자 정보를 불러오는 함수
async function loadUserProfile() {
    console.log(`[Profile] 사용자 정보 불러오기 시도`);
    try {
        const fileContent = await fs.readFile(userProfilePath, 'utf-8');
        const profile = JSON.parse(fileContent);

        if (profile.facts.length > 0) {
            const factsString = profile.facts.join('\n- ');
            console.log(`[Profile] 정보 불러오기 완료.`);
            return `[기억하고 있는 당신에 대한 정보]\n- ${factsString}`;
        } else {
            console.log(`[Profile] 저장된 정보가 없습니다.`);
            return '아직 당신에 대해 기억하고 있는 정보가 없습니다.';
        }
    } catch (error) {
        console.error('[Profile] 프로필 불러오기 중 오류:', error);
        return '죄송합니다, 당신에 대한 정보를 불러오는 데 실패했습니다.';
    }
}

// [최종 업그레이드된 날씨 함수] 좌표를 기반으로 날씨를 조회
async function getWeather({ address }) {
    console.log(`[Function Executed] getWeather 실행됨, 원본 주소: ${address}`);
    
    // 1단계: 주소를 좌표로 변환
    const coordinates = await getCoordinates(address);
    if (!coordinates) {
        return `'${address}'의 위치를 찾을 수 없어 날씨 정보를 가져올 수 없습니다.`;
    }

    // 2단계: 변환된 좌표로 날씨 조회
    if (!OPENWEATHER_API_KEY) { /* ... */ return '날씨 기능 미설정'; }
    
    // OpenWeatherMap URL을 city 대신 lat/lon 기반으로 변경
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${coordinates.lat}&lon=${coordinates.lon}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=kr`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`날씨 API 요청 실패`);
        
        const data = await response.json();
        const description = data.weather[0].description;
        const temp = data.main.temp;
        const feels_like = data.main.feels_like;
        const humidity = data.main.humidity;
        const resultText = `[날씨 정보] 지역: ${address}, 날씨: ${description}, 기온: ${temp}°C, 체감온도: ${feels_like}°C, 습도: ${humidity}%`;
        console.log('[Weather] 날씨 정보 요약:', resultText);
        return resultText;
    } catch (error) {
        console.error('[Weather] 날씨 정보 조회 중 오류:', error);
        return `날씨 정보 조회 중 오류: ${error.message}`;
    }
}

// [수정된 부분 1] 먼저 searchWeb 함수를 정의합니다.
// 진짜 웹 검색 API를 호출하는 비동기(async) 함수입니다.
async function searchWeb({ query }) {
    console.log(`[Function Executed] searchWeb 실행됨, 검색어: ${query}`);
    
    // .env 파일에 SerpApi 키가 있는지 확인합니다.
    if (!SERPAPI_API_KEY) {
        console.error('[SerpApi] SERPAPI_API_KEY가 .env 파일에 설정되지 않았습니다.');
        return '웹 검색 기능이 설정되지 않았습니다. 서버 관리자에게 문의하세요.';
    }

    // SerpApi에 요청을 보낼 주소(URL)를 만듭니다.
    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERPAPI_API_KEY}`;

    try {
        // fetch를 사용해 SerpApi에 데이터를 요청합니다.
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`SerpApi 요청 실패: ${response.statusText}`);
        }
        
        // 응답받은 데이터를 JSON 형태로 변환합니다.
        const data = await response.json();

        // 검색 결과에서 가장 중요한 부분을 추출합니다.
        let resultText = "검색 결과를 찾았지만 요약할 만한 내용이 없습니다.";
        if (data.answer_box && data.answer_box.snippet) {
            resultText = data.answer_box.snippet;
        } else if (data.answer_box && data.answer_box.answer) {
             resultText = data.answer_box.answer;
        } else if (data.organic_results && data.organic_results[0] && data.organic_results[0].snippet) {
            resultText = data.organic_results[0].snippet;
        }
        
        console.log('[SerpApi] 검색 결과 요약:', resultText);
        return `[웹 검색 결과] ${resultText}`;

    } catch (error) {
        console.error('[SerpApi] 웹 검색 중 오류 발생:', error);
        return `웹 검색 중 오류가 발생했습니다: ${error.message}`;
    }
}

// [✅ 새로운 도구] URL에 접속해서 텍스트 내용을 긁어오는 함수
async function scrapeWebsite({ url }) {
    console.log(`[Web Scraper] 웹사이트 스크래핑 시도: ${url}`);
    try {
        // fetch를 사용해 해당 URL의 HTML 내용을 가져옵니다.
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`웹사이트에 접속할 수 없습니다 (${response.status})`);
        }
        const html = await response.text();

        // cheerio를 사용해 HTML을 로드하고, 텍스트만 추출합니다.
        const $ = cheerio.load(html);
        
        // 불필요한 태그(스크립트, 스타일)를 먼저 제거해서 정확도를 높입니다.
        $('script, style, noscript, iframe, header, footer, nav').remove();

        // 본문(body)의 텍스트를 가져옵니다.
        let bodyText = $('body').text();
        
        // 여러 줄바꿈과 공백을 정리해서 깔끔하게 만듭니다.
        bodyText = bodyText.replace(/\s\s+/g, ' ').trim();

        // 너무 긴 텍스트는 AI가 처리하기 어려우므로, 앞부분만 잘라냅니다. (예: 5000자)
        const maxLength = 5000;
        if (bodyText.length > maxLength) {
            bodyText = bodyText.substring(0, maxLength) + "... (내용이 너무 길어 일부만 표시)";
        }
        
        console.log(`[Web Scraper] 스크래핑 성공. (길이: ${bodyText.length})`);
        return `[웹사이트 내용: ${url}]\n\n${bodyText}`;

    } catch (error) {
        console.error('웹사이트 스크래핑 중 오류 발생:', error);
        return `죄송합니다, 해당 웹사이트('${url}')의 내용을 읽어오는 데 실패했습니다: ${error.message}`;
    }
}

app.post('/api/chat', async (req, res) => {
    // [기억력 기능 1] 요청에서 'chatId'를 받습니다. 없으면 null입니다.
    let { model: modelName, history, chatId, historyTokenLimit, systemPrompt, temperature, topP } = req.body;
    
    console.log(`[API] Chat request - Model: ${modelName}, ChatID: ${chatId || 'New Chat'}`);

    if (!GEMINI_API_KEY) {
        return res.status(400).json({ message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }
    if (!modelName || !Array.isArray(history)) {
        return res.status(400).json({ message: '모델과 올바른 형식의 대화 내용이 모두 필요합니다.' });
    }

    try {
        // [기억력 기능 2] chatId가 없으면 새로 만들고, 대화 파일을 저장할 경로를 지정합니다.
        if (!chatId) {
            chatId = uuidv4(); // 고유 ID 생성
            console.log(`[History] 새 대화를 시작합니다. ID 생성: ${chatId}`);
        }
        const chatFilePath = path.join(chatHistoriesDir, `${chatId}.json`);

        // [기억력 기능 3] 파일이 있으면 기존 대화 기록을 불러옵니다.
        let conversationHistory = [];
        try {
            await fs.access(chatFilePath);
            const fileContent = await fs.readFile(chatFilePath, 'utf-8');
            conversationHistory = JSON.parse(fileContent);
            console.log(`[History] ${chatId}.json 파일에서 ${conversationHistory.length}개의 메시지를 불러왔습니다.`);
        } catch (error) {
            // 파일이 없으면 그냥 비어있는 상태로 시작합니다 (오류가 아님).
            console.log(`[History] ${chatId}에 대한 기존 파일이 없습니다. 새 대화를 시작합니다.`);
        }
        
        // [기억력 기능 4] 클라이언트가 보낸 '새 메시지'만 기존 기록의 맨 뒤에 추가합니다.
        const newUserMessage = history.slice(-1)[0];
        if (newUserMessage) {
            conversationHistory.push(newUserMessage);
        }

        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        
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
            generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
            tools: [
              {
                functionDeclarations: [
                  {
                    name: 'getCurrentTime',
                    description: 'Get the current date and time.',
                    parameters: { type: 'object', properties: {} }
                  },
                  {
                    name: 'searchWeb',
                    description: 'Search the web for recent information, news, weather, etc.',
                    parameters: {
                      type: 'object',
                      properties: {
                        query: { type: 'string', description: 'The search query' }
                      },
                      required: ['query']
                    }
                  },
                  {
                      name: 'scrapeWebsite',
                      description: '사용자가 제공한 특정 URL(웹사이트 링크)의 내용을 읽고 분석하거나 요약해야 할 때 사용합니다.',
                      parameters: {
                          type: 'object',
                          properties: {
                              url: { type: 'string', description: '내용을 읽어올 정확한 웹사이트 주소 (URL). 예: "https://..."' }
                          },
                          required: ['url']
                      }
                  },
                  {
                    name: 'saveUserProfile',
                    description: '사용자가 자신에 대한 정보를 "기억해줘" 또는 "저장해줘" 라고 명시적으로 요청할 때 사용합니다.',
                    parameters: {
                        type: 'object',
                        properties: {
                            fact: { type: 'string', description: '기억해야 할 사용자에 대한 사실. 예: "나는 소고기를 좋아한다", "내 직업은 개발자다"' }
                        },
                        required: ['fact']
                    }
                },
                {
                    name: 'loadUserProfile',
                    description: '사용자가 "내가 누구인지 알아?", "나에 대해 아는 것 말해줘", "내가 어디 산다고 했지?" 와 같이 자신에 대해 AI가 기억하는 정보를 물어볼 때 사용합니다.',
                    parameters: { type: 'object', properties: {} } // 파라미터 없음
                },
                  {
                    name: 'getWeather',
                    description: '특정 주소나 지역의 정확한 실시간 날씨 정보를 가져옵니다. "창원시 성산구 상남동"처럼 아주 상세한 주소도 가능합니다.',
                    parameters: {
                        type: 'object',
                        properties: {
                            address: { type: 'string', description: '날씨를 조회할 전체 주소 또는 지역 이름. 예: "부산시 해운대구"' }
                        },
                        required: ['address']
                    }
                  }
                ]
              }
            ]
        });

        let historyForAI = [...conversationHistory];
        // 시스템 프롬프트는 대화 시작 시(파일이 없었을 때) 한 번만 적용
        if (systemPrompt && systemPrompt.trim() !== '' && conversationHistory.length === 1) {
            historyForAI.unshift(
                { role: 'user', parts: [{ type: 'text', text: systemPrompt }] },
                { role: 'model', parts: [{ type: 'text', text: '알겠습니다. 이제부터 당신의 지시에 따라 응답하겠습니다.' }] }
            );
        }
        
        const processedHistory = await processAttachmentsForAI(historyForAI);
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
        const functionCalls = response.functionCalls();
        
        let finalReply;

        if (functionCalls && functionCalls.length > 0) {
            console.log('[Function Calling] Model requested function calls:', functionCalls);

            const functionResponses = await Promise.all(
                functionCalls.map(async (call) => {
                    const { name, args } = call;
                    if (tools[name]) {
                        const functionResult = await tools[name](args);
                        return {
                            name: name,
                            response: {
                                name: name,
                                content: functionResult,
                            }
                        };
                    }
                    return null; // tool이 없는 경우 null 반환
                })
            );
            
            console.log('[Function Calling] Sending function results back to the model:', functionResponses.filter(Boolean));
            
            const secondResult = await chat.sendMessage([ { functionResponse: functionResponses.filter(Boolean)[0] } ]);
            const finalResponse = secondResult.response;
            finalReply = { type: 'text', text: finalResponse.text() };
        } else {
            finalReply = { type: 'text', text: response.text() };
        }

        // [기억력 기능 5] AI의 응답을 전체 대화 기록에 추가합니다.
        conversationHistory.push({ role: 'model', parts: [finalReply] });

        // [기억력 기능 6] 업데이트된 전체 대화 기록을 파일에 저장합니다.
        await fs.writeFile(chatFilePath, JSON.stringify(conversationHistory, null, 2));
        console.log(`[History] ${conversationHistory.length}개의 메시지를 ${chatId}.json 파일에 저장했습니다.`);

        // [기억력 기능 7] 클라이언트에게 AI의 답변과 함께, 앞으로 계속 사용할 'chatId'를 보내줍니다.
        res.json({ reply: finalReply, chatId: chatId, usage: response.usageMetadata });

        // [✅ 새로운 로직] 사용자의 마지막 메시지에서 URL을 자동으로 추출합니다.
        const lastUserText = newUserMessage.parts.find(p => p.type === 'text')?.text || '';
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const foundUrls = lastUserText.match(urlRegex);

        // 만약 URL이 발견되었고, 사용자가 명시적으로 분석을 요청하지 않았더라도,
        // AI가 스스로 판단할 수 있도록 대화 기록을 살짝 수정해줍니다.
        if (foundUrls && !lastUserText.includes('요약해줘') && !lastUserText.includes('설명해줘')) {
            const enrichedPrompt = {
                role: 'user',
                parts: [{ 
                    type: 'text', 
                    text: `${lastUserText}\n\n(시스템 노트: 위 메시지에 URL이 포함되어 있습니다. 필요하다면 'scrapeWebsite' 도구를 사용하여 해당 URL의 내용을 분석하고 답변하세요.)`
                }]
            };
            // 원래 메시지를 제거하고, 보강된 프롬프트로 교체
            conversationHistory.pop();
            conversationHistory.push(enrichedPrompt);
            console.log(`[Prompt Enhancer] URL을 감지하여 프롬프트를 보강했습니다.`);
        }


    } catch (error) {
        // [✅ 수정된 부분] 오류 메시지를 더 안전하게 만듭니다.
        console.error('채팅 API 오류:', error);

        // Gemini API가 보낸 구체적인 오류 정보가 있다면 그것을 사용하고,
        // 없다면 일반적인 오류 메시지를 사용합니다.
        const errorMessage = error.errorDetails 
            ? `Google API 오류: ${error.errorDetails[0]?.fieldViolations[0]?.description || error.message}`
            : `대화 생성 중 오류: ${error.message}`;

        // 특수 문자를 제거하여 marked.js 오류를 방지합니다.
        const sanitizedErrorMessage = errorMessage.replace(/[^\x20-\x7E]/g, '');

        res.status(500).json({ message: sanitizedErrorMessage });
    }
});

// [✅ 새로운 기능] 텍스트를 음성으로 변환하는 API 엔드포인트
app.post('/api/synthesize-speech', async (req, res) => {
    const { text } = req.body;
    if (!text) {
        return res.status(400).json({ message: '음성으로 변환할 텍스트가 필요합니다.' });
    }
    if (!GOOGLE_API_KEY) {
        return res.status(500).json({ message: 'Google API 키가 서버에 설정되지 않았습니다.' });
    }

    const GOOGLE_TTS_URL = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_API_KEY}`;

    try {
        const response = await fetch(GOOGLE_TTS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                input: { text: text },
                // WaveNet 기반의 자연스러운 한국어 여성 목소리
                voice: { languageCode: 'ko-KR', name: 'ko-KR-Wavenet-A' }, 
                audioConfig: { audioEncoding: 'MP3' }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('Google TTS API 오류:', errorData);
            throw new Error(`Google TTS API 요청 실패: ${response.statusText}`);
        }

        const data = await response.json();
        // data.audioContent는 Base64로 인코딩된 오디오 데이터입니다.
        // 우리는 이것을 클라이언트로 그대로 전달합니다.
        res.json({ audioContent: data.audioContent });

    } catch (error) {
        console.error('음성 합성 중 오류 발생:', error);
        res.status(500).json({ message: `음성 합성 중 오류: ${error.message}` });
    }
});

app.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`서버가 ${url} 에서 실행 중입니다.`);
  
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