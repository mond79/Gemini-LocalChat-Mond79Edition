// =========================================================================
// 이 코드 블록 전체를 복사해서,
// server.js 파일의 모든 내용을 완전히 덮어쓰세요.
// =========================================================================

require('dotenv').config();

// --- 1. 모든 모듈 불러오기 (파일 맨 위에서 한 번에!) ---
const fs = require('fs/promises');
const fsSync = require('fs');
const https = require('https'); 
const { v4: uuidv4 } = require('uuid');
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const { YoutubeTranscript } = require('youtube-transcript');
const { default: axios } = require('axios');
const mammoth = require("mammoth");
const XLSX = require('xlsx');
const { google } = require('googleapis');
const { formatISO, addDays, startOfDay, endOfDay } = require('date-fns');

// --- 2. 전역 변수 및 상수 설정 ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const KAKAO_API_KEY = process.env.KAKAO_API_KEY; 
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/oauth2callback';

// [✅ 새로운 부분] Google OAuth2 클라이언트 생성
const oAuth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI
);

const TOKEN_PATH = path.join(__dirname, 'token.json'); // 토큰을 저장할 파일 경로

const app = express();
const port = 3333;
const chatHistoriesDir = path.join(__dirname, 'chat_histories');
const userProfilePath = path.join(__dirname, 'user_profile.json');

// --- 3. 모든 도구(Tool) 함수 정의 ---

// [도구 1] 시간 확인
function getCurrentTime() {
    const now = new Date();
    console.log('[Function Executed] getCurrentTime 실행됨');
    const options = {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
        timeZone: 'Asia/Seoul'
    };
    return now.toLocaleString('ko-KR', options);
}

// [도구 2] 웹 검색
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

// [도구 3] 좌표 변환
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

// [도구 4] 날씨 확인
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

// [도구 5] 웹사이트 스크래핑
async function scrapeWebsite({ url }) {
    console.log(`[Puppeteer] 웹사이트 스크래핑 시도: ${url}`);
    let browser = null;
    try {
        browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36');
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // [✅ 최종 수정] 페이지에서 '핵심 정보'만 골라서 추출합니다.
        const pageContent = await page.evaluate(() => {
            // 유튜브 영상 제목을 가져옵니다. (선택자 ID: #title h1)
            const title = document.querySelector('#title h1')?.innerText || '';
            
            // 영상 설명 글을 가져옵니다. (선택자 ID: #description-inline-expander)
            const description = document.querySelector('#description-inline-expander')?.innerText || '';
            
            // 만약 위 선택자로 못 찾으면, 일반적인 웹페이지라고 가정하고 body 전체 텍스트를 가져옵니다.
            if (!title && !description) {
                document.querySelectorAll('script, style, noscript, iframe, header, footer, nav').forEach(el => el.remove());
                return document.body.innerText;
            }

            // 제목과 설명을 합쳐서 반환합니다.
            return `제목: ${title}\n\n설명: ${description}`;
        });
        
        const cleanedText = pageContent.replace(/\s\s+/g, ' ').trim();
        const maxLength = 4000; // 길이를 조금 더 줄여서 AI의 부담을 덜어줍니다.
        let summaryText = cleanedText;
        if (cleanedText.length > maxLength) {
            summaryText = cleanedText.substring(0, maxLength) + "... (내용이 너무 길어 일부만 표시)";
        }
        
        console.log(`[Puppeteer] 스크래핑 성공. (정제된 길이: ${summaryText.length})`);
        return `[웹사이트 내용: ${url}]\n\n${summaryText}`;

    } catch (error) {
        console.error('Puppeteer 스크래핑 중 오류 발생:', error);
        return `죄송합니다, 해당 웹사이트('${url}')의 내용을 읽어오는 데 실패했습니다: ${error.message}`;
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// [도구 6] 유튜브 스크립트 추출
async function getYoutubeTranscript({ url }) {
    console.log(`[YouTube] 스크립트 추출 시도: ${url}`);
    try {
        // [✅ 수정] 쿠키 동의 문제를 우회하기 위한 사전 작업
        // 1. 먼저 axios를 사용해 유튜브 페이지에 접속하여 쿠키를 얻어옵니다.
        const initialResponse = await axios.get(url, {
            headers: {
                // 실제 브라우저인 것처럼 위장합니다.
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36'
            }
        });

        // 2. 응답 헤더에서 'set-cookie' 값을 추출합니다.
        const cookies = initialResponse.headers['set-cookie']?.join('; ');

        // [✅ 수정] YoutubeTranscript.fetchTranscript를 호출할 때, 얻어온 쿠키를 함께 전달합니다.
        const transcript = await YoutubeTranscript.fetchTranscript(url, {
            lang: 'ko', // 한국어 자막을 우선적으로 찾도록 설정
            fetchOptions: {
                headers: {
                    'Cookie': cookies
                }
            }
        });

        if (!transcript || transcript.length === 0) {
            return "죄송합니다, 이 영상의 자막을 찾을 수 없습니다. (자동 생성 자막이 없거나, 자막 기능이 비활성화된 영상일 수 있습니다.)";
        }

        const fullText = transcript.map(item => item.text).join(' ');
        const maxLength = 8000;
        let summaryText = fullText;
        if (fullText.length > maxLength) {
            summaryText = fullText.substring(0, maxLength) + "... (영상이 너무 길어 일부 스크립트만 표시)";
        }

        console.log(`[YouTube] 스크립트 추출 성공. (길이: ${summaryText.length})`);
        return `[유튜브 영상 스크립트: ${url}]\n\n${summaryText}`;

    } catch (error) {
        console.error('유튜브 스크립트 추출 중 오류 발생:', error);
        // 라이브러리가 던지는 오류 메시지를 좀 더 구체적으로 보여줍니다.
        if (error.message.includes('subtitles are disabled')) {
            return `죄송합니다, 이 영상은 자막 기능이 비활성화되어 있습니다.`;
        }
        if (error.message.includes('No transcripts')) {
            return `죄송합니다, 이 영상에서 사용 가능한 자막을 찾지 못했습니다.`;
        }
        return `죄송합니다, 해당 유튜브 영상('${url}')의 스크립트를 가져오는 데 실패했습니다: ${error.message}`;
    }
}

// [도구 7 & 8] 사용자 프로필 저장/불러오기
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

// 모델 목록을 가져오는 헬퍼 함수
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

// 토큰 제한에 맞춰 대화 기록을 잘라내는 헬퍼 함수
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

// PDF 같은 첨부파일을 AI가 이해할 텍스트로 변환하는 헬퍼 함수
async function processAttachmentsForAI(history) {
    return Promise.all(history.map(async (message) => {
        if (message.role !== 'user') return message;

        const newParts = await Promise.all(message.parts.map(async (part) => {
            if (part.type === 'code-summary' && part.summary) {
                const { filename, fullCode } = part.summary;
                return { type: 'text', text: `--- START OF FILE: ${filename} ---\n\n${fullCode}\n\n--- END OF FILE: ---` };
            } 
            else if (part.type === 'pdf-attachment') {
                try {
                    console.log(`[Attachment Processor] PDF 처리 중: ${part.name}`);
                    const buffer = Buffer.from(part.data.split(',')[1], 'base64');
                    const data = await pdf(buffer);
                    return { type: 'text', text: `--- START OF DOCUMENT (PDF): ${part.name} ---\n\n${data.text}\n\n--- END OF DOCUMENT ---` };
                } catch (error) {
                    console.error('서버 측 PDF 처리 오류:', error);
                    return { type: 'text', text: `[PDF 처리 실패: ${error.message}]` };
                }
            }
            // ==========================================================
            // [✅ 여기가 바로 '.docx' 오류를 해결하는 핵심 로직입니다!]
            // ==========================================================
            else if (part.type === 'docx-attachment') {
                try {
                    console.log(`[Attachment Processor] DOCX 처리 중: ${part.name}`);
                    
                    // 1. 클라이언트가 보낸 Base64 데이터 URL에서 순수 Base64 데이터만 추출합니다.
                    const base64Data = part.data.split(',')[1];
                    
                    // 2. Base64 데이터를 Node.js의 'Buffer' 객체로 변환합니다.
                    //    이것이 mammoth가 필요로 하는 형식입니다.
                    const buffer = Buffer.from(base64Data, 'base64');
                    
                    // 3. mammoth에게 Buffer 객체를 전달하여 텍스트를 추출합니다.
                    const result = await mammoth.extractRawText({ buffer: buffer });
                    const text = result.value;
                    
                    return { type: 'text', text: `--- START OF DOCUMENT (DOCX): ${part.name} ---\n\n${text}\n\n--- END OF DOCUMENT ---` };
                } catch (error) {
                    console.error('서버 측 DOCX 처리 오류:', error);
                    // mammoth 라이브러리가 zip 오류를 발생시키는 바로 그 지점입니다.
                    // 오류 메시지를 사용자에게 보여주는 것이 좋습니다.
                    return { type: 'text', text: `[DOCX 처리 실패: ${error.message}]` };
                }
            }
            
            // ==========================================================
            // 새로운 Excel (.xlsx, .xls) 파일 처리 로직
            // ==========================================================
            else if (part.type === 'xlsx-attachment') {
                try {
                    console.log(`[Attachment Processor] XLSX 처리 중: ${part.name}`);
                    const buffer = Buffer.from(part.data.split(',')[1], 'base64');

                    // 1. xlsx 라이브러리로 버퍼 데이터를 읽습니다.
                    const workbook = XLSX.read(buffer, {type: 'buffer'});
                    let fullTextContent = '';

                    // 2. 엑셀 파일의 모든 시트(Sheet)를 순회합니다.
                    workbook.SheetNames.forEach(sheetName => {
                        fullTextContent += `--- SHEET: ${sheetName} ---\n`;
                        const worksheet = workbook.Sheets[sheetName];
                        
                        // 3. 시트의 데이터를 JSON 객체 배열로 변환합니다.
                        const jsonData = XLSX.utils.sheet_to_json(worksheet);

                        // 4. JSON 데이터를 AI가 이해하기 쉬운 텍스트 형식(CSV와 유사)으로 변환합니다.
                        if (jsonData.length > 0) {
                            const headers = Object.keys(jsonData[0]);
                            fullTextContent += headers.join(', ') + '\n';
                            jsonData.forEach(row => {
                                const values = headers.map(header => row[header]);
                                fullTextContent += values.join(', ') + '\n';
                            });
                        }
                        fullTextContent += '\n';
                    });

                    return { type: 'text', text: `--- START OF SPREADSHEET (XLSX): ${part.name} ---\n\n${fullTextContent}\n--- END OF SPREADSHEET ---` };
                } catch (error) {
                    console.error('서버 측 XLSX 처리 오류:', error);
                    return { type: 'text', text: `[XLSX 처리 실패: ${error.message}]` };
                }
            }
            // ==========================================================
            // 그 외 다른 타입의 part는 그대로 반환합니다 (이미지, 오디오 등).
            return part;
        }));

        // 이 아래의 텍스트 파트 병합 로직은 기존과 동일합니다.
        const textParts = newParts.filter(p => p.type === 'text');
        const otherParts = newParts.filter(p => p.type !== 'text' || (p.type === 'text' && !p.text)); // 텍스트지만 내용이 없는 경우도 제외
        
        if (textParts.length > 0) {
            const combinedText = textParts.map(p => p.text).join('\n\n');
            const existingTextPart = otherParts.find(p => p.type === 'text');
            if (existingTextPart) {
                existingTextPart.text = (existingTextPart.text ? existingTextPart.text + '\n\n' : '') + combinedText;
            } else {
                otherParts.push({ type: 'text', text: combinedText });
            }
        }
        return { ...message, parts: otherParts };
    }));
}

// 대화 기록을 Google AI API 형식에 맞게 변환하는 헬퍼 함수
function formatHistoryForGoogleAI(history) {
    return history.map(msg => ({
        role: msg.role === 'system' ? 'user' : msg.role,
        parts: msg.parts
            .map(part => {
                if (part.type === 'text') {
                    return { text: part.text };
                }
                if (part.type === 'image' || part.type === 'audio') {
                    if (part.data && part.data.startsWith('data:')) {
                        const base64Data = part.data.split(',')[1] || '';
                        try {
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
                            return null;
                        }
                    }
                    return null;
                }
                return null;
            })
            .filter(Boolean)
    })).filter(msg => msg.parts.length > 0);
}

// [도구 9] 음악 분석 (파이썬 서버 호출) - 현재는 비활성화
// async function analyzeMusic(...) { /* ... */ }

async function authorize() {
    try {
        const tokenContent = await fs.readFile(TOKEN_PATH, 'utf-8');
        const tokens = JSON.parse(tokenContent);
        oAuth2Client.setCredentials(tokens);
        
        // 토큰이 만료되었는지 확인하고, 만료되었다면 새로고침
        if (oAuth2Client.isTokenExpiring()) {
            console.log('[Auth] 액세스 토큰이 만료되어 새로고침합니다...');
            const { credentials } = await oAuth2Client.refreshAccessToken();
            oAuth2Client.setCredentials(credentials);
            await fs.writeFile(TOKEN_PATH, JSON.stringify(credentials));
            console.log('[Auth] 새로고침된 토큰을 token.json에 저장했습니다.');
        }
        return oAuth2Client; // 인증된 클라이언트를 반환
    } catch (error) {
        // token.json 파일이 없거나 문제가 있으면 null 반환
        return null;
    }
}

// 캘린더 일정 조회
async function getCalendarEvents({ timeMin, timeMax }) {
    const auth = await authorize();
    if (!auth) {
        return "[AUTH_REQUIRED]Google 캘린더 인증이 필요합니다..."; // 인증이 안되어 있으면 다시 인증 신호 보냄
    }
    const calendar = google.calendar({ version: 'v3', auth });
    try {
        const res = await calendar.events.list({
            calendarId: 'primary',
            timeMin: timeMin || (new Date()).toISOString(),
            timeMax: timeMax,
            maxResults: 10,
            singleEvents: true,
            orderBy: 'startTime',
        });

        const events = res.data.items;
        if (!events || events.length === 0) {
            return '해당 기간에 예정된 이벤트가 없습니다.';
        }
        const eventList = events.map(event => {
            const start = event.start.dateTime || event.start.date;
            return `- ${event.summary} (시작: ${new Date(start).toLocaleString('ko-KR')})`;
        }).join('\n');
        return `[캘린더 조회 결과]\n${eventList}`;
    } catch (err) {
        return `캘린더 API 오류가 발생했습니다: ${err.message}`;
    }
}

// 캘린더 일정 생성
async function createCalendarEvent({ summary, description, startDateTime, endDateTime }) {
    console.log('[Calendar] 일정 생성 도구 시작. 입력:', { summary, startDateTime, endDateTime });

    const auth = await authorize();
    if (!auth) {
        console.log('[Calendar] 인증 실패. 인증 필요 신호 반환.');
        return "[AUTH_REQUIRED]Google 캘린더 인증이 필요합니다...";
    }

    const calendar = google.calendar({ version: 'v3', auth });
    
    try {
        const event = {
            summary: summary,
            description: description || `AI 비서를 통해 생성된 일정입니다.`,
            start: { 
                dateTime: startDateTime, 
                timeZone: 'Asia/Seoul' // 한국 시간 기준
            },
            end: { 
                dateTime: endDateTime, 
                timeZone: 'Asia/Seoul' // 한국 시간 기준
            },
        };

        console.log('[Calendar] Google에 보낼 이벤트 객체:', event);
        console.log('[Calendar] Google Calendar API에 일정 생성을 요청합니다... (여기서 멈추면 Google과의 통신 문제)');

        // 바로 이 부분이 실제 통신이 일어나는 곳입니다.
        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });

        console.log('[Calendar] Google로부터 응답을 받았습니다! 상태:', res.status);

        // 성공적으로 응답을 받았다면, 결과 링크를 로그에 찍어봅니다.
        if (res.data && res.data.htmlLink) {
            console.log('[Calendar] 생성된 이벤트 링크:', res.data.htmlLink);
        }

        return `성공적으로 '${summary}' 일정을 캘린더에 추가했습니다. (시작: ${new Date(startDateTime).toLocaleString('ko-KR')})`;

    } catch (err) {
        // [✅ 중요!] 구글 서버가 보낸 실제 오류 메시지를 자세히 출력합니다.
        console.error('!!!!!!!!!!! Google Calendar API 오류 발생 !!!!!!!!!!!');
        if (err.response) {
            console.error('상태 코드:', err.response.status);
            console.error('오류 데이터:', JSON.stringify(err.response.data, null, 2));
        } else {
            console.error('일반 오류 메시지:', err.message);
        }
        console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');

        return `캘린더에 일정을 추가하는 중 오류가 발생했습니다: ${err.response?.data?.error?.message || err.message}`;
    }
}

// ['안내' 도구]
function authorizeCalendar() {
    // 이 함수는 실제 작업을 하지 않고, 클라이언트에게 인증 창을 열라는 '신호'만 보냅니다.
    return "[AUTH_REQUIRED]Google 캘린더 인증이 필요합니다. 사용자를 /authorize 경로로 보내주세요.";
}

// [자연어를 ISO 날짜/시간으로 변환하는 전문가
function convertNaturalDateToISO({ period }) {
    console.log(`[Date Converter] 기간 변환 시도: ${period}`);
    const now = new Date();
    let start, end;

    if (period.includes('오늘')) {
        start = startOfDay(now);
        end = endOfDay(now);
    } else if (period.includes('내일')) {
        const tomorrow = addDays(now, 1);
        start = startOfDay(tomorrow);
        end = endOfDay(tomorrow);
    } else {
        // 더 다양한 경우를 추가할 수 있습니다 (예: "이번 주")
        return `오류: '${period}'는 이해할 수 없는 기간입니다. '오늘' 또는 '내일'을 사용해주세요.`;
    }

    // 결과를 JSON 문자열로 반환하여, AI가 이 결과를 다른 도구의 입력으로 쉽게 사용할 수 있도록 함
    const result = {
        timeMin: formatISO(start),
        timeMax: formatISO(end)
    };
    console.log(`[Date Converter] 변환 결과:`, result);
    return JSON.stringify(result);
}

// --- 4. 도구 목록(tools 객체) 생성 ---
const tools = {
  getCurrentTime,
  searchWeb,
  getWeather,
  scrapeWebsite,
  getYoutubeTranscript,
  authorizeCalendar,
  saveUserProfile,
  loadUserProfile,
  getCalendarEvents,    
  createCalendarEvent
  // analyzeMusic, // <-- 이 기능은 파이썬 서버를 켜야 하므로 일단 주석 처리
};

// --- 5. 미들웨어 설정 ---
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- 6. API 엔드포인트(경로) 정의 ---

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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

app.post('/api/validate', async (req, res) => {
    if (!GEMINI_API_KEY) return res.status(400).json({ valid: false, message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    try {
        await fetchAvailableModels(GEMINI_API_KEY);
        res.json({ valid: true, message: '서버의 API 키가 유효합니다.' });
    } catch (error) {
        res.status(400).json({ valid: false, message: `API 키 검증 실패: ${error.message}` });
    }
});
// ... (validate, extract-text 등 다른 API 경로들)

// [메인 채팅 API]
app.post('/api/chat', async (req, res) => {
    let { model: modelName, history, chatId, historyTokenLimit, systemPrompt, temperature, topP } = req.body;
    
    console.log(`[API] Chat request - Model: ${modelName}, ChatID: ${chatId || 'New Chat'}`);

    if (!GEMINI_API_KEY) {
        return res.status(400).json({ message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }
    if (!modelName || !Array.isArray(history)) {
        return res.status(400).json({ message: '모델과 올바른 형식의 대화 내용이 모두 필요합니다.' });
    }

    try {
        if (!chatId) {
            chatId = uuidv4();
            console.log(`[History] 새 대화를 시작합니다. ID 생성: ${chatId}`);
        }
        const chatFilePath = path.join(chatHistoriesDir, `${chatId}.json`);

        let conversationHistory = [];
        try {
            await fs.access(chatFilePath);
            const fileContent = await fs.readFile(chatFilePath, 'utf-8');
            conversationHistory = JSON.parse(fileContent);
            console.log(`[History] ${chatId}.json 파일에서 ${conversationHistory.length}개의 메시지를 불러왔습니다.`);
        } catch (error) {
            console.log(`[History] ${chatId}에 대한 기존 파일이 없습니다. 새 대화를 시작합니다.`);
        }
        
        const newUserMessage = history.slice(-1)[0];
        if (newUserMessage) {
            conversationHistory.push(newUserMessage);
        }

        if (newUserMessage && newUserMessage.role === 'user') {
            const lastUserText = newUserMessage.parts.find(p => p.type === 'text')?.text || '';
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const foundUrls = lastUserText.match(urlRegex);

            if (foundUrls) {
                const firstUrl = foundUrls[0];
                let systemNote = '';

                if (firstUrl.includes('youtube.com') || firstUrl.includes('youtu.be')) {
                    systemNote = `(시스템 노트: 위 메시지에 YouTube URL이 포함되어 있습니다. 내용을 파악하려면 'getYoutubeTranscript' 도구를 사용하세요.)`;
                } else {
                    systemNote = `(시스템 노트: 위 메시지에 URL이 포함되어 있습니다. 내용을 파악하려면 'scrapeWebsite' 도구를 사용하세요.)`;
                }

                const enrichedPromptPart = { type: 'text', text: `${lastUserText}\n\n${systemNote}` };
                const originalParts = newUserMessage.parts.filter(p => p.type !== 'text');
                conversationHistory[conversationHistory.length - 1].parts = [...originalParts, enrichedPromptPart];
                
                console.log(`[Prompt Enhancer] URL을 감지하여 프롬프트를 보강했습니다.`);
            }
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
                  { name: 'getCurrentTime', description: 'Get the current date and time.', parameters: { type: 'object', properties: {} } },
                  { name: 'searchWeb', description: 'Search the web for recent information, news, weather, etc.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] } },
                  { name: 'scrapeWebsite', description: '사용자가 제공한 특정 URL(웹사이트 링크)의 내용을 읽고 분석하거나 요약해야 할 때 사용합니다.', parameters: { type: 'object', properties: { url: { type: 'string', description: '내용을 읽어올 정확한 웹사이트 주소 (URL). 예: "https://..."' } }, required: ['url'] } },
                  { name: 'getYoutubeTranscript', description: '사용자가 "youtube.com" 또는 "youtu.be" 링크를 제공하며 영상의 내용을 요약하거나 분석해달라고 요청할 때 사용합니다.', parameters: { type: 'object', properties: { url: { type: 'string', description: '스크립트를 추출할 정확한 유튜브 영상 주소 (URL)' } }, required: ['url'] } },
                  { name: 'saveUserProfile', description: '사용자가 자신에 대한 정보를 "기억해줘" 또는 "저장해줘" 라고 명시적으로 요청할 때 사용합니다.', parameters: { type: 'object', properties: { fact: { type: 'string', description: '기억해야 할 사용자에 대한 사실. 예: "나는 소고기를 좋아한다", "내 직업은 개발자다"' } }, required: ['fact'] } },
                  { name: 'loadUserProfile', description: '사용자가 "내가 누구인지 알아?", "나에 대해 아는 것 말해줘", "내가 어디 산다고 했지?" 와 같이 자신에 대해 AI가 기억하는 정보를 물어볼 때 사용합니다.', parameters: { type: 'object', properties: {} } },
                  { name: 'getWeather', description: '특정 주소나 지역의 정확한 실시간 날씨 정보를 가져옵니다. "창원시 성산구 상남동"처럼 아주 상세한 주소도 가능합니다.', parameters: { type: 'object', properties: { address: { type: 'string', description: '날씨를 조회할 전체 주소 또는 지역 이름. 예: "부산시 해운대구"' } }, required: ['address'] } },
                  { name: 'authorizeCalendar', description: '사용자가 "캘린더 연동", "구글 계정 연결" 등 처음으로 캘린더 관련 작업을 요청했지만, 아직 인증되지 않았을 때 사용합니다.', parameters: { type: 'object', properties: {} } },
                  { name: 'getCalendarEvents', description: '사용자의 구글 캘린더에서 특정 기간의 일정을 조회할 때 사용합니다. "오늘 내 일정 뭐야?", "내일 약속 있어?" 와 같은 질문에 사용됩니다.', parameters: { type: 'object', properties: {
                          timeMin: { type: 'string', description: '조회 시작 시간 (ISO 8601 형식). 지정하지 않으면 현재 시간부터 조회. 예: 2025-10-12T00:00:00Z' },
                          timeMax: { type: 'string', description: '조회 종료 시간 (ISO 8601 형식). 예: 2025-10-12T23:59:59Z' } }, required: [] } },
                { name: 'createCalendarEvent', description: '사용자의 구글 캘린더에 새로운 일정을 추가할 때 사용합니다. "내일 3시에 미팅 잡아줘" 와 같은 요청에 사용됩니다.', parameters: { type: 'object',properties: {
                          summary: { type: 'string', description: '이벤트의 제목. 예: "팀 프로젝트 미팅"' },
                          description: { type: 'string', description: '이벤트에 대한 상세 설명 (선택 사항)' },
                          startDateTime: { type: 'string', description: '이벤트 시작 시간 (ISO 8601 형식). 예: 2025-10-12T15:00:00' },
                          endDateTime: { type: 'string', description: '이벤트 종료 시간 (ISO 8601 형식). 예: 2025-10-12T16:00:00' } }, required: ['summary', 'startDateTime', 'endDateTime'] } },
                  { name: 'convertNaturalDateToISO', description: '사용자가 "오늘", "내일"과 같은 자연어로 기간을 언급했을 때, 그 기간을 다른 도구(예: getCalendarEvents)가 사용할 수 있는 정확한 ISO 8601 형식의 timeMin과 timeMax로 변환합니다.', parameters: { type: 'object', properties: { period: { type: 'string', description: '변환할 자연어 기간. 예: "오늘", "내일"' } }, required: ['period'] } }
                ]
              }
            ]
        });

        let historyForAI = [...conversationHistory];

        // [✅ 최종 수정] AI에게 모든 도구의 존재를 명확하게 각인시키는 시스템 프롬프트
        const toolsSystemPrompt = `
You are an AI assistant with access to a suite of tools. When a user asks a question, first determine if any of your tools can help.

Available Tools:
- getCurrentTime(): Get the current date and time. Use for questions about "지금 시간", "오늘 날짜".
- searchWeb({query}): Search the web. Use for news, general knowledge, etc.
- scrapeWebsite({url}): Read the content of a specific webpage URL. Use when a URL is provided.
- getYoutubeTranscript({url}): Get the transcript of a YouTube video. Use for YouTube URLs.
- saveUserProfile({fact}): Save a fact about the user. Use when the user says "기억해줘".
- loadUserProfile(): Load saved facts about the user. Use when the user asks "내가 누구야?", "나에 대해 아는 것".
- getCalendarEvents({timeMin, timeMax}): Get events from the user's Google Calendar. Use for questions about "일정", "약속", "캘린더".
- createCalendarEvent({summary, startDateTime, endDateTime}): Create a new event in the user's Google Calendar. Use for requests to "일정 추가", "약속 잡아줘".
- authorizeCalendar(): Start the Google Calendar authorization process if not already authenticated. Use when calendar tools fail due to authentication.
- "If a user asks for calendar events using natural language like "today" or "tomorrow", you MUST first call convertNaturalDateToISO to get the correct timeMin and timeMax, and then use that result to call getCalendarEvents."

Analyze the user's request and call the most appropriate tool with the correct parameters. If no tool is suitable, answer directly.
        `;

        // 기존의 사용자 시스템 프롬프트와, 우리가 만든 '도구 시스템 프롬프트'를 합칩니다.
        const combinedSystemPrompt = (systemPrompt && systemPrompt.trim() !== '') 
            ? `${systemPrompt}\n\n---\n\n${toolsSystemPrompt}`
            : toolsSystemPrompt;

        // 시스템 프롬프트는 항상 대화의 맨 처음에 위치해야 합니다.
        if (conversationHistory.length === 1) { // 새 대화일 때만
             historyForAI.unshift(
                { role: 'user', parts: [{ type: 'text', text: combinedSystemPrompt }] },
                { role: 'model', parts: [{ type: 'text', text: '알겠습니다. 당신의 지시에 따라, 제공된 도구들을 활용하여 최선을 다해 돕겠습니다.' }] }
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
        
        // [✅ 수정] 토큰 사용량 계산을 위해 변수 선언
        let totalTokenCount = 0;
        
        const result = await chat.sendMessage(userMessageParts);

        // [✅ 수정] 첫 번째 API 호출의 토큰 사용량 추가
        totalTokenCount += result.response?.usageMetadata?.totalTokenCount || 0;

        const response = result.response;
        const functionCalls = response.functionCalls();
        
        let finalReply;

        if (functionCalls && functionCalls.length > 0) {
            console.log('[Function Calling] Model requested function calls:', functionCalls);

            const functionCall = functionCalls[0];
            const { name, args } = functionCall;

            if (tools[name]) {
                let functionResult = await tools[name](args);

                if (name === 'getYoutubeTranscript' && functionResult.includes('자막을 찾을 수 없습니다')) {
                    console.log(`[Fallback] 유튜브 스크립트 실패. 웹 스크래핑으로 재시도...`);
                    functionResult = await tools['scrapeWebsite'](args);
                }
                
                const functionResponse = { name: name, response: { name: name, content: functionResult } };

                console.log('[Function Calling] Sending function results back to the model:', functionResponse);
                
                const secondResult = await chat.sendMessage([ { functionResponse: functionResponse } ]);
                finalReply = { type: 'text', text: secondResult.response.text() };

                // [✅ 수정] 두 번째 API 호출의 토큰 사용량 추가
                totalTokenCount += secondResult.response?.usageMetadata?.totalTokenCount || 0;

            } else {
                console.warn(`[Function Calling] 알 수 없는 도구 호출: ${name}`);
                finalReply = { type: 'text', text: `오류: 알 수 없는 도구 '${name}'를 호출했습니다.` };
            }

        } else {
            finalReply = { type: 'text', text: response.text() };
        }

        conversationHistory.push({ role: 'model', parts: [finalReply] });

        await fs.writeFile(chatFilePath, JSON.stringify(conversationHistory, null, 2));
        console.log(`[History] ${conversationHistory.length}개의 메시지를 ${chatId}.json 파일에 저장했습니다.`);

        console.log(`[API] Total tokens used: ${totalTokenCount}`);

        // [✅ 최종 수정] 클라이언트에 응답할 때 totalTokenCount를 포함합니다.
        const usageMetadata = response?.usageMetadata || { totalTokenCount: totalTokenCount || 0 };

        // [기억력 기능 7] 클라이언트에게 AI의 답변과 함께, 앞으로 계속 사용할 'chatId'를 보내줍니다.
        res.json({ 
            reply: finalReply, 
            chatId: chatId, 
            usage: usageMetadata // <-- 안전하게 처리된 usageMetadata를 사용
        });

    } catch (error) {
        console.error('채팅 API 오류:', error);

        // [✅ 최종 수정] 어떤 종류의 오류 객체든 안전하게 처리합니다.
        let errorMessage = `대화 생성 중 오류: ${error.message}`;
        if (error.errorDetails && Array.isArray(error.errorDetails)) {
            // fieldViolations가 있는 상세 오류
            const violation = error.errorDetails.find(d => d.fieldViolations)?.fieldViolations[0];
            if (violation) {
                errorMessage = `Google API 오류: ${violation.description}`;
            }
            // violations가 있는 할당량 오류
            const quotaViolation = error.errorDetails.find(d => d.violations)?.violations[0];
            if (quotaViolation) {
                errorMessage = `Google API 할당량 초과: ${quotaViolation.description || '요청 한도를 초과했습니다. 잠시 후에 다시 시도해주세요.'}`;
            }
        }

        // 특수 문자를 제거하여 클라이언트 오류를 방지
        const sanitizedErrorMessage = errorMessage.replace(/[^\x20-\x7E\w\sㄱ-ㅎㅏ-ㅣ가-힣.:,()]/g, '');

        res.status(500).json({ message: sanitizedErrorMessage });
    }
});

// 인증 시작 (Python의 /authorize 역할)
app.get('/authorize', (req, res) => {
    // 사용자가 구글에 로그인하고, 우리 앱에 캘린더 접근 권한을 주도록 요청하는 URL 생성
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.events'] // 업무 범위
    });
    // 사용자를 생성된 URL로 보냅니다.
    res.redirect(authUrl);
});

// 인증 후 콜백 (Python의 /oauth2callback 역할)
app.get('/oauth2callback', async (req, res) => {
    const code = req.query.code; // 구글이 보내준 '임시 출입증(code)'
    if (!code) {
        return res.status(400).send('인증 코드가 없습니다.');
    }
    try {
        // 임시 출입증을 진짜 '단골 카드(토큰)'로 교환
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);

        // 발급받은 토큰을 나중에도 쓸 수 있도록 token.json 파일에 저장
        await fs.writeFile(TOKEN_PATH, JSON.stringify(tokens));
        console.log('[Auth] 토큰이 token.json 파일에 성공적으로 저장되었습니다.');
        
        // 모든 과정이 끝났으니, 사용자에게 성공 메시지를 보여주고 창을 닫게 함
        res.send('<script>window.close();</script><h2>인증에 성공했습니다! 이 창을 닫아주세요.</h2>');

    } catch (error) {
        console.error('[Auth] 토큰 교환 중 오류 발생:', error);
        res.status(500).send('인증에 실패했습니다.');
    }
});

// [TTS API]
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


// --- 7. 서버 실행 (가장 마지막에!) ---
try {
    const key = fsSync.readFileSync('localhost-key.pem');
    const cert = fsSync.readFileSync('localhost.pem');
    https.createServer({ key, cert }, app).listen(port, () => {
        const url = `https://localhost:${port}`;
        console.log(`서버가 ${url} 에서 실행 중입니다.`);
        const start = process.platform === 'darwin' ? 'open' : 'win32' ? 'start' : 'xdg-open';
        exec(`${start} ${url}`);
    });
} catch (e) {
    console.error('HTTPS 서버 실행 실패. 인증서 파일을 확인하세요. HTTP로 대신 실행합니다.');
    app.listen(port, () => {
        const url = `http://localhost:${port}`;
        console.log(`[폴백 모드] 서버가 ${url} 에서 실행 중입니다.`);
        const start = process.platform === 'darwin' ? 'open' : 'win32' ? 'start' : 'xdg-open';
        exec(`${start} ${url}`);
    });
}