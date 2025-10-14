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
const pendingConfirmations = {};
const port = 3333;
const chatHistoriesDir = path.join(__dirname, 'chat_histories');
const userProfilePath = path.join(__dirname, 'user_profile.json');

// [✅ 수정] --- 데이터 익명화 설정 시작 ---
const ANONYMIZATION_ENABLED = true; // 이 기능을 켜고 끌 수 있는 스위치

// .env 파일에서 민감한 키워드 목록을 문자열로 불러온 뒤, 쉼표(,)를 기준으로 잘라 배열로 만듭니다.
// 만약 .env 파일에 해당 항목이 없으면, 빈 배열로 안전하게 초기화합니다.
const SENSITIVE_KEYWORDS = process.env.SENSITIVE_KEYWORDS 
    ? process.env.SENSITIVE_KEYWORDS.split(',') 
    : [];

const anonymizationMap = new Map(); // 원본 <-> 코드명 변환 기록을 저장할 맵
// --- 데이터 익명화 설정 끝 ---

// 프롬프트 변조' 헬퍼 함수

function anonymizeText(text) {
    if (!ANONYMIZATION_ENABLED) return text;

    let anonymizedText = text;
    for (const keyword of SENSITIVE_KEYWORDS) {
        // text 안에 키워드가 포함되어 있는지 확인
        if (anonymizedText.includes(keyword)) {
            let codeName = anonymizationMap.get(keyword);
            // 이 키워드에 대한 코드명이 아직 없으면 새로 생성
            if (!codeName) {
                codeName = `[KEYWORD_${anonymizationMap.size + 1}]`;
                anonymizationMap.set(keyword, codeName); // 원본 -> 코드명 저장
                anonymizationMap.set(codeName, keyword); // 코드명 -> 원본 저장 (복원을 위해)
            }
            // 텍스트의 모든 키워드를 코드명으로 교체
            anonymizedText = anonymizedText.replace(new RegExp(keyword, 'g'), codeName);
        }
    }
    return anonymizedText;
}

function deAnonymizeText(text) {
    if (!ANONYMIZATION_ENABLED) return text;

    let deAnonymizedText = text;
    // 맵에 저장된 모든 코드명을 찾아서 원본으로 복원
    for (const [key, value] of anonymizationMap.entries()) {
        if (key.startsWith('[')) { // key가 [KEYWORD_...] 형태일 때
            deAnonymizedText = deAnonymizedText.replace(new RegExp(key.replace('[', '\\[').replace(']', '\\]'), 'g'), value);
        }
    }
    return deAnonymizedText;
}

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
    // [✅ 핵심 수정] anonymizationMap을 매 대화마다 초기화합니다.
    anonymizationMap.clear(); 
    
    return history.map(msg => ({
        role: msg.role === 'system' ? 'user' : msg.role,
        parts: msg.parts
            .map(part => {
                if (part.type === 'text') {
                    // [✅ 핵심 수정] 텍스트를 바로 사용하지 않고, anonymizeText 함수를 통과시킵니다.
                    return { text: anonymizeText(part.text) };
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
// 새로운 도구 ( Todo list )
const todoListPath = path.join(__dirname, 'todo_list.json');

// 할 일 추가
async function addTodo({ task }) {
    console.log(`[Todo] 할 일 추가 시도: ${task}`);
    try {
        const fileContent = await fs.readFile(todoListPath, 'utf-8');
        const data = JSON.parse(fileContent);
        data.tasks.push(task); // 새 할 일을 배열에 추가
        await fs.writeFile(todoListPath, JSON.stringify(data, null, 2));
        console.log(`[Todo] '${task}' 추가 완료.`);
        return `'${task}' 항목을 할 일 목록에 성공적으로 추가했습니다.`;
    } catch (error) {
        console.error('[Todo] 할 일 추가 중 오류:', error);
        return '죄송합니다, 할 일을 추가하는 데 실패했습니다.';
    }
}

// 할 일 목록 보기
async function listTodos() {
    console.log(`[Todo] 할 일 목록 조회 시도`);
    try {
        const fileContent = await fs.readFile(todoListPath, 'utf-8');
        const data = JSON.parse(fileContent);

        if (data.tasks.length === 0) {
            return '현재 할 일 목록이 비어있습니다.';
        }
        // 목록을 번호 매겨서 예쁘게 만들어 반환
        const taskList = data.tasks.map((task, index) => `${index + 1}. ${task}`).join('\n');
        return `[현재 할 일 목록]\n${taskList}`;
    } catch (error) {
        console.error('[Todo] 할 일 목록 조회 중 오류:', error);
        return '죄송합니다, 할 일 목록을 불러오는 데 실패했습니다.';
    }
}

// 할 일 완료 (목록에서 삭제)
async function completeTodo({ task }) {
    console.log(`[Todo] 할 일 완료(삭제) 시도: ${task}`);
    try {
        const fileContent = await fs.readFile(todoListPath, 'utf-8');
        const data = JSON.parse(fileContent);
        
        const initialLength = data.tasks.length;
        // 사용자가 말한 내용이 포함된 할 일을 목록에서 제거
        data.tasks = data.tasks.filter(t => !t.includes(task));
        
        if (data.tasks.length < initialLength) {
            await fs.writeFile(todoListPath, JSON.stringify(data, null, 2));
            console.log(`[Todo] '${task}' 완료 처리.`);
            return `'${task}' 항목을 할 일 목록에서 완료 처리했습니다.`;
        } else {
            console.log(`[Todo] '${task}' 항목을 찾을 수 없음.`);
            return `'${task}' 와 일치하는 항목을 할 일 목록에서 찾을 수 없습니다.`;
        }
    } catch (error) {
        console.error('[Todo] 할 일 완료 중 오류:', error);
        return '죄송합니다, 할 일을 완료 처리하는 데 실패했습니다.';
    }
}

// 구글 드라이브 파일 검색
    async function searchDrive({ query, mimeType }) { // mimeType 파라미터 추가
    console.log(`[Drive] 파일 검색 시도: query='${query}', mimeType='${mimeType}'`);
    const auth = await authorize();
    if (!auth) {
        return "[AUTH_REQUIRED]Google 드라이브 인증이 필요합니다...";
    }

    const drive = google.drive({ version: 'v3', auth });
    try {
        // [✅ 핵심 수정] 검색 쿼리를 동적으로 생성합니다.
        let searchQuery = 'trashed = false'; // 기본적으로 휴지통에 없는 파일만
        if (query) {
            searchQuery += ` and name contains '${query}'`; // 이름 검색 조건 추가
        }
        if (mimeType) {
            searchQuery += ` and mimeType = '${mimeType}'`; // 파일 종류 검색 조건 추가
        }
        
        // 만약 query와 mimeType이 모두 없으면, 검색을 막아서 모든 파일이 나오는 것을 방지
        if (!query && !mimeType) {
            return "검색할 파일 이름이나 종류(예: '엑셀', '이미지')를 알려주세요.";
        }

        const res = await drive.files.list({
            q: searchQuery,
            pageSize: 5,
            fields: 'files(id, name, webViewLink)',
        });

        const files = res.data.files;
        if (!files || files.length === 0) {
            return `요청하신 파일을 드라이브에서 찾을 수 없습니다. (검색 조건: ${searchQuery})`;
        }

        const fileList = files.map(file => `- ${file.name} (링크: ${file.webViewLink})`).join('\n');
        return `[드라이브 검색 결과]\n${fileList}`;

    } catch (err) {
        console.error('[Drive] 파일 검색 중 오류:', err);
        return `Google 드라이브 검색 중 오류가 발생했습니다: ${err.message}`;
    }
}

// [새로운 도구 단일 시스템 명령어 실행 (안전장치 추가)
async function executeCommand({ command }) {
    console.log(`[Confirmation] 명령어 실행 '계획' 수립: ${command}`);

    // [보안 장치] .env 파일 설정 확인은 그대로 유지
    if (process.env.ALLOW_SYSTEM_COMMANDS !== 'true') {
        const warning = "보안상의 이유로 시스템 명령어 실행 기능이 비활성화되어 있습니다.";
        console.warn(`[Confirmation] 거부됨: ${warning}`);
        return warning;
    }

    // 명령어를 바로 실행하지 않고, "확인 요청" 신호를 반환합니다.
    // 이 신호는 AI가 사용자에게 되물을 수 있도록 JSON 문자열 형태로 만듭니다.
    const confirmationRequest = {
        needsConfirmation: true,
        action: 'executeCommand',
        details: { command: command }
    };
    return JSON.stringify(confirmationRequest);
}

// 여러 시스템 명령어 실행 (안전장치 추가)
async function executeMultipleCommands({ commands }) {
    console.log(`[Confirmation] 여러 명령어 실행 '계획' 수립:`, commands);

    if (process.env.ALLOW_SYSTEM_COMMANDS !== 'true') {
        const warning = "보안상의 이유로 시스템 명령어 실행 기능이 비활성화되어 있습니다.";
        console.warn(`[Confirmation] 거부됨: ${warning}`);
        return warning;
    }
    if (!Array.isArray(commands)) {
        return "오류: 명령어 목록은 배열(리스트) 형태여야 합니다.";
    }

    // 여기도 "확인 요청" 신호를 반환합니다.
    const confirmationRequest = {
        needsConfirmation: true,
        action: 'executeMultipleCommands',
        details: { commands: commands }
    };
    return JSON.stringify(confirmationRequest);
}

// 실제 명령어 실행 로직을 별도의 함수로 분리합니다.
async function _actuallyExecuteCommand(command) {
    return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                resolve(`명령어 실행 실패: ${error.message}`);
            } else if (stderr) {
                resolve(`실행되었지만 경고 발생: ${stderr}`);
            } else {
                resolve(`실행 결과: ${stdout || "성공적으로 실행됨."}`);
            }
        });
    });
}

// 좀 더 업그레이드 한 PPTX 프레젠테이션 파일 생성
async function createPresentation({ jsonString, title }) {
    console.log(`[PPT Gen] JSON 구조 기반 프레젠테이션 생성 시작...`);
    
    let cleanJsonString = jsonString;
    const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = jsonString.match(codeBlockRegex);
    if (match && match[1]) {
        cleanJsonString = match[1];
        console.log('[PPT Gen] Markdown 코드 블록을 감지하여 순수 JSON을 추출했습니다.');
    } else {
        cleanJsonString = jsonString.replace(/```/g, "").trim();
    }
    
    const PptxGenJS = require('pptxgenjs');
    let pptx = new PptxGenJS();
    
    // --- [✅ 핵심 업그레이드 1: 마스터 슬라이드(디자인 템플릿) 정의] ---
    
    // 1. 제목 슬라이드를 위한 마스터
    pptx.defineSlideMaster({
        title: 'TITLE_MASTER', // 이 마스터의 이름
        background: { color: 'F1F1F1' }, // 배경색
        objects: [
            { 'rect': { x: 0, y: 0, w: '100%', h: 0.75, fill: { color: '0072C6' } } }, // 상단 파란색 바
            { 'text': { // 제목 텍스트 상자의 기본 스타일
                options: {
                    placeholder: 'title', // 이 상자의 이름표는 'title'
                    x: 0.5, y: 2.5, w: 9, h: 1.5,
                    fontFace: 'Arial', fontSize: 40, color: '363636', bold: true, align: 'center'
                }
            }},
            { 'text': { // 하단 부제 텍스트 상자
                options: {
                    placeholder: 'subtitle',
                    x: 0.5, y: 4.0, w: 9, h: 1.0,
                    fontFace: 'Arial', fontSize: 18, color: '6c6c6c', align: 'center'
                }
            }}
        ]
    });

    // 2. 본문 슬라이드를 위한 마스터
    pptx.defineSlideMaster({
        title: 'CONTENT_MASTER',
        background: { color: 'F1F1F1' },
        objects: [
            { 'rect': { x: 0, y: 0, w: '100%', h: 0.75, fill: { color: '0072C6' } } },
            { 'text': {
                options: {
                    placeholder: 'title', // 제목 상자
                    x: 0.5, y: 0.1, w: 9, h: 1.0,
                    fontFace: 'Arial', fontSize: 28, color: '363636', bold: true
                }
            }},
            { 'text': {
                options: {
                    placeholder: 'body', // 본문 상자 (글머리 기호가 들어갈 곳)
                    x: 0.5, y: 1.2, w: 5.0, h: 4.5, // 너비를 5.0으로 해서 왼쪽 절반만 사용
                    fontFace: 'Arial', fontSize: 16, color: '494949'
                }
            }},
            { 'image': { // 이미지 상자 (오른쪽에 배치)
                options: {
                    placeholder: 'image',
                    x: 5.8, y: 1.5, w: 4.0, h: 3.5
                }
            }},
            { 'text': { // 슬라이드 번호
                options: {
                    placeholder: 'slideNumber',
                    x: 4.5, y: '92%', w: 1, h: 0.5,
                    fontFace: 'Arial', fontSize: 12, color: '6c6c6c', align: 'center'
                }
            }}
        ]
    });

    let presentationData;
    try {
        presentationData = JSON.parse(cleanJsonString);
    } catch (error) {
        console.error('[PPT Gen] AI가 생성한 JSON 파싱 실패:', error);
        return createPresentationFromSimpleText({ text: jsonString, title });
    }
    
    // [핵심 업그레이드: 마스터 슬라이드를 사용하여 슬라이드 생성]

    // 1. 제목 슬라이드 생성
    let titleSlide = pptx.addSlide({ masterName: 'TITLE_MASTER' });
    titleSlide.addText(presentationData.title || title || 'AI 생성 프레젠테이션', { placeholder: 'title' });
    titleSlide.addText('Generated by Mond\'s AI Assistant', { placeholder: 'subtitle' });

    // --- [✅ 여기가 바로 '성격 급한 공장장'을 고치는 핵심 로직!] ---
    if (presentationData.slides && Array.isArray(presentationData.slides)) {
        
        // 1. 모든 비동기 작업(이미지 검색)을 담을 빈 배열을 만듭니다.
        const slideCreationPromises = presentationData.slides.map(async (slideData) => {
            let contentSlide = pptx.addSlide({ masterName: 'CONTENT_MASTER' });
            
            if (slideData.title) {
                contentSlide.addText(slideData.title, { placeholder: 'title' });
            }

            if (slideData.points && Array.isArray(slideData.points)) {
                const textObjectsForPoints = slideData.points.map(point => ({ text: point, options: { bullet: true, indentLevel: 1 } }));
                contentSlide.addText(textObjectsForPoints, { placeholder: 'body' });
            }

            if (slideData.presenter_note) {
                contentSlide.addNotes(slideData.presenter_note);
            }
            
            // 2. 이미지 검색 및 추가 로직을 실행하고, 이 작업이 'Promise'임을 알려줍니다.
            if (slideData.image_keyword) {
                const base64Image = await searchAndGetImageAsBase64({ query: slideData.image_keyword });
                if (base64Image) {
                    contentSlide.addImage({ data: base64Image, x: 5.8, y: 1.5, w: 4.0, h: 3.5 });
                }
            }
        });

        // 3. 'Promise.all'을 사용해, 위에서 만든 모든 이미지 검색 작업이 끝날 때까지 기다립니다!
        await Promise.all(slideCreationPromises);
    }

    // --- (파일 저장 및 반환 로직은 동일) ---
    const presentationsDir = path.join(__dirname, 'public', 'presentations');
    if (!fsSync.existsSync(presentationsDir)) { fsSync.mkdirSync(presentationsDir, { recursive: true }); }
    const fileName = `presentation-${Date.now()}.pptx`;
    const filePath = path.join(presentationsDir, fileName);

    // 이제 모든 이미지가 추가된 후에야 파일을 저장합니다.
    await pptx.writeFile({ fileName: filePath });
    console.log(`[PPT Gen] 파일 생성 완료: ${filePath}`);
    return `/presentations/${fileName}`;
}

// [✅ 폴백(Fallback)을 위한 기존 함수]
// 텍스트를 기반으로 PPTX 프레젠테이션 파일 생성
async function createPresentationFromSimpleText({ text, title }) {
    const PptxGenJS = require('pptxgenjs');
    let pptx = new PptxGenJS();
    pptx.addSlide().addText(title || 'AI 생성 프레젠테이션', { x: 1.0, y: 2.5, w: 8, h: 1, fontSize: 36, bold: true, align: 'center' });
    const slidesContent = text.split('\n\n');
    for (const content of slidesContent) {
        if (content.trim().length > 0) {
            let slide = pptx.addSlide();
            slide.addText(content.trim(), { x: 0.5, y: 0.5, w: '90%', h: '90%', fontSize: 18, align: 'left', valign: 'top' });
        }
    }
    const presentationsDir = path.join(__dirname, 'public', 'presentations');
    if (!fsSync.existsSync(presentationsDir)){ fsSync.mkdirSync(presentationsDir, { recursive: true }); }
    const fileName = `presentation-${Date.now()}.pptx`;
    const filePath = path.join(presentationsDir, fileName);
    await pptx.writeFile({ fileName: filePath });
    return `/presentations/${fileName}`;
}

// [이미지 검색 및 Base64 변환 함수]
const PEXELS_API_KEY = process.env.PEXELS_API_KEY; // .env에서 키를 읽어옴

async function searchAndGetImageAsBase64({ query }) {
    if (!PEXELS_API_KEY) {
        console.warn('[Pexels] PEXELS_API_KEY가 설정되지 않아 이미지 검색을 건너뜁니다.');
        return null;
    }
    
    try {
        const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1`;
        const response = await axios.get(url, {
            headers: { 'Authorization': PEXELS_API_KEY },
            responseType: 'json' // Pexels API는 JSON을 반환
        });

        if (response.data.photos && response.data.photos.length > 0) {
            const imageUrl = response.data.photos[0].src.medium; // 중간 사이즈 이미지 사용
            
            // 이미지를 다운로드해서 Base64로 변환 (pptxgenjs에 직접 넣기 위해)
            const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
            const base64Image = Buffer.from(imageResponse.data, 'binary').toString('base64');
            console.log(`[Pexels] '${query}' 이미지 검색 및 변환 성공!`);
            return `data:image/jpeg;base64,${base64Image}`;
        }
        return null;
    } catch (error) {
        console.error(`[Pexels] '${query}' 이미지 검색 중 오류:`, error.message);
        return null;
    }
}

// ['슈퍼 도구' 함수를 추가]
async function getDailyBriefing() {
    console.log('[Function Executed] getDailyBriefing 실행됨');
    
    try {
        const now = new Date();
        const timeMin = startOfDay(now).toISOString();
        const timeMax = endOfDay(now).toISOString();

        // 1. 캘린더, 할 일, 뉴스 작업을 동시에 시작
        const calendarPromise = getCalendarEvents({ timeMin, timeMax });
        const todoPromise = listTodos();
        const newsPromise = searchWeb({ query: "오늘의 주요 뉴스" });

        // 2. Promise.all로 모든 작업이 끝날 때까지 기다림
        const [calendarResult, todoResult, newsResult] = await Promise.all([
            calendarPromise,
            todoPromise,
            newsPromise
        ]);

        // 3. 수집된 모든 정보를 하나의 보고서 형태로 묶음
        const briefingData = `
        --- 오늘의 브리핑 데이터 ---
        [캘린더]
        ${calendarResult}

        [할 일 목록]
        ${todoResult}

        [주요 뉴스]
        ${newsResult}
        --- 데이터 끝 ---
        `;
        // 4. AI가 이 데이터를 보고 멋지게 요약해서 말할 수 있도록 전달
        return briefingData;

    } catch (error) {
        console.error('[Briefing] 브리핑 데이터 수집 중 오류:', error);
        return '브리핑 데이터를 수집하는 중에 오류가 발생했습니다.';
    }
}
// ['자율적 연구원' 슈퍼 도구의 입구를 만듭니다.
/**
 * @description 자율 연구원: 특정 주제에 대해 웹 검색, 정보 수집, 분석, 종합하여 최종 보고서를 생성하는 복합적인 작업을 수행합니다.
 * @param {string} topic 조사할 주제 (예: "전기 자동차의 역사와 미래 전망")
 * @returns {Promise<string>} 최종 보고서 또는 진행 상황 메시지
 */
async function autonomousResearcher({ topic }, modelName) {
  console.log(`[Autonomous Researcher] 1. Mission Start! Topic: ${topic}, Using model: ${modelName}`);

  try {
    // --- 2단계: 계획 수립 (기존과 동일) ---
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    const planningPrompt = `
      You are a world-class research planner and investigator. Your goal is to create a step-by-step plan to write a comprehensive report on the topic: "${topic}".
      The plan must consist of a series of precise, actionable steps. Each step must be one of the following two types:
      1.  "SEARCH": A simple search query for a search engine. Use this to get a broad overview or find specific URLs.
      2.  "SCRAPE": A specific URL to read the content from. Use this when you find a promising URL from a SEARCH step that needs deeper analysis.
      Based on the topic "${topic}", create a JSON array of at least 3 to 5 steps.
      IMPORTANT: A good plan often starts with SEARCH to find relevant links, and then uses SCRAPE to analyze those links.
      Your entire response MUST be only the JSON array, with no other text or markdown.
    `;
    console.log(`[Autonomous Researcher] 2. Asking AI to create a research plan...`);
    const planningResult = await model.generateContent(planningPrompt);
    const planResponseText = planningResult.response.text();
    console.log(`[Autonomous Researcher] 3. AI has created a plan:\n`, planResponseText);
    
    // --- 3단계: 계획 실행 (업그레이드 버전!) ---
    let researchData = '';
    let plan;

    try {
        let cleanJsonString = planResponseText;
        const codeBlockRegex = /```json\s*([\s\S]*?)\s*```/;
        const match = planResponseText.match(codeBlockRegex);
        if (match && match[1]) {
            cleanJsonString = match[1];
        } else {
            cleanJsonString = planResponseText.trim();
        }
        plan = JSON.parse(cleanJsonString);
    } catch(e) {
        console.error("[Autonomous Researcher] Failed to parse the plan JSON.", e);
        return `AI가 유효하지 않은 조사 계획을 생성했습니다. (생성된 내용: ${planResponseText})`;
    }

    console.log(`[Autonomous Researcher] 4. Executing the research plan with quality control...`);
    
    // [✅ 최종 완성 버전] AI가 사용하는 다양한 키 이름을 모두 포용합니다.
    for (const step of plan) {
        const action = step.action || step.type; // 'action'이 없으면 'type'을 사용
        const query = step.query || step.url; // 'query'가 없으면 'url'을 사용

        if (!action || !query) continue; // 실행할 내용이 없으면 건너뜀

        if (action === 'SEARCH') {
            console.log(` > Executing Step: ${action} - "${query}"`);
            const searchResult = await searchWeb({ query: query });
            researchData += `[SEARCH 결과: ${query}]\n${searchResult}\n\n`;

        } else if (action === 'SCRAPE') {
            console.log(` > Executing Step: ${action} - "${query}"`);
            const scrapeResult = await scrapeWebsite({ url: query });
            
            const MINIMUM_CONTENT_LENGTH = 200;
            if (scrapeResult.length < MINIMUM_CONTENT_LENGTH) {
                console.warn(`[QC Failed] Scraped content is too short (${scrapeResult.length} chars). Discarding and attempting a fallback search.`);
                researchData += `[SCRAPE 실패: ${query}] 내용이 너무 짧아 유효하지 않은 정보로 판단되어 폐기합니다.\n\n`;
                
                const fallbackQuery = `"${topic}"에 대한 추가 정보`;
                console.log(` > [Fallback] Executing alternative search: "${fallbackQuery}"`);
                const fallbackResult = await searchWeb({ query: fallbackQuery });
                researchData += `[대체 조사 결과: ${fallbackQuery}]\n${fallbackResult}\n\n`;
            } else {
                 console.log(`[QC Passed] Scraped content is sufficient (${scrapeResult.length} chars).`);
                researchData += `[SCRAPE 결과: ${query}]\n${scrapeResult}\n\n`;
            }
        }
    }
    
    console.log(`[Autonomous Researcher] 5. All research steps completed.`);

    // --- 4단계: 최종 보고서 작성 (기존과 동일) ---
    console.log(`[Autonomous Researcher] 6. Asking AI to synthesize the final report...`);
    const synthesisPrompt = `
        당신은 전문 보고서 작성가입니다. 당신의 임무는 아래에 제공된 여러 개의 원본 조사 데이터를 종합하여, "${topic}"이라는 주제에 대한 하나의 통일성 있고 잘 정리된 최종 보고서를 작성하는 것입니다.
        제공된 데이터를 주요 정보원으로 사용하세요. 보고서는 명확한 제목, 서론, 본론, 결론의 구조를 갖추어야 합니다. 본론은 소제목이나 글머리 기호를 사용하여 가독성을 높여주세요.
        단순히 조사 결과를 나열하지 말고, 정보들을 논리적으로 연결하여 하나의 완성된 글로 만들어야 합니다.
        --- 원본 조사 데이터 ---
        ${researchData}
        --- 데이터 끝 ---
        이제, 최종 보고서를 한국어로 작성해주세요.
    `;
    const finalResult = await model.generateContent(synthesisPrompt);
    const finalReport = finalResult.response.text();
    console.log(`[Autonomous Researcher] 7. Mission Complete! Final report generated.`);
    return finalReport;

  } catch (error) {
    console.error('[Autonomous Researcher] Error during research phase:', error);
    return `죄송합니다. 조사를 수행하는 중에 오류가 발생했습니다: ${error.message}`;
  }
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
  createCalendarEvent,
  convertNaturalDateToISO,
  addTodo,      
  listTodos,    
  completeTodo,
  searchDrive,
  executeCommand,
  createPresentation,
  getDailyBriefing,
  executeMultipleCommands,
  autonomousResearcher,
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

    // 클라이언트에서 보낼 'task' 정보를 받습니다.
    let { task } = req.body;
    
    console.log(`[API] Chat request - Model: ${modelName}, ChatID: ${chatId || 'New Chat'}`);

    if (!GEMINI_API_KEY) {
        return res.status(400).json({ message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }
    if (!modelName || !Array.isArray(history)) {
        return res.status(400).json({ message: '모델과 올바른 형식의 대화 내용이 모두 필요합니다.' });
    }

    try {
        
        const lastUserText = history.slice(-1)[0]?.parts.find(p => p.type === 'text')?.text.toLowerCase();
        if (chatId && pendingConfirmations[chatId] && ['y', 'yes', '응', '네', '실행', '허가'].some(term => lastUserText.includes(term))) {
            const confirmationData = pendingConfirmations[chatId];
            delete pendingConfirmations[chatId];
            console.log(`[Confirmation] 사용자가 명령어 실행을 허가했습니다.`, confirmationData);

            let finalResult;
            if (confirmationData.action === 'executeCommand') {
                finalResult = await _actuallyExecuteCommand(confirmationData.details.command);
            } else if (confirmationData.action === 'executeMultipleCommands') {
                const results = [];
                for (const cmd of confirmationData.details.commands) {
                    const result = await _actuallyExecuteCommand(cmd);
                    results.push(`- '${cmd}': ${result}`);
                }
                finalResult = `모든 명령어를 실행했습니다.\n${results.join('\n')}`;
            }
            
            const finalReply = { type: 'text', text: finalResult };
            
            const chatFilePath = path.join(chatHistoriesDir, `${chatId}.json`);
            let conversationHistory = [];
            try {
                const fileContent = await fs.readFile(chatFilePath, 'utf-8');
                conversationHistory = JSON.parse(fileContent);
            } catch(e) {/* no file */}
            conversationHistory.push(history.slice(-1)[0]);
            conversationHistory.push({ role: 'model', parts: [finalReply] });
            await fs.writeFile(chatFilePath, JSON.stringify(conversationHistory, null, 2));

            // [✅ 핵심 수정] AI 호출이 없었으므로, 토큰 사용량은 0으로 설정하여 응답합니다.
            const usageMetadata = { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };
            res.json({ reply: finalReply, chatId: chatId, usage: usageMetadata });
            return; // 함수를 여기서 종료합니다.
        }
        if (chatId && pendingConfirmations[chatId]) {
            console.log('[Confirmation] 사용자가 작업을 취소했거나 다른 대답을 하여 대기 상태를 초기화합니다.');
            delete pendingConfirmations[chatId];
        }
        
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

        // 만약 클라이언트에서 'task'를 보냈고, 마지막 메시지에 파일 첨부가 있다면
        const latestMessageForTask = conversationHistory[conversationHistory.length - 1]; 
        // .some()을 사용해 '-attachment'로 끝나는 타입이 하나라도 있는지 확인
        const hasAttachment = latestMessageForTask.parts.some(p => p.type && p.type.endsWith('-attachment'));

        if (task && hasAttachment) {
            console.log(`[Prompt Enhancer] 작업을 감지했습니다: ${task}`);

            // task 종류에 따라 AI에게 내릴 지시사항을 정의
            const taskInstructions = {
                'summarize_core': "다음 문서의 핵심 내용을 3~5줄로 요약해줘.",
                'summarize_simple': "다음 문서를 초등학생도 이해할 수 있도록 아주 쉽게 요약해줘.",
                'change_tone_pro': "다음 문서의 전체적인 톤을 더 전문적이고 격식 있는 비즈니스 스타일로 바꿔줘.",
                'proofread': "다음 문서에서 맞춤법이나 문법 오류를 찾아서 수정하고, 어색한 문장을 자연스럽게 다듬어줘.", 
                'convert_to_blog': `
                    You are a skilled content writer and blogger. Your task is to rewrite the following content into an engaging blog post suitable for a general audience.

                    The blog post must include:
                    1.  An attractive, click-worthy title.
                    2.  A short, engaging introduction that hooks the reader.
                    3.  The main body, formatted with subheadings (using markdown like '##') or bullet points for readability.
                    4.  A concluding paragraph that summarizes the key message and leaves the reader with something to think about.

                    The tone should be slightly more casual and conversational than a formal report. Your entire response should be the blog post itself.

                    Now, rewrite the content below:`,
                'convert_to_email': `
                    You are a professional business communications assistant. Your task is to rewrite the following document content into a clear, concise, and professional email draft.

                    The email must include:
                    1.  A short and informative subject line (e.g., "Subject: Key Takeaways from the AI Report").
                    2.  A professional greeting (e.g., "Hi Team,").
                    3.  A brief introductory sentence.
                    4.  The main content, summarized into key bullet points or short paragraphs.
                    5.  A closing statement and a professional sign-off (e.g., "Best regards,").

                    Do not include any extra explanations. Your entire response should be the email draft itself.

                    Now, rewrite the document content below:`,
                'create_ppt_structure': `
                    You are a presentation expert and visual storyteller. Your task is to analyze the following document and create a structured JSON object for a presentation.
                    The JSON object must follow this exact format:
                    {
                    "title": "A concise and engaging title for the entire presentation",
                    "slides": [
                        {
                        "title": "Title for Slide 1",
                        "points": [ "A bullet point.", "Another bullet point." ],
                        "image_keyword": "A simple, one-or-two-word English keyword for an image.",
                        "presenter_note": "A short, narrative script for the speaker to read during the presentation of this slide. This should explain the bullet points in a more conversational tone."
                        }
                    ]
                    }
                    RULES:
                    - Your entire response MUST be a single, valid JSON object without any extra text.
                    - For each slide, you MUST provide a "presenter_note" written as if you were the speaker. This is mandatory.
                    - For each slide, you MUST provide a simple, relevant "image_keyword" in English.
                    - Create at least 3-5 slides.

                    Now, analyze the document below and generate the JSON object.`,

            };

            const instructionText = taskInstructions[task] || "다음 문서를 분석해줘.";

            // 기존의 텍스트 파트를 찾아서 맨 앞에 지시사항을 추가
            let textPart = latestMessageForTask.parts.find(p => p.type === 'text'); 
            
            if (textPart) {
                // 지시사항을 파일 내용보다 *앞에* 두는 것이 AI의 이해도를 높임
                textPart.text = `${instructionText}\n\n---\n\n${textPart.text || ''}`;
            } else {
                // 텍스트 파트가 없는 경우(이미지만 올리는 등)를 대비해 새로 추가
                latestMessageForTask.parts.unshift({ type: 'text', text: instructionText }); 
            }
            console.log(`[Prompt Enhancer] 프롬프트를 성공적으로 보강했습니다.`);
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
                  { name: 'convertNaturalDateToISO', description: '사용자가 "오늘", "내일"과 같은 자연어로 기간을 언급했을 때, 그 기간을 다른 도구(예: getCalendarEvents)가 사용할 수 있는 정확한 ISO 8601 형식의 timeMin과 timeMax로 변환합니다.', parameters: { type: 'object', properties: { period: { type: 'string', description: '변환할 자연어 기간. 예: "오늘", "내일"' } }, required: ['period'] } },
                  { name: 'addTodo', description: '사용자가 "할 일 추가해줘", "to-do list에 넣어줘" 와 같이 새로운 할 일을 추가해달라고 요청할 때 사용합니다.', parameters: { type: 'object', properties: {task: { type: 'string', description: '추가할 할 일의 내용. 예: "우유 사기"' } }, required: ['task'] } },
                  { name: 'listTodos', description: '사용자가 "할 일 뭐 남았지?", "내 할 일 목록 보여줘" 와 같이 현재 등록된 모든 할 일 목록을 물어볼 때 사용합니다.', parameters: { type: 'object', properties: {} } },
                  { name: 'completeTodo', description: '사용자가 "이거 다 했어", "할 일 완료했어", "목록에서 지워줘" 와 같이 특정 할 일을 완료했거나 목록에서 제거해달라고 요청할 때 사용합니다.', parameters: { type: 'object', properties: { task: { type: 'string', description: '완료하거나 삭제할 할 일의 내용 또는 핵심 키워드. 예: "우유 사기"' } }, required: ['task'] } },
                  { name: 'searchDrive', description: `사용자의 Google 드라이브에서 파일을 검색합니다. 파일 이름('query')이나 파일 종류('mimeType')로 검색할 수 있습니다. 예를 들어, 사용자가 '엑셀 파일 찾아줘'라고 하면, mimeType을 'application/vnd.google-apps.spreadsheet'로 설정하여 호출해야 합니다. '이미지 찾아줘'라고 하면 mimeType을 'image/jpeg' 또는 'image/png'로 설정할 수 있습니다.`, parameters: { type: 'object', properties: { query: { type: 'string', description: `검색할 파일 이름의 일부 또는 전체. 예: "보고서"` }, mimeType: { type: 'string', description: `검색할 파일의 종류(MIME Type). 예: 'application/vnd.google-apps.spreadsheet' (구글 시트/엑셀), 'image/jpeg' (JPEG 이미지), 'application/pdf' (PDF 파일)` } }, required: [] } },
                  { name: 'executeCommand', description: '사용자의 로컬 컴퓨터에서 직접 시스템 셸 명령어를 실행합니다. "메모장 열어줘" (notepad), "계산기 켜줘" (calc), 또는 "크롬으로 네이버 열어줘" (start chrome https://naver.com) 와 같은 요청에 사용됩니다.', parameters: { type: 'object', properties: {command: { type: 'string', description: '실행할 정확한 셸 명령어. 예: "notepad", "start chrome https://youtube.com"' } }, required: ['command'] } },
                  { name: 'executeMultipleCommands', description: '사용자가 "A하고 B해줘", "그리고 C도 해줘" 와 같이 한 번에 여러 개의 시스템 명령을 요청할 때 사용합니다. 모든 명령어를 분석하여 command 문자열의 배열(array) 형태로 만들어 한 번에 호출해야 합니다.', parameters: { type: 'object', properties: { commands: { type: 'array', description: '실행할 셸 명령어들의 목록. 예: ["notepad", "calc"]', items: { type: 'string' } } }, required: ['commands'] } },
                  { name: 'getDailyBriefing', description: '사용자가 "오늘의 브리핑", "하루 요약해줘" 등 아침 브리핑을 명시적으로 요청하거나, 브리핑을 시작하자는 제안에 "응", "네", "좋아", "시작해" 라고 긍정적으로 대답했을 때 사용합니다. 캘린더, 할 일, 뉴스를 종합하여 하루를 요약합니다.',  parameters: { type: 'object', properties: {} } },
                  { name: "autonomousResearcher", description: "특정 주제에 대해 웹 검색, 정보 수집, 분석, 종합하여 최종 보고서를 생성하는 복합적인 작업을 수행합니다. '...에 대해 조사해줘', '...에 대한 리포트 써줘' 와 같이 여러 단계의 조사가 필요한 추상적인 요청에 사용해야 합니다.", parameters: { type: "object", properties: { topic: { type: "string",  description: "조사하고 보고서를 작성할 주제"   }  }, required: ["topic"]  } },
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

- getCalendarEvents({timeMin, timeMax}): Get events from the user's Google Calendar for a specific period.
- createCalendarEvent({summary, startDateTime, endDateTime}): Create a new event in the user's Google Calendar.
- authorizeCalendar(): Start the Google Calendar authorization process if not already authenticated.

- executeMultipleCommands({commands: string[]}): Executes a list of system shell commands sequentially. This is the PREFERRED tool for system tasks. Use for requests like "Open Notepad and Calculator" -> commands: ["notepad", "calc"].
- executeCommand({command: string}): Executes a single system shell command. Use this only when a single, simple task is requested.


--- TOOL USAGE RULES ---
1.  For calendar events requests with natural language like "today" or "tomorrow", you MUST first call convertNaturalDateToISO to get the correct timeMin and timeMax, and then use that result to call getCalendarEvents.
2.  When the user asks to perform MULTIPLE system tasks at once (e.g., 'Open A and then B'), you MUST use the 'executeMultipleCommands' tool. For a SINGLE task, you may use 'executeCommand'.


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
            const functionCall = functionCalls[0];
            // [✅ 핵심 수정] deAnonymize 로직을 여기서 미리 하지 않습니다.
            const { name, args } = functionCall; 

            if (tools[name]) {
                // [✅ 핵심 수정] 각 도구 함수를 호출하기 '직전'에 필요한 인자만 복원합니다.
                const deAnonymizedArgs = {};
                for (const key in args) {
                    if (typeof args[key] === 'string') {
                        deAnonymizedArgs[key] = deAnonymizeText(args[key]);
                    } else {
                        deAnonymizedArgs[key] = args[key]; // 문자열이 아니면 그대로 둠
                    }
                }

                // 도구 함수를 호출할 때는 '복원된' deAnonymizedArgs를 사용합니다.
                let functionResult;
                // utonomousResearcher를 호출할 때만 특별히 modelName을 넘겨줍니다.
                if (name === 'autonomousResearcher') {
                    functionResult = await tools[name](deAnonymizedArgs, modelName);
                } else {
                    // 다른 모든 일반 도구들은 기존 방식 그대로 호출합니다.
                    functionResult = await tools[name](deAnonymizedArgs);
                }
                let secondResult;

            try {
                const parsedResult = JSON.parse(functionResult);
                if (parsedResult && parsedResult.needsConfirmation) {
                    pendingConfirmations[chatId] = parsedResult;
                    const confirmationPrompt = `The user wants to execute the command(s) '${JSON.stringify(parsedResult.details)}'. Your task is to ask the user for confirmation to proceed. Keep your question concise and clear, in Korean. For example: "알겠습니다. 다음 명령어를 실행하려고 합니다: [명령어]. 계속할까요? (Y/N)"`;
                    secondResult = await chat.sendMessage(confirmationPrompt);
                    finalReply = { type: 'text', text: secondResult.response.text() };
                    if (secondResult) {
                        totalTokenCount += secondResult.response.usageMetadata?.totalTokenCount || 0;
                    }
                } else {
                    throw new Error("Not a confirmation request.");
                }
            } catch (e) {
                // [✅ 핵심 수정] 연계 실행 로직에도 복원된 deAnonymizedArgs를 사용하도록 간접적으로 수정됩니다.
                if (name === 'convertNaturalDateToISO') {
                    try {
                        const calendarArgs = JSON.parse(functionResult);
                        // getCalendarEvents는 인자가 없으므로 복원할 필요 없음
                        functionResult = await tools['getCalendarEvents'](calendarArgs);
                        const finalFunctionName = 'getCalendarEvents';
                        const functionResponse = { name: finalFunctionName, response: { name: finalFunctionName, content: functionResult } };
                        secondResult = await chat.sendMessage([{ functionResponse: functionResponse }]);
                        finalReply = { type: 'text', text: secondResult.response.text() };
                        if (secondResult) totalTokenCount += secondResult.response.usageMetadata?.totalTokenCount || 0;
                    } catch (chainError) {
                        const functionResponse = { name: name, response: { name: name, content: functionResult } };
                        secondResult = await chat.sendMessage([{ functionResponse: functionResponse }]);
                        finalReply = { type: 'text', text: secondResult.response.text() };
                        if (secondResult) totalTokenCount += secondResult.response.usageMetadata?.totalTokenCount || 0;
                    }
                } else {
                    if (name === 'getYoutubeTranscript' && functionResult.includes('자막을 찾을 수 없습니다')) {
                        functionResult = await tools['scrapeWebsite'](args);
                    }
                    const functionResponse = { name: name, response: { name: name, content: functionResult } };
                    secondResult = await chat.sendMessage([ { functionResponse: functionResponse } ]);
                    finalReply = { type: 'text', text: secondResult.response.text() };
                    if (secondResult) {
                        totalTokenCount += secondResult.response.usageMetadata?.totalTokenCount || 0;
                    }
                }
            }
        } else {
            finalReply = { type: 'text', text: `오류: 알 수 없는 도구 '${name}'를 호출했습니다.` };
        }
    } else {
        finalReply = { type: 'text', text: response.text() };
    }

        // [핵심 수정] finalReply를 저장하고 응답하기 전에, 텍스트 내용을 복원합니다.
        if (finalReply && finalReply.type === 'text' && finalReply.text) {
            finalReply.text = deAnonymizeText(finalReply.text);
        }
        
        // --- 5. 대화 기록 저장 및 최종 응답 (기존과 동일) ---
        conversationHistory.push({ role: 'model', parts: [finalReply] });
        await fs.writeFile(chatFilePath, JSON.stringify(conversationHistory, null, 2));
        console.log(`[History] ${conversationHistory.length}개의 메시지를 ${chatId}.json 파일에 저장했습니다.`);
        console.log(`[API] Total tokens used: ${totalTokenCount}`);

        const usageMetadata = response?.usageMetadata || { totalTokenCount: totalTokenCount || 0 };
        
        // [✅ 참고] 클라이언트에게 보내는 finalReply도 복원된 텍스트를 담고 있습니다.
        res.json({ 
            reply: finalReply, 
            chatId: chatId, 
            usage: usageMetadata
        });


    } catch (error) {
        // --- 6. 에러 처리 (기존과 동일) ---
        console.error('채팅 API 오류:', error);
        let errorMessage = `대화 생성 중 오류: ${error.message}`;
        if (error.errorDetails && Array.isArray(error.errorDetails)) {
            const violation = error.errorDetails.find(d => d.fieldViolations)?.fieldViolations[0];
            if (violation) {
                errorMessage = `Google API 오류: ${violation.description}`;
            }
            const quotaViolation = error.errorDetails.find(d => d.violations)?.violations[0];
            if (quotaViolation) {
                errorMessage = `Google API 할당량 초과: ${quotaViolation.description || '요청 한도를 초과했습니다.'}`;
            }
        }
        const sanitizedErrorMessage = errorMessage.replace(/[^\x20-\x7E\w\sㄱ-ㅎㅏ-ㅣ가-힣.:,()]/g, '');
        res.status(500).json({ message: sanitizedErrorMessage });
    }
});

// 인증 시작 (Python의 /authorize 역할)
app.get('/authorize', (req, res) => {
    // 사용자가 구글에 로그인하고, 우리 앱에 캘린더 접근 권한을 주도록 요청하는 URL 생성
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
        'https://www.googleapis.com/auth/calendar.events', // 기존 캘린더 권한
        'https://www.googleapis.com/auth/drive.readonly'  // 드라이브 읽기/검색 권한
    ],
    prompt: 'consent' 
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

// PPT 생성 API 엔드포인트
app.post('/api/create-presentation', async (req, res) => {
    // text 대신 jsonString을 받습니다.
    const { jsonString, title } = req.body;

    if (!jsonString || jsonString.trim().length === 0) {
        return res.status(400).json({ message: '프레젠테이션으로 만들 텍스트가 필요합니다.' });
    }

    try {
        // 새로운 함수를 호출합니다.
        const downloadUrl = await createPresentation({ jsonString, title });
        res.json({ downloadUrl: downloadUrl });

    } catch (error) {
        console.error('[PPT Gen API] 프레젠테이션 생성 중 오류 발생:', error);
        res.status(500).json({ message: `프레젠테이션 생성 중 서버 오류가 발생했습니다: ${error.message}` });
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