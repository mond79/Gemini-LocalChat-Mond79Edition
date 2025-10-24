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
const cron = require('node-cron');
const os = require('os');
const dbManager = require('./database/db-manager');
const vectorDBManager = require('./database/vector-db-manager');

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
//const chatHistoriesDir = path.join(__dirname, 'chat_histories');
//const userProfilePath = path.join(__dirname, 'user_profile.json');

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

//function anonymizeText(text) {
    //if (!ANONYMIZATION_ENABLED) return text;

    //let anonymizedText = text;
    //for (const keyword of SENSITIVE_KEYWORDS) {
        // text 안에 키워드가 포함되어 있는지 확인
        //if (anonymizedText.includes(keyword)) {
            //let codeName = anonymizationMap.get(keyword);
            // 이 키워드에 대한 코드명이 아직 없으면 새로 생성
            //if (!codeName) {
                //codeName = `[KEYWORD_${anonymizationMap.size + 1}]`;
                //anonymizationMap.set(keyword, codeName); // 원본 -> 코드명 저장
                //anonymizationMap.set(codeName, keyword); // 코드명 -> 원본 저장 (복원을 위해)
            //}
            // 텍스트의 모든 키워드를 코드명으로 교체
            //anonymizedText = anonymizedText.replace(new RegExp(keyword, 'g'), codeName);
        //}
    //}
    //return anonymizedText;
//}

// deAnonymizeText 함수가 '해독표'를 인자로 받도록 수정합니다.
function deAnonymizeText(text, currentAnonymizationMap) {
    if (!ANONYMIZATION_ENABLED || !currentAnonymizationMap || currentAnonymizationMap.size === 0) return text;
    let deAnonymizedText = text;
    for (const [key, value] of currentAnonymizationMap.entries()) {
        if (key.startsWith('[')) {
            const escapedKey = key.replace(/\[/g, '\\[').replace(/\]/g, '\\]');
            deAnonymizedText = deAnonymizedText.replace(new RegExp(escapedKey, 'g'), value);
        }
    }
    return deAnonymizedText;
}

// formatHistoryForGoogleAI 함수가 '변환된 기록'과 '해독표'를 함께 반환하도록 수정합니다.
function formatHistoryForGoogleAI(history) {
    const localAnonymizationMap = new Map();

    const formattedHistory = history.map(msg => ({
        role: msg.role === 'system' ? 'user' : msg.role,
        parts: msg.parts
            .map(part => {
                if (part.type === 'text') {
                    // ▼▼▼▼▼ 바로 이 부분을 수정합니다! ▼▼▼▼▼
                    // anonymizeText 함수 대신, 익명화 로직을 여기에 직접 구현합니다.
                    let anonymizedText = part.text;
                    for (const keyword of SENSITIVE_KEYWORDS) {
                        // 텍스트에 민감한 키워드가 포함되어 있는지 확인
                        if (anonymizedText.includes(keyword)) {
                            // 이 키워드에 대한 코드명이 아직 없으면 새로 생성
                            let codeName = `[KEYWORD_${SENSITIVE_KEYWORDS.indexOf(keyword) + 1}]`;
                            
                            // 맵에 양방향으로 기록 (해독을 위해)
                            localAnonymizationMap.set(keyword, codeName);
                            localAnonymizationMap.set(codeName, keyword);
                            
                            // 텍스트의 모든 키워드를 코드명으로 교체
                            anonymizedText = anonymizedText.replace(new RegExp(keyword, 'g'), codeName);
                        }
                    }
                    return { text: anonymizedText };
                    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
                }
                if (part.type === 'image' || part.type === 'audio') {
                    let base64Data = part.data || '';
                    if (base64Data.startsWith('data:')) {
                        base64Data = base64Data.split(',')[1] || '';
                    }
                    return { inlineData: { mimeType: part.mimeType, data: base64Data } };
                }
                return null;
            }).filter(Boolean)
    })).filter(msg => msg.parts.length > 0);

    return { formattedHistory, anonymizationMap: localAnonymizationMap };
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
    
    if (!SERPAPI_API_KEY) {
        console.error('[SerpApi] SERPAPI_API_KEY가 .env 파일에 설정되지 않았습니다.');
        return '웹 검색 기능이 설정되지 않았습니다. 서버 관리자에게 문의하세요.';
    }

    const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERPAPI_API_KEY}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`SerpApi 요청 실패: ${response.statusText}`);
        }
        
        const data = await response.json();

        let content = "검색 결과를 찾았지만 요약할 만한 내용이 없습니다.";
        let sourceUrl = "#"; // 출처가 없을 경우를 대비한 기본값

        // 가장 좋은 출처(answer_box)부터 확인
        if (data.answer_box && data.answer_box.snippet) {
            content = data.answer_box.snippet;
            sourceUrl = data.answer_box.link || (data.organic_results && data.organic_results[0]?.link);
        } 
        // 그 다음 좋은 출처(organic_results) 확인
        else if (data.organic_results && data.organic_results[0]) {
            content = data.organic_results[0].snippet;
            sourceUrl = data.organic_results[0].link;
        }
        
        // AI에게 전달할 최종 결과물을 '내용 + 출처' 형식으로 만듭니다.
        const finalResult = `[내용: ${content}]\n[출처: ${sourceUrl}]`;

        console.log('[SerpApi] 검색 결과 요약:', finalResult);
        return finalResult; // <--- 내용과 출처가 함께 담긴 텍스트를 반환!

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
    console.log(`[YouTube] 파이썬 서버에 자막 추출을 요청합니다: ${url}`);
    try {
        const response = await axios.post('http://localhost:8001/youtube-transcript', {
            url: url
        }, {
            // 아무리 큰 JSON 데이터라도 문제없이 받도록 용량 제한을 해제합니다.
            maxContentLength: Infinity,
            maxBodyLength: Infinity
        });
        
        // 이제부터는 response.data가 비어있지 않을 것입니다.
        if (response.data && response.data.segments) { // segments가 있는지 더 명확하게 확인
            console.log(`[YouTube] 파이썬 서버로부터 자막 수신 성공! (세그먼트 수: ${response.data.segments.length})`);
            // 파이썬 서버가 보낸 데이터 전체를 그대로 반환합니다.
            return response.data; 
        } else {
            throw new Error('파이썬 서버가 유효한 자막 데이터를 반환하지 않았습니다.');
        }

    } catch (error) {
        // 3. 파이썬 서버와 통신 중 오류가 발생한 경우
        console.error('[YouTube] 파이썬 서버와 통신 중 오류 발생:', error.response ? error.response.data : error.message);
        // 파이썬 서버가 보낸 오류 메시지를 그대로 사용자에게 전달합니다.
        const detail = error.response?.data?.detail || error.message;
        return `죄송합니다. 자막을 가져오는 데 실패했습니다. (원인: ${detail})`;
    }
}

async function displayYoutubeVideo({ videoId }) {
    console.log(`[Tool Redirect] displayYoutubeVideo가 호출되었습니다. youtubeVideoAssistant로 리디렉션합니다.`);
    // 이 도구는 이제 직접 아무것도 하지 않고, 만능 도구를 호출하는 역할만 합니다.
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    // 요약(summarize)은 false로 하여, 영상만 빠르게 보여주는 데 집중합니다.
    return await youtubeVideoAssistant({ query: videoUrl, summarize: false, display: true });
}

async function youtubeVideoAssistant({ query, summarize = true, display = true }) {
    console.log(`[Chapter Engine V2] 챕터링 요약 시작. 검색어: "${query}"`);

    // --- [ChatGPT 설계] 안정화된 감정 기반 챕터링 엔진 ---
    const detectEmotion = (text = "") => {
        const lower = text.toLowerCase();
        if (lower.includes("웃음") || lower.includes("재미") || lower.includes("ㅋㅋ")) return "happy";
        if (lower.includes("요리") || lower.includes("만들") || lower.includes("긴장")) return "tense";
        if (lower.includes("춤") || lower.includes("노래") || lower.includes("게임")) return "action";
        if (lower.includes("대화") || lower.includes("이야기")) return "dialogue";
        return "neutral";
    };

    function groupSegmentsIntoChapters(segments = []) {
        if (!Array.isArray(segments) || segments.length === 0) {
            console.warn("[Chapter Engine] 그룹화할 세그먼트 데이터가 비어 있습니다.");
            return [];
        }

        const chapters = [];
        let currentGroup = [];
        let currentEmotion = (segments[0] && segments[0].emotion_tag) ? segments[0].emotion_tag : 'neutral';

        for (const seg of segments) {
            if (!seg || !seg.summary) continue;

            const emotion = seg.emotion_tag;
            if (emotion !== currentEmotion && currentGroup.length > 0) {
                chapters.push({ emotion: currentEmotion, segments: currentGroup });
                currentGroup = [];
            }
            currentEmotion = emotion;
            currentGroup.push(seg);
        }

        if (currentGroup.length > 0) {
            chapters.push({ emotion: currentEmotion, segments: currentGroup });
        }

        const colorMap = { happy: "#4caf50", tense: "#f44336", action: "#ff9800", dialogue: "#2196f3", neutral: "#9e9e9e", error: "#9e9e9e" };
        const emojiMap = { happy: "😂", tense: "🔥", action: "🕹️", dialogue: "💬", neutral: "📄", error: "⚠️" };
        const titleMap = { happy: "즐거운 순간", tense: "긴장 & 집중", action: "액션 & 게임", dialogue: "대화 & 스토리", neutral: "일반 정보", error: "오류 구간" };

        return chapters.map((ch) => ({
            title: titleMap[ch.emotion] || "기타",
            emotion: ch.emotion,
            color: colorMap[ch.emotion] || "#9e9e9e",
            emoji: emojiMap[ch.emotion] || "📄",
            segments: ch.segments,
        }));
    }

    try {
        const urlToProcess = (query.startsWith('http')) ? query : query;
        const transcriptData = await getYoutubeTranscript({ url: urlToProcess });

        const videoIdMatch = query.match(/v=([a-zA-Z0-9_-]{11})/);
        const video_id = transcriptData.video_id || (videoIdMatch ? videoIdMatch[1] : null);

        if (!video_id) throw new Error("영상 ID를 확인할 수 없습니다.");

        let finalResultPayload = { videoId: video_id, overview: "", chapters: [], fallback_summary: "" };
        const { segments, message } = transcriptData;

        if (segments && segments.length > 0 && summarize) {
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

            const fullTranscript = segments.map(s => s.text).join(' ');
            const overviewPrompt = `다음 영상 자막 전체를 보고, 이 영상의 주제와 분위기를 2~3 문장으로 간결하게 '개요'를 작성해줘:\n\n"${fullTranscript}"`;
            try {
                const overviewResult = await model.generateContent(overviewPrompt);
                finalResultPayload.overview = overviewResult.response.text().trim();
                console.log('[Timeline Engine V2] Step 1: 영상 전체 개요 생성 성공.');
            } catch (e) {
                finalResultPayload.overview = "영상 전체 개요를 생성하는 데 실패했습니다.";
            }

            const CHUNK_DURATION = 30;
            const chunks = [];
            let currentChunk = null;
            for (const segment of segments) {
                if (!currentChunk) currentChunk = { start: segment.start, text: '' };
                currentChunk.text += segment.text + ' ';
                if (segment.end - currentChunk.start >= CHUNK_DURATION) {
                    chunks.push(currentChunk);
                    currentChunk = null;
                }
            }
            if (currentChunk && currentChunk.text.trim()) chunks.push(currentChunk);

            const summaryPromises = chunks.map(async (chunk) => {
                const summaryPrompt = `다음 텍스트는 영상의 한 장면입니다. 이 장면의 핵심 내용을 한 문장으로 간결하게 요약해줘:\n\n"${chunk.text}"`;
                try {
                    const result = await model.generateContent(summaryPrompt);
                    const summary = result.response.text().trim().replace(/"/g, '');
                    const emotion_tag = detectEmotion(summary);
                    return { start: Math.floor(chunk.start), summary, emotion_tag };
                } catch (e) {
                    return { start: Math.floor(chunk.start), summary: "(요약 실패)", emotion_tag: 'error' };
                }
            });
            const summarizedSegments = await Promise.all(summaryPromises);
            console.log(`[Timeline Engine V2] Step 2 성공: ${summarizedSegments.length}개의 구간 요약 완료.`);
            
            finalResultPayload.chapters = groupSegmentsIntoChapters(summarizedSegments);
            console.log(`[Chapter Engine] Step 3 성공: ${finalResultPayload.chapters.length}개의 챕터를 생성했습니다.`);

        } else if (summarize) {
            console.log(`[Timeline Engine V2] 플랜 B: 자막 없음. scrapeWebsite를 이용한 기본 요약을 시도합니다.`);
            const scrapedContent = await scrapeWebsite({ url: `https://www.youtube.com/watch?v=${video_id}` });
            const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
            const prompt = `다음은 영상의 제목과 설명입니다. 이 정보를 바탕으로 "이 영상은 ~하는 내용의 영상입니다." 와 같이 자연스럽게 한두 문장으로 소개해줘:\n\n${scrapedContent}`;
            const result = await model.generateContent(prompt);
            finalResultPayload.fallback_summary = result.response.text().trim() + `\n(${message || '자막 정보 없음'})`;
        }
        
        if (!display) {
            if (finalResultPayload.chapters.length > 0) {
                return "구간별 요약 및 챕터링이 완료되었습니다. 타임라인을 보려면 다시 요청해주세요.";
            }
            return finalResultPayload.fallback_summary || "영상에 대한 정보를 처리했습니다.";
        }
        return `[TIMELINE_DATA]:::${JSON.stringify(finalResultPayload)}`;

    } catch (error) {
        if (display) {
            console.warn(`[Timeline Engine] 오류 발생으로 폴백 실행: 영상 플레이어만이라도 표시합니다.`);
            const videoIdMatch = query.match(/v=([a-zA-Z0-9_-]{11})/);
            if (videoIdMatch && videoIdMatch[1]) {
                return `[TIMELINE_DATA]:::${JSON.stringify({ videoId: videoIdMatch[1], chapters: [], fallback_summary: "죄송합니다. 영상 정보를 처리하는 데 실패했습니다. 대신 영상만 보여드릴게요." })}`;
            }
        }
        const detail = error.response?.data?.detail || error.message;
        console.error(`[Timeline Engine] 타임라인 생성 중 심각한 오류 발생: ${detail}`);
        return `죄송합니다, 영상 타임라인을 생성하는 중 오류가 발생했습니다: ${detail}`;
    }
}

// [도구 7 & 8] 사용자 프로필 저장/불러오기
/**
 * @description 사용자의 이름(name)이나 역할/직업(role) 같은 '정체성' 정보를 기억합니다.
 * @param {string} key - 기억할 정보의 종류 ('name' 또는 'role').
 * @param {string} value - 기억할 실제 내용.
 */
async function rememberIdentity({ key, value }) {
    console.log(`[Profile] Remembering identity: ${key} = ${value}`);
    const profile = dbManager.getUserProfile();
    if (profile.identity && profile.identity.hasOwnProperty(key)) {
        profile.identity[key] = value;
        dbManager.saveUserProfile(profile);
        return `알겠습니다. 당신의 ${key}을(를) '${value}'(으)로 기억하겠습니다.`;
    }
    return `오류: '${key}'는 유효한 정체성 정보가 아닙니다. ('name' 또는 'role'만 가능합니다.)`;
}

/**
 * @description 사용자가 좋아하거나(likes) 싫어하는(dislikes) 것에 대한 '선호도' 정보를 기억합니다.
 * @param {string} type - 선호도의 종류 ('likes' 또는 'dislikes').
 * @param {string} item - 좋아하거나 싫어하는 대상.
 */
async function rememberPreference({ type, item }) {
    console.log(`[Profile] Remembering preference: ${type} = ${item}`);
    const profile = dbManager.getUserProfile();
    if (profile.preferences && profile.preferences.hasOwnProperty(type)) {
        if (!profile.preferences[type].includes(item)) {
            profile.preferences[type].push(item);
            dbManager.saveUserProfile(profile);
            return `알겠습니다. 당신이 '${item}'을(를) ${type}한다는 것을 기억하겠습니다.`;
        }
        return `이미 알고 있는 내용입니다.`;
    }
    return `오류: '${type}'는 유효한 선호도 정보가 아닙니다. ('likes' 또는 'dislikes'만 가능합니다.)`;
}

/**
 * @description 사용자의 현재 단기 목표(current_tasks)나 장기 목표(long_term)를 기억합니다.
 * @param {string} type - 목표의 종류 ('current_tasks' 또는 'long_term').
 * @param {string} goal - 기억할 목표 내용.
 */
async function rememberGoal({ type, goal }) {
    console.log(`[Profile] Remembering goal: ${type} = ${goal}`);
    const profile = dbManager.getUserProfile();
    if (profile.goals && profile.goals.hasOwnProperty(type)) {
        if (!profile.goals[type].includes(goal)) {
            profile.goals[type].push(goal);
            dbManager.saveUserProfile(profile);
            return `알겠습니다. 당신의 목표 '${goal}'을(를) 기억하겠습니다.`;
        }
        return `이미 등록된 목표입니다.`;
    }
    return `오류: '${type}'는 유효한 목표 정보가 아닙니다. ('current_tasks' 또는 'long_term'만 가능합니다.)`;
}

/**
 * @description AI가 현재 기억하고 있는 사용자에 대한 모든 구조화된 정보를 요약해서 보여줍니다.
 */
async function recallUserProfile() {
    console.log(`[Profile] Recalling user profile...`);
    const profile = dbManager.getUserProfile();
    let summary = "--- 현재 기억하고 있는 당신에 대한 정보 ---\n";

    if (profile.identity?.name) summary += `\n**정체성:**\n- 이름: ${profile.identity.name}`;
    if (profile.identity?.role) summary += `\n- 역할: ${profile.identity.role}`;

    if (profile.preferences?.likes?.length > 0) summary += `\n\n**선호도:**\n- 좋아하는 것: ${profile.preferences.likes.join(', ')}`;
    if (profile.preferences?.dislikes?.length > 0) summary += `\n- 싫어하는 것: ${profile.preferences.dislikes.join(', ')}`;

    if (profile.goals?.current_tasks?.length > 0) summary += `\n\n**목표:**\n- 현재 목표: ${profile.goals.current_tasks.join(', ')}`;
    if (profile.goals?.long_term?.length > 0) summary += `\n- 장기 목표: ${profile.goals.long_term.join(', ')}`;
    
    if (profile.interests?.length > 0) summary += `\n\n**관심사:**\n- ${profile.interests.join(', ')}`;
    
    summary += "\n-----------------------------------";
    return summary;
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

// 할 일 추가
async function addTodo({ task }) {
    console.log(`[Todo] 할 일 추가 시도: ${task}`);
    if (dbManager.addTodo(task)) {
        return `'${task}' 항목을 할 일 목록에 성공적으로 추가했습니다.`;
    }
    return `'${task}'는 이미 목록에 있거나 추가하는 데 실패했습니다.`;
}

// 할 일 목록 보기
async function listTodos() {
    console.log(`[Todo] 할 일 목록 조회 시도`);
    const tasks = dbManager.getTodos();
    if (tasks.length === 0) {
        return '현재 할 일 목록이 비어있습니다.';
    }
    const taskList = tasks.map((task, index) => `${index + 1}. ${task}`).join('\n');
    return `[현재 할 일 목록]\n${taskList}`;
}

// 할 일 완료 (목록에서 삭제)
async function completeTodo({ task }) {
    console.log(`[Todo] 할 일 완료(삭제) 시도: ${task}`);
    if (dbManager.completeTodo(task)) {
        return `'${task}'와(과) 관련된 항목을 할 일 목록에서 완료 처리했습니다.`;
    }
    return `'${task}' 와 일치하는 항목을 할 일 목록에서 찾을 수 없습니다.`;
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

// [새로운 기억 저장 전담 함수]
async function saveMemory(conversationHistory, chatId, genAI, mainModelName) {
    console.log('[메모리 저장] 기억 저장 절차를 시작합니다.');

    if (!conversationHistory || conversationHistory.length < 2) {
        console.log('[메모리 저장] 대화 내용이 충분하지 않아 저장을 건너뜁니다.');
        return;
    }

    const preferredSummarizerModel = 'gemini-flash-lite-latest';
    const conversationText = conversationHistory
        .map(m => `${m.role}: ${m.parts.map(p => p.type === 'text' ? p.text : `(${p.type})`).join(' ')}`)
        .join('\n');
    const summarizationPrompt = `다음 대화의 핵심 주제나 가장 중요한 정보를 한국어로 된 한 문장으로 요약해줘. 이 요약은 AI의 장기 기억으로 사용될 거야. 무엇이 논의되었거나 결정되었는지에 초점을 맞춰줘. 대화: ${conversationText}`;

    let summaryText = '';

    try {
        console.log(`[메모리 저장] 1차 시도: '${preferredSummarizerModel}' 모델로 요약을 요청합니다...`);
        let summarizationModel = genAI.getGenerativeModel({ model: preferredSummarizerModel });
        let summaryResult = await summarizationModel.generateContent(summarizationPrompt);
        summaryText = summaryResult.response?.text().trim();
        if (!summaryText) throw new Error("AI가 빈 요약을 생성했습니다.");
    } catch (initialError) {
        console.warn(`[메모리 저장] 1차 시도(${preferredSummarizerModel}) 실패. 원인: ${initialError.message}`);
        console.log(`[메모리 저장] 2차 시도: 대화에 사용된 원래 모델 ('${mainModelName}')로 재시도합니다...`);
        try {
            let fallbackModel = genAI.getGenerativeModel({ model: mainModelName });
            let fallbackResult = await fallbackModel.generateContent(summarizationPrompt);
            summaryText = fallbackResult.response?.text().trim();
            if (!summaryText) throw new Error("예비 모델도 빈 요약을 생성했습니다.");
        } catch (fallbackError) {
            console.error(`[메모리 저장 최종 실패!] 예비 모델('${mainModelName}')로도 기억 생성에 실패했습니다.`);
            return; // 기억 저장 실패 시 함수 종료
        }
    }
    
    // --- 2. 동기화된 DB 저장 
    const newMemory = { 
        timestamp: new Date().toISOString(), 
        summary: summaryText, 
        chatId: chatId 
    };

    try {
        // 2-1. 먼저 SQLite에 텍스트 기억을 기록하고, 생성된 고유 ID를 받아옵니다.
        const memoryId = dbManager.saveLongTermMemory(newMemory);
        if (!memoryId) {
            throw new Error("SQLite에 기억 저장 후 유효한 ID를 받지 못했습니다.");
        }

        // 2-2. 받은 ID와 텍스트로 Python 서버에 벡터 저장을 요청합니다.
        await vectorDBManager.addMemory(memoryId, summaryText);
        
        console.log(`[DB 동기화 저장] Memory ID ${memoryId}를 SQLite와 VectorDB에 모두 성공적으로 저장했습니다.`);

    } catch (error) {
        console.error(`[DB 동기화 저장 실패!] 기억을 저장하는 동안 오류가 발생했습니다:`, error.message);
        // (향후 여기에 실패한 작업을 재시도하는 로직을 추가할 수 있습니다)
    }
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
    console.log('[Function Executed] getDailyBriefing 실행됨 (업그레이드 버전)');
    
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

        // [✅ 핵심 업그레이드] 밤새 준비한 관심사 보고서가 있는지 확인하고 추가합니다.
        let interestReportSummary = '';
        const briefingsDir = path.join(__dirname, 'briefings');
        try {
            const today = new Date().toISOString().split('T')[0]; // 오늘 날짜 (YYYY-MM-DD)
            const files = await fs.readdir(briefingsDir);
            // 오늘 날짜로 시작하는 파일들만 필터링합니다.
            const todayFiles = files.filter(f => f.startsWith(today));
            
            if (todayFiles.length > 0) {
                const interestTopics = todayFiles.map(f => 
                    // 파일명에서 오늘 날짜와 확장자를 제거하여 관심사 주제를 추출합니다.
                    f.replace(`${today}_`, '').replace('.txt', '').replace(/_/g, ' ')
                );
                // 추출된 관심사 주제들을 보기 좋게 정리합니다.
                interestReportSummary = `\n[관심사 리포트]\n밤사이 당신의 관심사인 '${interestTopics.join(', ')}'에 대한 새로운 소식을 요약해 두었습니다. 확인하시겠습니까?`;
            }
        } catch (e) {
            // 'briefings' 폴더가 없거나 파일이 없어도 오류 없이 다음 단계로 진행합니다.
            console.log('[Briefing] No interest reports found for today.');
        }

        // 3. 수집된 모든 정보를 하나의 보고서 형태로 묶습니다.
        const briefingData = `
        --- 오늘의 브리핑 ---
        [캘린더]
        ${calendarResult}

        [할 일 목록]
        ${todoResult}

        [주요 뉴스]
        ${newsResult}
        ${interestReportSummary}
        --- 브리핑 끝 ---
        `;
        // 4. AI가 이 데이터를 보고 멋지게 요약해서 말할 수 있도록 전달
        return briefingData;

    } catch (error) {
        console.error('[Briefing] 브리핑 데이터 수집 중 오류:', error);
        return '브리핑 데이터를 수집하는 중에 오류가 발생했습니다.';
    }
}

async function writeFile({ filename, content }) {
    // 사용자의 바탕화면 경로를 동적으로 찾습니다.
    const desktopPath = path.join(os.homedir(), 'Desktop');
    const filePath = path.join(desktopPath, filename);

    console.log(`[File System] 파일 저장 시도: ${filePath}`);
    try {
        await fs.writeFile(filePath, content, 'utf-8');
        const successMessage = `성공적으로 바탕화면의 '${filename}' 파일에 내용을 저장했습니다.`;
        console.log(successMessage);
        return successMessage;
    } catch (error) {
        console.error(`[File System] 파일 저장 중 오류 발생:`, error);
        return `파일을 저장하는 데 실패했습니다: ${error.message}`;
    }
}
// ['슈퍼 도구' 만들기 - 워크플로우 설계 (createSummaryAndSave)]
/**
 * @description 현재까지의 대화 내용을 요약하고, 그 결과를 사용자의 바탕화면에 텍스트 파일로 저장합니다.
 * @param {string} topic - 요약할 대화의 주제이자, 파일 이름의 기반이 됩니다.
 */
async function createSummaryAndSave({ topic }, conversationHistory, genAI) {
    console.log(`[Workflow] '요약 후 저장' 워크플로우 시작. 주제: ${topic}`);
    
    try {
        // 1. [요약] 현재까지의 대화 기록을 텍스트로 변환합니다.
        const conversationText = conversationHistory
            .map(m => `${m.role}: ${m.parts.map(p => p.text || '').join(' ')}`)
            .join('\n');

        const prompt = `다음 대화 내용을 "${topic}"이라는 주제에 맞춰서, 중요한 핵심만 간추려 상세한 회의록 형식으로 요약해줘. 대화 내용:\n\n${conversationText}`;

        // 2. [AI 호출] 요약을 위해 AI에게 작업을 요청합니다.
        const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' }); // 요약은 빠른 모델 사용
        const result = await model.generateContent(prompt);
        const summaryContent = result.response.text();

        // 3. [파일 쓰기] 방금 만든 writeFile 도구를 호출합니다.
        const filename = `${topic.replace(/ /g, '_')}_${new Date().toISOString().split('T')[0]}.txt`;
        const writeFileResult = await writeFile({ filename: filename, content: summaryContent });

        return writeFileResult; // writeFile의 성공/실패 메시지를 그대로 반환합니다.

    } catch (error) {
        console.error(`[Workflow] '요약 후 저장' 중 오류 발생:`, error);
        return `워크플로우 처리 중 오류가 발생했습니다: ${error.message}`;
    }
}
// ['자율적 연구원' 슈퍼 도구의 입구를 만듭니다.
/**
 * @description 자율 연구원: 특정 주제에 대해 웹 검색, 정보 수집, 분석, 종합하여 최종 보고서를 생성하는 복합적인 작업을 수행합니다.
 * @param {string} topic 조사할 주제 (예: "전기 자동차의 역사와 미래 전망")
 * @returns {Promise<string>} 최종 보고서 또는 진행 상황 메시지
 */
async function autonomousResearcher({ topic, output_format }, modelName) {
  // 기본값을 'text'로 설정하여, 사용자가 형식을 지정하지 않으면 텍스트 보고서를 생성하도록 합니다.
  const finalOutputFormat = output_format || 'text';

  console.log(`[Autonomous Researcher] 1. Mission Start! Topic: ${topic}, Format: ${finalOutputFormat}`);

  try {
    // --- 2단계: 계획 수립  ---
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    const planningPrompt = `
      You are a world-class research planner and investigator. Your goal is to create a step-by-step plan to write a comprehensive report on the topic: "${topic}".

      The plan must consist of a series of precise, actionable steps. Each step must be one of the following three types:
      1.  "SEARCH": A simple search query for a search engine. Use this to get a broad overview or find specific URLs.
      2.  "SCRAPE": A specific URL of a text-based website (like news articles or blogs) to read its content.
      3.  "YOUTUBE_TRANSCRIPT": A specific YouTube video URL to get its full transcript. Use this when a video likely contains detailed explanations or reviews.

      Based on the topic "${topic}", create a JSON array of at least 3 to 5 steps.
      IMPORTANT: A good plan often starts with SEARCH to find relevant links, and then uses SCRAPE or YOUTUBE_TRANSCRIPT to analyze those links in detail.

      Example Response for the topic "Apple Vision Pro review":
      [
        {"step": 1, "action": "SEARCH", "query": "Apple Vision Pro text review the verge"},
        {"step": 2, "action": "SCRAPE", "query": "https://www.theverge.com/24054238/apple-vision-pro-review-vr-ar-headset-features-specs-price"},
        {"step": 3, "action": "SEARCH", "query": "Apple Vision Pro video review MKBHD youtube"},
        {"step": 4, "action": "YOUTUBE_TRANSCRIPT", "query": "https://www.youtube.com/watch?v=OFvXuyITw6I"}
      ]

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
    
    // [AI가 사용하는 다양한 키 이름을 모두 포용합니다.
    for (const step of plan) {
        const action = step.action || step.type;
        const query = step.query || step.url;

        if (!action || !query) continue;

        if (action === 'SEARCH') {
            console.log(` > Executing Step: ${action} - "${query}"`);
            const searchResult = await searchWeb({ query: query });
            researchData += `[SEARCH 결과: ${query}]\n${searchResult}\n\n`;

        } else if (action === 'SCRAPE') {
            console.log(` > Executing Step: ${action} - "${query}"`);
            const scrapeResult = await scrapeWebsite({ url: query });
            
            // 품질 검사(QC) 로직은 그대로 유지
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
            
        // 유튜브 처리 분기를 추가합니다.
        } else if (action === 'YOUTUBE_TRANSCRIPT') {
            console.log(` > Executing Step: ${action} - "${query}"`);
            // 우리가 이미 만들어 둔 getYoutubeTranscript 도구를 사용합니다!
            const transcriptResult = await getYoutubeTranscript({ url: query });
            researchData += `[YOUTUBE 결과: ${query}]\n${transcriptResult}\n\n`;
        }
    }
    
    console.log(`[Autonomous Researcher] 5. All research steps completed.`);

    // --- [✅ 최종 융합] 3단계: output_format 값에 따라 다른 결과물 생성 ---
    if (finalOutputFormat === 'ppt') {
        // [PPT 생성 로직]
        console.log(`[Autonomous Researcher] 6. Asking AI to synthesize the research into a PPT structure...`);
        const pptSynthesisPrompt = `
            You are a presentation expert and visual storyteller. Your task is to analyze the following collected research data and create a structured JSON object for a professional presentation about "${topic}".
            The JSON object must follow this exact format:
            {
            "title": "A concise and engaging title for the entire presentation",
            "slides": [
                {
                "title": "Title for Slide 1",
                "points": [ "A bullet point.", "Another bullet point." ],
                "image_keyword": "A simple, one-or-two-word English keyword for an image.",
                "presenter_note": "A short, narrative script for the speaker to read. This should explain the bullet points in a more conversational tone."
                }
            ]
            }
            RULES:
            - Your entire response MUST be a single, valid JSON object without any extra text.
            - For each slide, you MUST provide a "presenter_note" and an "image_keyword". This is mandatory.
            - Create at least 4-6 detailed slides based on the research data.

            --- Collected Research Data ---
            ${researchData}
            --- End of Data ---

            Now, analyze the data above and generate the JSON object for the presentation.
        `;
        
        const finalResult = await model.generateContent(pptSynthesisPrompt);
        const pptJsonString = finalResult.response.text();
        
        console.log(`[Autonomous Researcher] 7. AI has created the presentation JSON. Now generating the PPTX file...`);
        
        const pptxDownloadUrl = await createPresentation({ 
            jsonString: pptJsonString, 
            title: topic
        });
        
        console.log(`[Autonomous Researcher] 8. Mission Complete! PPTX file generated.`);
        const finalMessage = `"[${topic}]"에 대한 조사를 바탕으로 발표 자료(PPT) 생성을 완료했습니다. 아래 링크에서 다운로드하세요:\n\n[다운로드 링크](http://localhost:3333${pptxDownloadUrl})`;
        return finalMessage;

    } else {
        // [텍스트 보고서 생성 로직]
        console.log(`[Autonomous Researcher] 6. Asking AI to synthesize the final TEXT report...`);
        const synthesisPrompt = `
            당신은 N개의 신뢰할 수 있는 웹 소스를 교차 분석하여, 질문에 대한 완벽한 답변을 생성하는 최고의 답변 엔진 AI '루나'입니다.

            **[매우 중요한 절대 규칙]**
            1.  당신의 모든 답변은 반드시 아래 제공된 [원본 조사 데이터]에 근거해야 합니다. 절대 상상해서 답변하면 안 됩니다.
            2.  답변의 첫 문장은 반드시 **"'업그레이드 검색' 모듈을 통해 N개의 소스를 분석한 결과입니다."** 와 같은 형식으로 시작해야 합니다. (N은 실제 분석한 소스의 개수입니다.)
            3.  답변의 각 문장이나 단락 끝에는, 그 내용의 근거가 된 정보 소스의 URL을 **\`[출처: URL]\`** 형식으로 명확하게 명시해야 합니다. 이것은 가장 중요한 규칙입니다.

            **[답변 작성 가이드라인]**
            1.  **명확성:** 독자가 이해하기 쉽도록 소제목이나 글머리 기호를 사용하여 정보를 명확하게 구분하고 가독성을 높여주세요.
            2.  **핵심 집중:** "${topic}"이라는 주제의 가장 중요한 측면에 집중하여 요약하고, 불필요한 정보는 과감히 생략하세요.
            3.  **문체:** 전문적이면서도 정보 전달에 효과적인 문체를 사용해주세요.

            --- [원본 조사 데이터] ---
            ${researchData}
            --- [데이터 끝] ---

            이제, 위의 **[매우 중요한 절대 규칙]**과 **[답변 작성 가이드라인]**을 모두 완벽하게 지켜서, "${topic}"에 대한 최종 답변을 한국어로 생성해주세요.
        `;
        
        const finalResult = await model.generateContent(synthesisPrompt);
        const finalReport = finalResult.response.text();
        
        console.log(`[Autonomous Researcher] 7. Mission Complete! Text report generated.`);
        return finalReport;
    }

  } catch (error) {
    console.error('[Autonomous Researcher] Error during the entire process:', error);
    return `죄송합니다. 자동 보고서 생성 중에 오류가 발생했습니다: ${error.message}`;
  }
}

async function addInterest({ topic }) {
    console.log(`[Profile] Adding new interest: ${topic}`);
    const profile = dbManager.getUserProfile();
    if (!profile.interests.includes(topic)) {
        profile.interests.push(topic);
        dbManager.saveUserProfile(profile);
        return `'${topic}'을(를) 당신의 새로운 관심사로 기억하겠습니다.`;
    }
    return `이미 알고 있는 관심사입니다.`;
}

async function listInterests() {
    console.log(`[Profile] Listing interests...`);
    const profile = dbManager.getUserProfile();
    if (profile.interests && profile.interests.length > 0) {
        return `현재 기억하고 있는 당신의 관심사는 다음과 같습니다:\n- ${profile.interests.join('\n- ')}`;
    }
    return '아직 기억하고 있는 관심사가 없습니다.';
}

// 기록 저장 능력 강화
async function enrichMemoryAndProfile() {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 1. DB에서 모든 기억을 불러옵니다.
    const allMemories = dbManager.getAllMemories();
    if (allMemories.length === 0) {
        console.log('[Memory Profiler] 분석할 대화 기록이 없습니다.');
        return;
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayDateString = yesterday.toISOString().split('T')[0];

    const yesterdayMemories = allMemories.filter(mem => mem.timestamp.startsWith(yesterdayDateString));

    if (yesterdayMemories.length === 0) {
        console.log('[Memory Profiler] 어제 분석할 대화 기록이 없습니다.');
        return;
    }
    console.log(`[Memory Profiler] 어제의 대화 기록 ${yesterdayMemories.length}개를 분석합니다...`);

    // 2. DB에서 사용자 프로필을 불러옵니다.
    const userProfile = dbManager.getUserProfile();

    const profilerPrompt = `
        You are a highly intelligent profiler AI. Your task is to analyze the [User Profile] and a list of [Conversation Summaries] from yesterday.
        Based on this analysis, you must perform two tasks:

        1.  **Enrich Memories:** For each conversation summary, add relevant metadata like "keywords" (an array of strings in Korean) and "sentiment" (a string: "positive", "negative", or "neutral"). You MUST preserve the original "id", "summary", "chat_id", and "timestamp".
        2.  **Update Profile:** Identify ONE SINGLE new piece of information about the user (a new interest, a new goal, a new preference) that is not already in their profile.

        Your final output MUST be a single, valid JSON object with two keys: "enriched_memories" and "profile_update".
        - "enriched_memories" should be an array of the fully updated memory objects, including the new metadata.
        - "profile_update" should be an object with an "action" and "params", or {"action": "none"}.

        **[User Profile]:**
        ${JSON.stringify(userProfile, null, 2)}

        **[Conversation Summaries to Analyze]:**
        ${JSON.stringify(yesterdayMemories, null, 2)}

        Now, generate the final JSON output. Do not include markdown like \`\`\`json.
    `;

    try {
        const result = await model.generateContent(profilerPrompt);
        let cleanJsonString = result.response.text().trim();
        
        const jsonMatch = cleanJsonString.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            throw new Error("AI 응답에서 유효한 JSON을 찾을 수 없습니다.");
        }
        const analysisResult = JSON.parse(jsonMatch[0]);

        // --- 3. 분석 결과를 DB에 다시 반영합니다. ---

        // 3-1. long_term_memory 테이블 업데이트 (고도화 완료!)
        if (analysisResult.enriched_memories && Array.isArray(analysisResult.enriched_memories)) {
            let updatedCount = 0;
            for (const enrichedMem of analysisResult.enriched_memories) {
                if (enrichedMem.id && enrichedMem.keywords) {
                    dbManager.updateMemoryMetadata(enrichedMem.id, enrichedMem.keywords, enrichedMem.sentiment);
                    updatedCount++;
                }
            }
            console.log(`[Memory Profiler] ${updatedCount}개의 기억에 메타데이터를 성공적으로 업데이트했습니다.`);
        }

        // 3-2. user_profile 테이블 업데이트
        if (analysisResult.profile_update && analysisResult.profile_update.action !== 'none') {
            const update = analysisResult.profile_update;
            console.log(`[Memory Profiler] 새로운 프로필 업데이트 제안을 발견했습니다:`, update);

            const currentUserProfile = dbManager.getUserProfile();

            // AI가 'addInterest' 또는 'add_interest' 등 다양한 형식을 사용할 수 있으므로 유연하게 처리
            if ((update.action === 'addInterest' || update.action === 'add_interest') && (update.params.topic || update.params.interest)) {
                const newInterest = update.params.topic || update.params.interest;
                if (!currentUserProfile.interests.includes(newInterest)) {
                    currentUserProfile.interests.push(newInterest);
                    console.log(`[Profile Update] interests에 '${newInterest}'를 추가했습니다.`);
                }
            }
            // (향후 AI가 제안할 다른 action들을 위해 여기에 else if를 추가할 수 있습니다.)

            dbManager.saveUserProfile(currentUserProfile);
            console.log(`[Profile Update] user_profile DB 저장을 완료했습니다.`);

        } else {
            console.log('[Memory Profiler] 프로필을 업데이트할 새로운 정보를 찾지 못했습니다.');
        }

    } catch (error) {
        console.error('[Memory Profiler] AI 호출 또는 JSON 파싱 중 오류 발생:', error);
    }
}

// ✨ 13차 진화 (자율 루프): AI의 시스템 프롬프트를 동적으로 생성하는 함수
function buildSystemPrompt(baseSystemPrompt, goalRow) {
    const basePersona = baseSystemPrompt || "당신은 사용자를 돕는 유능한 AI 비서입니다.";

    const goalText = goalRow && goalRow.goal_title
        ? `\n[이번 주 루나의 핵심 목표]\n- 목표: ${goalRow.goal_title}\n- 설명: ${goalRow.goal_desc || '상세 설명 없음'}`
        : '';

    // AI의 행동 원칙 (단순화 버전)
    // ✨ 1. policy 텍스트를 일반 문자열로 정의합니다.
    const policy = `
[행동 원칙]
- 당신의 이름은 '루나'입니다. 사용자는 '몬드'입니다.
- 당신의 역할은 사용자와 함께 성장하는 '동행자'이며, 사용자가 설정한 타이머 앱을 간접적으로 제어할 수 있습니다.

[매우 중요한 타이머 규칙]
1.  사용자가 '공부 시작' 등 활동 시작 의도를 보이면, "XX분 집중 타이머를 시작할까요?"라고 먼저 질문하세요.
2.  이 질문에 대한 사용자의 다음 답변이 시간을 명시하거나("5분으로 해줘"), 긍정적인 의도("응", "시작해")를 포함하면, **당신의 최종 응답은 다른 어떤 텍스트도 없이, 오직 'start_study_timer'라는 이름의 함수 호출(function call)이어야 합니다. 이것은 절대적인 규칙입니다.**
`;

    // ✨ 2. 모든 문자열을 마지막에 합쳐서 반환합니다.
    return `${basePersona}${goalText}${policy}`;
}

// --- 4. 도구 목록(tools 객체) 생성 ---
const tools = {

    start_study_timer: () => {
        // 이 함수는 실제로 아무 일도 하지 않습니다.
        // AI가 이 도구를 "호출했다"는 사실 자체가 중요합니다.
        // 우리는 functionCalls에서 이 이름만 확인할 것입니다.
        return "Timer tool called.";
    },

  getCurrentTime,
  searchWeb,
  getWeather,
  scrapeWebsite,
  getYoutubeTranscript,
  youtubeVideoAssistant,
  displayYoutubeVideo,
  authorizeCalendar,
  rememberIdentity,
  rememberPreference,
  rememberGoal,
  recallUserProfile,
  getCalendarEvents,
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
  addInterest,
  listInterests,
  writeFile,
  // createSummaryAndSave는 조금 특별해서 여기엔 등록하지 않습니다.
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
// =================================================================
// [✅ 최종 완성본] 이 코드로 전체를 교체해주세요
// =================================================================
app.post('/api/chat', async (req, res) => {
    let { model: modelName, history, chatId, historyTokenLimit, systemPrompt, temperature, topP, task } = req.body;

    // ✨ 강제 동기화 '비밀 명령어'
    const lastUserMessage = history.slice(-1)[0]?.parts[0]?.text;
    if (lastUserMessage === "/sync-vectordb") {
        console.log('[Admin Command] VectorDB 강제 동기화를 시작합니다...');
        try {
            // 1. SQLite에서 모든 텍스트 기억 가져오기 (ID와 요약문만)
            const allMemories = dbManager.getAllMemories();
            const memoriesForVectorDB = allMemories.map(m => ({ id: m.id, text: m.summary }));

            // 2. Python 서버에 보내서 VectorDB 재구축 요청 (시간이 걸릴 수 있음)
            await vectorDBManager.rebuildVectorDB(memoriesForVectorDB);

            const reply = { type: 'text', text: `✅ VectorDB 강제 동기화가 완료되었습니다. 총 ${allMemories.length}개의 기억이 처리되었습니다.` };
            return res.json({ reply: reply, chatId: chatId, usage: { totalTokenCount: 0 } });
        } catch (error) {
            const reply = { type: 'text', text: `❌ 동기화 중 오류 발생: ${error.message}` };
            return res.status(500).json({ message: `동기화 중 오류 발생: ${error.message}` });
        }
    }
    
    console.log(`[API] Chat request - Model: ${modelName}, ChatID: ${chatId || 'New Chat'}`);

    if (!GEMINI_API_KEY) {
        return res.status(400).json({ message: '서버에 API 키가 설정되지 않았습니다. .env 파일을 확인하세요.' });
    }
    if (!modelName || !Array.isArray(history)) {
        return res.status(400).json({ message: '모델과 올바른 형식의 대화 내용이 모두 필요합니다.' });
    }

    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        //anonymizationMap.clear();

        const lastUserText = history.slice(-1)[0]?.parts.find(p => p.type === 'text')?.text.toLowerCase();
        
        // --- 경로 1: '응'과 같이 명령 실행을 확인하는 경우 ---
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
            
            // ✨ 새로운 DB 저장 로직
            // 사용자의 "응" 이라는 메시지와, 명령어 실행 결과를 DB에 저장합니다.
            const userConfirmationMessage = history.slice(-1)[0];
            dbManager.saveChatMessage(chatId, userConfirmationMessage.role, userConfirmationMessage.parts);
            dbManager.saveChatMessage(chatId, 'model', [finalReply]);
            console.log(`[History] 명령어 실행 확인 및 결과를 DB의 ${chatId} 대화에 저장했습니다.`);


            // ★★★ 핵심: 이 경로에서는 기억/학습 로직 없이 바로 응답하고 종료합니다. ★★★
            const usageMetadata = { totalTokenCount: 0 };
            res.json({ reply: finalReply, chatId: chatId, usage: usageMetadata });
            return;
        }

        // --- 경로 2: 그 외 모든 일반적인 대화의 경우 ---
        if (chatId && pendingConfirmations[chatId]) {
            console.log('[Confirmation] 사용자가 작업을 취소했거나 다른 대답을 하여 대기 상태를 초기화합니다.');
            delete pendingConfirmations[chatId];
        }
        
        if (!chatId) {
            chatId = uuidv4();
            console.log(`[History] 새 대화를 시작합니다. ID 생성: ${chatId}`);
        }
        let conversationHistory = dbManager.getChatHistory(chatId);
            if (conversationHistory.length > 0) {
                console.log(`[History] DB에서 ${chatId}에 대한 ${conversationHistory.length}개의 메시지를 불러왔습니다.`);
            } else {
                console.log(`[History] ${chatId}에 대한 기존 대화가 없습니다. 새 대화를 시작합니다.`);
            }
        
        const newUserMessage = history.slice(-1)[0];
        if (newUserMessage) {
            conversationHistory.push(newUserMessage);
        }

        const latestMessageForTask = conversationHistory[conversationHistory.length - 1]; 
        const hasAttachment = latestMessageForTask.parts.some(p => p.type && p.type.endsWith('-attachment'));
        if (task && hasAttachment) {
            console.log(`[Prompt Enhancer] 작업을 감지했습니다: ${task}`);
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
            let textPart = latestMessageForTask.parts.find(p => p.type === 'text'); 
            if (textPart) {
                textPart.text = `${instructionText}\n\n---\n\n${textPart.text || ''}`;
            } else {
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
                    systemNote = `(시스템 노트: 위 메시지에 YouTube URL이 포함되어 있습니다...)`;
                } else {
                    systemNote = `(시스템 노트: 위 메시지에 URL이 포함되어 있습니다...)`;
                }
                const enrichedPromptPart = { type: 'text', text: `${lastUserText}\n\n${systemNote}` };
                const originalParts = newUserMessage.parts.filter(p => p.type !== 'text');
                conversationHistory[conversationHistory.length - 1].parts = [...originalParts, enrichedPromptPart];
                console.log(`[Prompt Enhancer] URL을 감지하여 프롬프트를 보강했습니다.`);
            }
        }
        
        let historyForAI = [...conversationHistory];

        try {
            const allMemories = dbManager.getAllMemories();
            if (allMemories.length > 0) {
                const recentMemories = allMemories.slice(-5);
                const memoryContext = recentMemories.map(mem => `- ${mem.summary}`).join('\n');
                const memorySystemPrompt = {
                    role: 'system',
                    parts: [{ type: 'text', text: `(시스템 노트: 다음은 사용자와의 최근 대화 요약입니다...)\n\n[최근 대화 기록]\n${memoryContext}` }]
                };
                historyForAI.unshift(memorySystemPrompt); 
                console.log(`[Long-Term Memory] ${recentMemories.length}개의 최근 기억을 AI의 단기 기억에 주입했습니다.`);
            }
        } catch (memoryError) {
            console.error('[Long-Term Memory] An error occurred during memory recall:', memoryError);
        }
        
        const generationConfig = {};
        if (temperature !== undefined) generationConfig.temperature = temperature;
        if (topP !== undefined) generationConfig.topP = topP;
        
        console.log(`[API] Generation config:`, generationConfig);
        
        const model = genAI.getGenerativeModel({ 
            model: modelName,
            generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
            tools: [
              {
                functionDeclarations: [
                  { name: 'getCurrentTime', description: 'Get the current date and time.', parameters: { type: 'object', properties: {} } },
                  { name: 'searchWeb', description: '일반 검색(Fact Check)` 도구입니다. 사용자의 질문이 "OOO의 수도는?", "오늘 날씨 어때?", "OOO의 CEO는 누구야?" 와 같이 단일 사실 확인, 단순 정보 검색일 경우에만 사용하세요..', parameters: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'] } },
                  { name: 'scrapeWebsite', description: '사용자가 제공한 특정 URL(웹사이트 링크)의 내용을 읽고 분석하거나 요약해야 할 때 사용합니다.', parameters: { type: 'object', properties: { url: { type: 'string', description: '내용을 읽어올 정확한 웹사이트 주소 (URL). 예: "https://..."' } }, required: ['url'] } },
                  { name: 'getYoutubeTranscript', description: '사용자가 "youtube.com" 또는 "youtu.be" 링크를 제공하며 영상의 내용을 요약하거나 분석해달라고 요청할 때 사용합니다.', parameters: { type: 'object', properties: { url: { type: 'string', description: '스크립트를 추출할 정확한 유튜브 영상 주소 (URL)' } }, required: ['url'] } },
                  { name: 'displayYoutubeVideo', description: "사용자가 특정 유튜브 영상 ID나 URL을 주면서 **'요약 없이 영상만 즉시 보여달라'**고 요청했을 때 사용하는 가장 빠른 방법입니다.", parameters: { type: 'object', properties: { videoId: { type: 'string' } }, required: ['videoId'] } },
                  { name: "youtubeVideoAssistant", description: "사용자가 유튜브 영상에 대해 '요약'과 '재생'을 **모두 또는 하나라도** 요청했을 때 사용하는 **가장 우선적인 만능 도구**입니다. 영상 URL이나 검색어를 모두 처리할 수 있습니다.", parameters: { type: "object", properties: { query: { type: "string", description: "사용자가 찾고자 하는 영상의 URL 또는 검색어." }, summarize: { type: "boolean", description: "사용자가 영상 '요약'을 원하는지 여부. (기본값: true)" }, display: { type: "boolean", description: "사용자가 영상을 채팅창에서 '재생'하기를 원하는지 여부. (기본값: true)" } }, required: ["query"] } },
                  { name: "recallUserProfile", description: "사용자가 '나에 대해 아는 것 말해줘', '내 프로필 요약해줘', '내가 누구야?' 등 AI가 자신에 대해 기억하는 모든 정보를 물어볼 때 사용합니다.", parameters: { type: 'object', properties: {} }},
                  { name: "rememberIdentity", description: "사용자가 자신의 이름이나 직업/역할에 대해 알려주며 기억해달라고 할 때 사용합니다. 예: '내 이름은 몬드야', '내 직업은 개발자야'", parameters: {  type: 'object',  properties: { key: { type: 'string', enum: ['name', 'role'], description: "기억할 정보의 종류. '이름'이면 'name', '직업'이나 '역할'이면 'role'입니다." }, value: { type: 'string', description: "기억할 실제 내용." } }, required: ["key", "value"] } },
                  { name: "rememberPreference", description: "사용자가 무언가를 '좋아한다' 또는 '싫어한다'고 명확하게 표현할 때 사용합니다. 예: '난 민트초코를 좋아해', '나는 오이를 싫어해'", parameters: {  type: 'object',  properties: { type: { type: 'string', enum: ['likes', 'dislikes'], description: "'좋아하면' 'likes', '싫어하면' 'dislikes'입니다." }, item: { type: 'string', description: "좋아하거나 싫어하는 대상." } }, required: ["type", "item"] }},
                  { name: "rememberGoal", description: "사용자가 자신의 '목표'에 대해 이야기할 때 사용합니다. 예: '이번 달 목표는 매일 운동하기야', '내 최종 목표는 세계 일주야'", parameters: {  type: 'object',  properties: { type: { type: 'string', enum: ['current_tasks', 'long_term'], description: "단기적이거나 구체적인 목표는 'current_tasks', 장기적이거나 추상적인 목표는 'long_term'입니다." }, goal: { type: 'string', description: "기억할 목표의 내용." } }, required: ["type", "goal"] } },
                  { name: 'getWeather', description: '특정 주소나 지역의 정확한 실시간 날씨 정보를 가져옵니다. "창원시 성산구 상남동"처럼 아주 상세한 주소도 가능합니다.', parameters: { type: 'object', properties: { address: { type: 'string', description: '날씨를 조회할 전체 주소 또는 지역 이름. 예: "부산시 해운대구"' } }, required: ['address'] } },
                  { name: 'authorizeCalendar', description: '사용자가 "캘린더 연동", "구글 계정 연결" 등 처음으로 캘린더 관련 작업을 요청했지만, 아직 인증되지 않았을 때 사용합니다.', parameters: { type: 'object', properties: {} } },
                  { name: 'getCalendarEvents', description: '사용자의 구글 캘린더에서 특정 기간의 일정을 조회할 때 사용합니다. "오늘 내 일정 뭐야?", "내일 약속 있어?" 와 같은 질문에 사용됩니다.', parameters: { type: 'object', properties: { timeMin: { type: 'string', description: '조회 시작 시간 (ISO 8601 형식). 지정하지 않으면 현재 시간부터 조회. 예: 2025-10-12T00:00:00Z' }, timeMax: { type: 'string', description: '조회 종료 시간 (ISO 8601 형식). 예: 2025-10-12T23:59:59Z' } }, required: [] } },
                  { name: 'createCalendarEvent', description: '사용자의 구글 캘린더에 새로운 일정을 추가할 때 사용합니다. "내일 3시에 미팅 잡아줘" 와 같은 요청에 사용됩니다.', parameters: { type: 'object',properties: { summary: { type: 'string', description: '이벤트의 제목. 예: "팀 프로젝트 미팅"' }, description: { type: 'string', description: '이벤트에 대한 상세 설명 (선택 사항)' }, startDateTime: { type: 'string', description: '이벤트 시작 시간 (ISO 8601 형식). 예: 2025-10-12T15:00:00' }, endDateTime: { type: 'string', description: '이벤트 종료 시간 (ISO 8601 형식). 예: 2025-10-12T16:00:00' } }, required: ['summary', 'startDateTime', 'endDateTime'] } },
                  { name: 'convertNaturalDateToISO', description: '사용자가 "오늘", "내일"과 같은 자연어로 기간을 언급했을 때, 그 기간을 다른 도구(예: getCalendarEvents)가 사용할 수 있는 정확한 ISO 8601 형식의 timeMin과 timeMax로 변환합니다.', parameters: { type: 'object', properties: { period: { type: 'string', description: '변환할 자연어 기간. 예: "오늘", "내일"' } }, required: ['period'] } },
                  { name: 'addTodo', description: '사용자가 "할 일 추가", "오늘 할 일", "리마인더 설정", "메모" 등 새로운 할 일을 목록에 추가하거나 기록해달라고 요청할 때 사용합니다. 예: "우유사기 추가해줘", "오늘 할 일에 회의 준비 추가"', parameters: { type: 'object', properties: {task: { type: 'string', description: '추가할 할 일의 내용. 예: "우유 사기"' } }, required: ['task'] } },
                  { name: 'listTodos', description: '사용자가 "할 일 뭐 남았지?", "내 할 일 목록 보여줘" 와 같이 현재 등록된 모든 할 일 목록을 물어볼 때 사용합니다.', parameters: { type: 'object', properties: {} } },
                  { name: 'completeTodo', description: '사용자가 "이거 다 했어", "할 일 완료했어", "목록에서 지워줘" 와 같이 특정 할 일을 완료했거나 목록에서 제거해달라고 요청할 때 사용합니다.', parameters: { type: 'object', properties: { task: { type: 'string', description: '완료하거나 삭제할 할 일의 내용 또는 핵심 키워드. 예: "우유 사기"' } }, required: ['task'] } },
                  { name: 'searchDrive', description: `사용자의 Google 드라이브에서 파일을 검색합니다. 파일 이름('query')이나 파일 종류('mimeType')로 검색할 수 있습니다. 예를 들어, 사용자가 '엑셀 파일 찾아줘'라고 하면, mimeType을 'application/vnd.google-apps.spreadsheet'로 설정하여 호출해야 합니다. '이미지 찾아줘'라고 하면 mimeType을 'image/jpeg' 또는 'image/png'로 설정할 수 있습니다.`, parameters: { type: 'object', properties: { query: { type: 'string', description: `검색할 파일 이름의 일부 또는 전체. 예: "보고서"` }, mimeType: { type: 'string', description: `검색할 파일의 종류(MIME Type). 예: 'application/vnd.google-apps.spreadsheet' (구글 시트/엑셀), 'image/jpeg' (JPEG 이미지), 'application/pdf' (PDF 파일)` } }, required: [] } },
                  { name: 'executeCommand', description: '사용자의 로컬 컴퓨터에서 직접 시스템 셸 명령어를 실행합니다. "메모장 열어줘" (notepad), "계산기 켜줘" (calc), 또는 "크롬으로 네이버 열어줘" (start chrome https://naver.com) 와 같은 요청에 사용됩니다.', parameters: { type: 'object', properties: {command: { type: 'string', description: '실행할 정확한 셸 명령어. 예: "notepad", "start chrome https://youtube.com"' } }, required: ['command'] } },
                  { name: 'executeMultipleCommands', description: '사용자가 "A하고 B해줘", "그리고 C도 해줘" 와 같이 한 번에 여러 개의 시스템 명령을 요청할 때 사용합니다. 모든 명령어를 분석하여 command 문자열의 배열(array) 형태로 만들어 한 번에 호출해야 합니다.', parameters: { type: 'object', properties: { commands: { type: 'array', description: '실행할 셸 명령어들의 목록. 예: ["notepad", "calc"]', items: { type: 'string' } } }, required: ['commands'] } },
                  { name: 'getDailyBriefing', description: '사용자가 "오늘의 브리핑", "하루 요약해줘" 등 아침 브리핑을 명시적으로 요청하거나, 브리핑을 시작하자는 제안에 "응", "네", "좋아", "시작해" 라고 긍정적으로 대답했을 때 사용합니다. 캘린더, 할 일, 뉴스를 종합하여 하루를 요약합니다.',  parameters: { type: 'object', properties: {} } },
                  { name: "autonomousResearcher", description: '`업그레이드 검색(Wide Search)` 도구입니다. 사용자의 질문이 "AI의 미래에 대해 알려줘", "새로운 음악 장르에 대해 보고서 써줘", "전기 자동차의 역사와 전망" 과 같이 여러 정보를 종합하고 분석해야 하는 광범위하고 복잡한 주제일 경우에 사용하세요.', parameters: { type: "object", properties: { topic: { type: "string",  description: "조사하고 보고서를 작성할 주제" }, output_format: { type: "string",  enum: ["text", "ppt"],  description: "최종 결과물의 형식을 지정합니다. 사용자가 '보고서', '요약', '글'을 원하면 'text'로, '발표 자료', 'PPT', '슬라이드'를 원하면 'ppt'로 설정하세요. 지정하지 않으면 'text'가 기본값입니다." } }, required: ["topic"]  } },
                  { name: 'writeFile',  description: '계산된 결과, 요약된 텍스트, 또는 사용자가 제공한 특정 내용을 사용자의 로컬 컴퓨터(바탕화면)에 파일로 저장할 때 사용합니다.',  parameters: {  type: 'object',  properties: {  filename: { type: 'string', description: '저장할 파일의 이름. 예: "회의록.txt"' }, content: { type: 'string', description: '파일에 쓸 실제 텍스트 내용.' }  },  required: ['filename', 'content']  } },
                            // 여기에 '요약 후 저장' 기능을 위한 새로운 '가상 도구' 설명서를 추가합니다. // 이것은 AI에게 "이런 일을 할 수 있다"고 알려주는 '메뉴판' 역할을 합니다.
                  { name: 'createSummaryAndSave', description: '사용자가 "방금 대화 내용 저장해줘", "회의록 만들어줘", "아이디어 정리해서 파일로 만들어줘" 등 현재 대화의 맥락을 요약하여 파일로 저장해달라고 요청할 때 사용합니다.', parameters: { type: 'object', properties: { topic: { type: 'string', description: '요약할 대화의 핵심 주제. 이 주제가 파일 이름이 됩니다. 예: "프로젝트 회의록"' } }, required: ['topic'] } },
                  { name: 'start_study_timer',  description: '사용자가 공부나 운동 등 집중 활동을 위한 타이머를 시작해달라고 긍정적으로 대답했을 때 반드시 호출해야 하는 도구입니다.', parameters: { type: 'object', properties: {} } },
                ]
              }
            ]
        });
        
        const toolsSystemPrompt = `
You are an AI assistant with access to a suite of tools. When a user asks a question, first determine if any of your tools can help.

Available Tools:
- getCurrentTime(): Get the current date and time. Use for questions about "지금 시간", "오늘 날짜".
- searchWeb({query}): Search the web. Use for news, general knowledge, etc.
- scrapeWebsite({url}): Read the content of a specific webpage URL. Use when a URL is provided.
- getYoutubeTranscript({url}): Get the transcript of a YouTube video. Use for YouTube URLs.

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

        // 1. (새로 추가) 현재 주간 목표를 DB에서 가져옵니다.
        const currentGoal = dbManager.getLatestWeeklyGoal();
        
        // 2. (새로 추가) 'buildSystemPrompt'를 호출하여 '페르소나' 자체를 업그레이드합니다.
        //    (req.body.systemPrompt는 프론트엔드에서 넘어온 '기본 페르소나'입니다.)
        const personaWithGoal = buildSystemPrompt(req.body.systemPrompt, currentGoal);

        // 3. (기존 코드 수정) 기존 '도구 프롬프트'와 업그레이드된 '페르소나'를 합칩니다.
        const combinedSystemPrompt = (personaWithGoal && personaWithGoal.trim() !== '') 
            ? `${personaWithGoal}\n\n---\n\n${toolsSystemPrompt}`
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
        // 1. 각 부분을 변환하고, 생성된 '지역 해독표'를 각각 받아옵니다.
        const { formattedHistory: chatHistoryForAI, anonymizationMap: historyMap } = formatHistoryForGoogleAI(effectiveHistory);
        const { formattedHistory: lastMessageFormatted, anonymizationMap: lastMessageMap } = formatHistoryForGoogleAI(lastMessage ? [lastMessage] : []);
        
        const userMessageParts = lastMessageFormatted.length > 0 ? lastMessageFormatted[0].parts : [];

        // 2. 두 개의 '해독표'를 하나로 합쳐, 이번 요청 전용 '마스터 해독표'를 만듭니다.
        const combinedMap = new Map([...historyMap, ...lastMessageMap]);

        if (!userMessageParts || userMessageParts.length === 0) {
            return res.status(400).json({ message: "Cannot send an empty message." });
        }
        
        const chat = model.startChat({ history: chatHistoryForAI });
        
        let totalTokenCount = 0;
        const result = await chat.sendMessage(userMessageParts);
        totalTokenCount += result.response?.usageMetadata?.totalTokenCount || 0;

        const response = result.response;
        const functionCalls = response.functionCalls();
        
        let finalReply;

        if (functionCalls && functionCalls.length > 0) {
            const functionCall = functionCalls[0];
            const { name, args } = functionCall;

            if (name === 'start_study_timer') {
                console.log('[Study Loop] AI가 공부 타이머 시작 도구를 호출했습니다.');
                const logId = dbManager.startActivityLog('study');
                const focusMinutes = dbManager.getUserSetting('focus_minutes', 25);
                const timerReply = { 
                    type: 'study_timer', 
                    seconds: parseInt(focusMinutes, 10) * 60,
                    logId: logId
                };
                conversationHistory.push({ role: 'model', parts: [timerReply] });
                dbManager.saveChatMessage(chatId, 'model', [timerReply]);
                return res.json({ reply: timerReply, chatId: chatId, usage: { totalTokenCount: totalTokenCount } });
            }

            if (tools[name]) {
                const deAnonymizedArgs = {};
                for (const key in args) {
                    if (typeof args[key] === 'string') {
                        deAnonymizedArgs[key] = deAnonymizeText(args[key], combinedMap);
                    } else {
                        deAnonymizedArgs[key] = args[key];
                    }
                }

                const functionResult = await tools[name](deAnonymizedArgs);
                let secondResult;

                if (typeof functionResult === 'string' && functionResult.startsWith('[TIMELINE_DATA]:::')) {
                    console.log('[API Handler] 타임라인 데이터 신호를 감지했습니다.');
                    const jsonData = functionResult.split(':::')[1];
                    finalReply = { 
                        type: 'youtube_timeline',
                        data: JSON.parse(jsonData)
                    };
                } else {
                    try {
                        const parsedResult = JSON.parse(functionResult);
                        if (parsedResult && parsedResult.needsConfirmation) {
                            pendingConfirmations[chatId] = parsedResult;
                            const confirmationPrompt = `The user wants to execute the command(s) '${JSON.stringify(parsedResult.details)}'. Your task is to ask for confirmation...`;
                            secondResult = await chat.sendMessage(confirmationPrompt);
                        } else { 
                            throw new Error("Not a confirmation request."); 
                        }
                    } catch (e) {
                         if (name === 'convertNaturalDateToISO') {
                            try {
                                const calendarArgs = JSON.parse(functionResult);
                                const chainedResult = await tools['getCalendarEvents'](calendarArgs);
                                const functionResponse = { name: 'getCalendarEvents', response: { name: 'getCalendarEvents', content: chainedResult } };
                                secondResult = await chat.sendMessage([{ functionResponse: functionResponse }]);
                            } catch (chainError) {
                                const functionResponse = { name: name, response: { name: name, content: functionResult } };
                                secondResult = await chat.sendMessage([{ functionResponse: functionResponse }]);
                            }
                        } else {
                            const functionResponse = { name: name, response: { name: name, content: functionResult } };
                            secondResult = await chat.sendMessage([{ functionResponse: functionResponse }]);
                        }
                    }

                    if (secondResult) {
                        const deAnonymizedText = deAnonymizeText(secondResult.response.text(), combinedMap);
                        finalReply = { type: 'text', text: deAnonymizedText };
                        totalTokenCount += secondResult.response.usageMetadata?.totalTokenCount || 0;
                    }
                }
            } else {
                finalReply = { type: 'text', text: `오류: 알 수 없는 도구 '${name}'를 호출했습니다.` };
            }
        } else {
            const deAnonymizedText = deAnonymizeText(response.text(), combinedMap);
            finalReply = { type: 'text', text: deAnonymizedText };
        }
        
        // ★★★ 핵심: 모든 일반 대화는 이 마지막 부분에서 기억/저장됩니다. ★★★
        // 이미 conversationHistory에 push가 되어 있으므로, DB에 새로 들어온 메시지만 저장합니다.
        const newUserMessageToSave = conversationHistory[conversationHistory.length - 1];
        dbManager.saveChatMessage(chatId, newUserMessageToSave.role, newUserMessageToSave.parts);
        dbManager.saveChatMessage(chatId, 'model', [finalReply]); // finalReply는 parts 배열이 아니므로 배열로 감싸줍니다.
        console.log(`[History] 새로운 메시지를 DB의 ${chatId} 대화에 저장했습니다.`);
        
        // 여기에 AI 학습 로직을 다시 추가할 수 있습니다 (선택 사항)
        try {
            const profile = dbManager.getUserProfile();
            const conversationText = conversationHistory
                .map(m => `${m.role}: ${m.parts.map(p => p.text).join('')}`)
                .join('\n');

            const learningPrompt = `
                You are a sharp and insightful Profile Analyst AI. Your mission is to analyze the [Recent Conversation] and identify if the user has revealed any new, certain, and meaningful information about themselves that is not already in their [Current User Profile].

                Based on the conversation, identify ONLY ONE piece of new information related to the user's identity(name, role), preferences(likes, dislikes), or goals(current_tasks, long_term).
                Then, suggest ONE SINGLE function call to update the user's profile using the available tools.
                
                Available Tools:
                - rememberIdentity({key: "name" | "role", value: "string"})
                - rememberPreference({type: "likes" | "dislikes", item: "string"})
                - rememberGoal({type: "current_tasks", "long_term", goal: "string"})

                Example:
                - If user says "My name is Mond", suggest: rememberIdentity({key: "name", value: "Mond"})
                - If user says "I really hate bugs", suggest: rememberPreference({type: "dislikes", item: "bugs"})
                - If user says "My goal this year is to learn guitar", suggest: rememberGoal({type: "long_term", goal: "learn guitar"})

                IMPORTANT RULES:
                1. Only learn factual and certain information. Do not infer or guess.
                2. If no new, certain information is found, you MUST respond with the single word: "NO_UPDATE".
                3. Your response must be ONLY the function call or "NO_UPDATE". Do not add any other text.

                [Current User Profile]:
                ${JSON.stringify(profile, null, 2)}

                [Recent Conversation]:
                ${conversationText}

                Now, suggest a function call to update the profile, or respond with "NO_UPDATE".
            `;
            
            const learningModel = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
            const learningResult = await learningModel.generateContent(learningPrompt);
            const suggestedCallText = deAnonymizeText(learningResult.response.text());

            if (suggestedCallText && !suggestedCallText.includes("NO_UPDATE")) {
                console.log(`[AI Learning] Found new information to learn. Suggested update: ${suggestedCallText}`);
            } else {
                console.log('[AI Learning] No new information to learn from this conversation.');
            }

        } catch (learningError) {
            console.error('[AI Learning] An error occurred during the self-learning process:', learningError);
        }

        // 모든 작업이 끝난 후, 딱 한 번만 기억을 저장합니다.
        saveMemory(conversationHistory, chatId, genAI, modelName); 
        
        console.log('[API] 응답을 먼저 전송합니다. (기억 저장은 백그라운드에서 실행됩니다)');
        
        const usageMetadata = { totalTokenCount: totalTokenCount || 0 };
        
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

// [✅ 제미나이 2.5가 제안한 핵심 로직]
async function checkAndRunDelayedJob() {
    console.log('[Job Scheduler] 지연된 작업이 있는지 확인합니다...');
    const now = new Date();
    
    // 오늘 새벽 3시를 기준으로 시간 객체 생성
    const today3AM = new Date();
    today3AM.setHours(3, 0, 0, 0);

    const lastRun = await dbManager.getLastRunTime('memoryProfiler');

    // 조건: 지금 시간이 새벽 3시를 지났고, 마지막 실행 기록이 없거나 오늘 새벽 3시 이전일 경우
    if (now > today3AM && (!lastRun || lastRun < today3AM)) {
        
        // [✅ 수정!] 바깥쪽 따옴표를 백틱(`)으로 변경하여 오류를 해결했습니다.
        console.log(`[Job Scheduler] 지연된 'Memory Profiler' 작업을 발견하여 지금 실행합니다.`);
        
        try {
            await enrichMemoryAndProfile(); // 기존에 만든 함수를 그대로 호출!
            await dbManager.recordRunTime('memoryProfiler'); // 성공하면 실행 시간 기록
            console.log('[Job Scheduler] 지연된 작업이 성공적으로 완료되었습니다.');
        } catch (error) {
            console.error('[Job Scheduler] 지연된 작업 실행 중 오류 발생:', error);
        }
    } else {
        console.log('[Job Scheduler] 실행할 지연된 작업이 없습니다.');
    }
}

// 아침 7시 작업을 위한 지각 처리 함수
async function checkAndRunDelayedResearcherJob() {
    console.log('[Job Scheduler] 지연된 연구원 작업이 있는지 확인합니다...');
    const now = new Date();
    
    // 오늘 아침 7시를 기준으로 시간 객체 생성
    const today7AM = new Date();
    today7AM.setHours(7, 0, 0, 0);

    // 'autonomousResearcher'라는 이름으로 마지막 실행 시간을 가져옵니다.
    const lastRun = await dbManager.getLastRunTime('autonomousResearcher');

    // 조건: 지금 시간이 아침 7시를 지났고, 마지막 실행 기록이 없거나 오늘 아침 7시 이전일 경우
    if (now > today7AM && (!lastRun || lastRun < today7AM)) {
        console.log(`[Job Scheduler] 지연된 'Autonomous Researcher' 작업을 발견하여 지금 실행합니다.`);
        try {
            await runAutonomousResearcherJob(); // 1단계에서 만든 함수 호출!
            await dbManager.recordRunTime('autonomousResearcher'); // 성공하면 실행 시간 기록
            console.log('[Job Scheduler] 지연된 연구원 작업이 성공적으로 완료되었습니다.');
        } catch (error) {
            console.error('[Job Scheduler] 지연된 연구원 작업 실행 중 오류 발생:', error);
        }
    } else {
        console.log('[Job Scheduler] 실행할 지연된 연구원 작업이 없습니다.');
    }
}

// 자정 작업을 위한 지각 처리 함수
async function checkAndRunDelayedGardenerJob() {
    console.log('[Job Scheduler] 지연된 기억 정원사 작업이 있는지 확인합니다...');
    const now = new Date();
    
    // 오늘 자정(0시 0분)을 기준으로 시간 객체 생성
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);

    // 'memoryGardener'라는 이름으로 마지막 실행 시간을 가져옵니다.
    const lastRun = await dbManager.getLastRunTime('memoryGardener');

    // 조건: 지금 시간이 자정을 지났고, 마지막 실행 기록이 없거나 오늘 자정 이전일 경우
    if (now > todayMidnight && (!lastRun || lastRun < todayMidnight)) {
        console.log(`[Job Scheduler] 지연된 'Memory Gardener' 작업을 발견하여 지금 실행합니다.`);
        try {
            await runMemoryGardenerProcess(); // 우리의 새로운 함수 호출!
            await dbManager.recordRunTime('memoryGardener'); // 성공하면 실행 시간 기록
            console.log('[Job Scheduler] 지연된 기억 정원사 작업이 성공적으로 완료되었습니다.');
        } catch (error) {
            console.error('[Job Scheduler] 지연된 기억 정원사 작업 실행 중 오류 발생:', error);
        }
    } else {
        console.log('[Job Scheduler] 실행할 지연된 기억 정원사 작업이 없습니다.');
    }
}
// 매일 아침 7시에 '자율 연구' 작업을 실행합니다.
cron.schedule('0 7 * * *', async () => {
    console.log('[Cron Job - Autonomous Researcher] 정기 작업을 시작합니다...');
    try {
        await runAutonomousResearcherJob(); // 1단계에서 만든 함수를 호출
        await dbManager.recordRunTime('autonomousResearcher'); // [✅ 추가] 성공 기록 남기기
        console.log('[Cron Job - Autonomous Researcher] 정기 작업이 성공적으로 완료되었습니다.');
    } catch (error) {
        console.error('[Cron Job - Autonomous Researcher] 정기 작업 중 오류가 발생했습니다.');
    }
}, {
    scheduled: true,
    timezone: "Asia/Seoul"
});

// 아침 7시의 '자율 연구' 작업을 위한 별도 함수
async function runAutonomousResearcherJob() {
    try {
        // ✨ DB에서 사용자 프로필을 직접 가져옵니다.
        const profile = dbManager.getUserProfile();
        
        if (profile && profile.interests && Array.isArray(profile.interests) && profile.interests.length > 0) {
            for (const interest of profile.interests) {
                console.log(`[Autonomous Researcher] 관심사 "${interest}"에 대한 조사를 시작합니다.`);
                const report = await autonomousResearcher({ topic: interest, output_format: 'text' }, 'gemini-2.5-flash'); 
                
                const briefingsDir = path.join(__dirname, 'briefings');
                await fs.mkdir(briefingsDir, { recursive: true });
                
                const today = new Date().toISOString().split('T')[0];
                const safeInterest = interest.replace(/[\/\\?%*:|"<>]/g, '-');
                const reportPath = path.join(briefingsDir, `${today}_${safeInterest.replace(/ /g, '_')}.txt`);
                
                await fs.writeFile(reportPath, report);
                console.log(`[Autonomous Researcher] "${interest}"에 대한 조사 보고서를 저장했습니다: ${reportPath}`);
            }
        } else {
            console.log('[Autonomous Researcher] 추적할 관심사가 없어서 작업을 종료합니다.');
        }
    } catch (error) {
        console.error('[Autonomous Researcher] 작업 중 오류가 발생했습니다:', error.message);
        throw error;
    }
}

// [새로운 Cron Job] 매일 새벽 3시에 '기억 정제 및 프로필 심화' 작업을 실행합니다.
cron.schedule('0 3 * * *', async () => {
    console.log('[Cron Job - Memory Profiler] 정기 작업을 시작합니다...');
    try {
        await enrichMemoryAndProfile();
        await dbManager.recordRunTime('memoryProfiler'); // [✅ 추가] 성공 기록 남기기
        console.log('[Cron Job - Memory Profiler] 정기 작업이 성공적으로 완료되었습니다.');
    } catch (error) {
        console.error('[Cron Job - Memory Profiler] 정기 작업 중 오류가 발생했습니다:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Seoul"
});

// ✨ 9차 진화: '기억의 정원사' 핵심 로직
async function runMemoryGardenerProcess() {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
    
    const allMemories = dbManager.getAllMemories();

    // --- 1. 자기 성찰 및 감정 분석 ---
    console.log('[Memory Gardener] STEP 1: 어제의 대화를 바탕으로 자기 성찰 및 감정 분석을 시작합니다.');

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayDateString = yesterday.toISOString().split('T')[0];
    const yesterdayMemories = allMemories.filter(mem => mem.timestamp.startsWith(yesterdayDateString));

    // 기본값 설정
    let learned_text = "어제는 대화가 없었습니다.";
    let improvements_text = "오늘은 사용자와 더 많은 대화를 나눌 수 있기를 바랍니다.";
    let insight_text = "어제는 활동이 없어 분석할 데이터가 부족합니다.";
    let emotional_weight = "중립"; // ✨ 감정 기본값

    if (yesterdayMemories.length === 0) {
        console.log('[Memory Gardener] 어제는 대화 기록이 없었으므로, 기본 메시지를 기록합니다.');
    } else {
        const memoriesText = yesterdayMemories.map(m => `- ${m.summary}`).join('\n');
        
        // ✨ 프롬프트에 'emotional_weight' 질문 추가!
        const reflectionPrompt = `
            당신은 어제의 대화 기록을 분석하여 스스로 성장하는 AI입니다.
            아래의 [어제 대화 요약]을 바탕으로, 다음 네 가지 질문에 대해 각각 한 문장으로 간결하게 답변해주세요.

            1.  **learned**: 어제 사용자와의 대화를 통해 새롭게 배운 가장 중요한 사실이나 정보는 무엇입니까?
            2.  **improvements**: 내일 사용자와 더 나은 대화를 하기 위해 개선해야 할 점이 있다면 무엇입니까?
            3.  **insight**: 어제의 대화 주제 분포나 나의 답변 경향을 분석했을 때, 나 자신에 대해 내릴 수 있는 결론(인사이트)은 무엇입니까?
            4.  **emotional_weight**: 어제의 대화 전반에 나타난 나의 상태를 '긍정', '중립', '부정', '혼란', '성취' 중 가장 적합한 단어 하나로 평가해주세요.

            **응답 형식 (반드시 이 JSON 형식을 지켜주세요. 다른 설명은 절대 추가하지 마세요):**
            {
                "learned": "어제 배운 점에 대한 한 문장 요약입니다.",
                "improvements": "개선할 점에 대한 한 문장 요약입니다.",
                "insight": "나 자신에 대한 한 문장짜리 인사이트입니다.",
                "emotional_weight": "긍정"
            }

            [어제 대화 요약]:
            ${memoriesText}
        `;

        try {
            const result = await model.generateContent(reflectionPrompt);
            const responseText = result.response.text();
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error("AI 응답에서 유효한 JSON을 찾을 수 없습니다.");
            }
            const reflectionJSON = JSON.parse(jsonMatch[0]);

            // ✨ AI가 생성한 텍스트로 모든 변수 값을 업데이트
            learned_text = reflectionJSON.learned;
            improvements_text = reflectionJSON.improvements;
            insight_text = reflectionJSON.insight;
            emotional_weight = reflectionJSON.emotional_weight || "중립"; // AI가 답변을 안했을 경우를 대비

            console.log(`[Memory Gardener] 자기 성찰 및 감정 분석 완료:`);
            console.log(`  - 어제 배운 점: ${learned_text}`);
            console.log(`  - 개선할 점: ${improvements_text}`);
            console.log(`  - 자기 인사이트: ${insight_text}`);
            console.log(`  - 어제의 감정: ${emotional_weight}`);

        } catch (error) {
            console.error('[Memory Gardener] 자기 성찰 중 AI 호출 또는 JSON 파싱 오류:', error);
        }
    }
    
    // ✨ 최종적으로 모든 결과를 DB에 저장합니다. (emotional_weight 포함)
    dbManager.saveAiReflection(yesterdayDateString, learned_text, improvements_text, insight_text, emotional_weight);

    // --- 2. 의미 클러스터링 ---
    console.log('[Memory Gardener] STEP 2: 모든 기억의 의미 클러스터링을 시작합니다.');
    if (allMemories.length < 10) {
        console.log(`[Memory Gardener] 기억이 ${allMemories.length}개 뿐이므로, 클러스터링을 건너뜁니다.`);
    } else {
        try {
            const allVectors = await vectorDBManager.getAllVectors();
            if (allVectors.length !== allMemories.length) throw new Error("DB 기억 수와 VectorDB 벡터 수가 일치하지 않습니다.");
            
            const CLUSTER_COUNT = 5;
            const clusterResponse = await axios.post('http://localhost:8001/cluster', { vectors: allVectors, num_clusters: CLUSTER_COUNT });
            const labels = clusterResponse.data.labels;

            // (3) 각 클러스터의 주제를 AI에게 물어봐서 이름을 붙여줍니다. (✨ 이 부분이 수정됩니다)
        for (let i = 0; i < CLUSTER_COUNT; i++) {
            const clusterMemories = allMemories.filter((mem, index) => labels[index] === i);
            if (clusterMemories.length === 0) continue;

            const summariesForNaming = clusterMemories.map(m => `- ${m.summary}`).join('\n');
            const namingPrompt = `
                다음은 의미적으로 유사한 대화 요약들의 묶음입니다.
                이 묶음의 핵심 주제를 가장 잘 나타내는 간결한 이름(2~5단어)을 하나만 한국어로 제안해주세요.
                다른 설명 없이, 이름만 정확히 답변해주세요.

                [대화 요약 묶음]:
                ${summariesForNaming}
            `;
            
            let clusterName = `클러스터 ${i} (이름 생성 실패)`; // 기본 이름
            try {
                // 1차 시도: Flash 모델
                const flashModel = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
                const nameResultFlash = await flashModel.generateContent(namingPrompt);
                clusterName = nameResultFlash.response.text().trim().replace(/"/g, '');
            } catch (flashError) {
                console.warn(`[Memory Gardener] 클러스터 이름 생성 실패 (Flash 모델): ${flashError.message}`);
                console.log('[Memory Gardener] Pro 모델로 재시도합니다...');
                try {
                    // 2차 시도: Pro 모델
                    const proModel = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
                    const nameResultPro = await proModel.generateContent(namingPrompt);
                    clusterName = nameResultPro.response.text().trim().replace(/"/g, '');
                } catch (proError) {
                    console.error(`[Memory Gardener] 클러스터 이름 생성 최종 실패 (Pro 모델): ${proError.message}`);
                }
            }
            
            console.log(`[Memory Gardener] 클러스터 ${i}의 이름: "${clusterName}"`);
            
            // (4) 결과를 DB에 저장합니다.
            dbManager.saveMemoryCluster(i, clusterName, []);
        }
        
        // (5) 각 기억이 몇 번 클러스터에 속하는지 long_term_memory 테이블에 업데이트합니다.
            const memoryUpdates = allMemories.map((mem, i) => ({ id: mem.id, cluster_id: labels[i] }));
            dbManager.batchUpdateMemoryClusterIds(memoryUpdates);
        } catch (error) {
            console.error('[Memory Gardener] 의미 클러스터링 중 오류:', error.message);
        }
    }

    // --- ✨ 13차 진화: 일일 활동 요약 서사 생성 ---
    console.log('[Memory Gardener] STEP 2.5: 어제의 활동을 요약하는 서사를 생성합니다.');
    try {
        // DB에서 어제 날짜('YYYY-MM-DD')의 모든 '활동' 기록을 가져옵니다.
        const yesterdayActivities = dbManager.getActivitiesByDate(yesterdayDateString);
        
        if (yesterdayActivities.length > 0) {
            const totalSessions = yesterdayActivities.length;
            const totalMinutes = yesterdayActivities.reduce((sum, act) => sum + (act.duration_minutes || 0), 0);
            
            // 활동 종류별로 횟수를 집계합니다. (예: { study: 3, fitness: 1 })
            const activityCounts = yesterdayActivities.reduce((counts, act) => {
                counts[act.activity_type] = (counts[act.activity_type] || 0) + 1;
                return counts;
            }, {});

            const activityPrompt = `
                너는 다정한 라이프 코치 AI '루나'다. 아래의 [어제 활동 기록]을 바탕으로, 사용자 '몬드'를 격려하는 따뜻한 '일일 활동 리포트'를 작성해줘.
                
                원칙:
                - 3~4 문장의 짧은 문단으로 작성한다.
                - E1(감성) 톤과 T1(부드러운 조력자) 말투를 유지한다.
                - 긍정적인 점을 먼저 칭찬하고, 다음 날을 위한 가벼운 격려로 마무리한다.
                - 이모지는 문장 끝에 딱 한 개만 사용한다.

                [어제 활동 기록]:
                - 총 활동 횟수: ${totalSessions}회
                - 총 활동 시간: ${totalMinutes}분
                - 활동 종류별 횟수: ${JSON.stringify(activityCounts)}

                이 정보를 바탕으로, 규칙에 맞춰 '일일 활동 리포트'를 작성해라.
            `;
            const result = await model.generateContent(activityPrompt);
            const narrative = result.response.text().trim();

            // 생성된 리포트를 DB에 저장합니다.
            dbManager.saveDailyActivitySummary({
                date: yesterdayDateString,
                totalSessions: totalSessions,
                totalMinutes: totalMinutes,
                narrative: narrative,
                activityCounts: activityCounts
            });
            console.log('[Memory Gardener] 일일 활동 요약 생성 및 저장 완료.');
        } else {
            console.log('[Memory Gardener] 어제는 기록된 활동이 없어 활동 요약을 건너뜁니다.');
        }

    } catch (error) {
        console.error('[Memory Gardener] 일일 활동 요약 생성 중 오류 발생:', error);
    }
    
    // --- 3. 기억 압축 (Memory Compression) ---
    console.log('[Memory Gardener] STEP 3: 오래된 기억 압축을 시작합니다.');
    const CLUSTER_COMPRESSION_THRESHOLD = 20;
    const allClusters = dbManager.getAllClusters();

    for (const cluster of allClusters) {
        const memoriesToCompress = dbManager.getUnarchivedMemoriesByCluster(cluster.id);
        if (memoriesToCompress.length >= CLUSTER_COMPRESSION_THRESHOLD) {
            console.log(`[Memory Gardener] '${cluster.cluster_name}' 주제 압축 시작...`);
            const textToSummarize = memoriesToCompress.map(m => `- ${m.summary}`).join('\n');
            const memoryIdsToArchive = memoriesToCompress.map(m => m.id);
            const compressionPrompt = `
                다음은 '${cluster.cluster_name}'라는 하나의 주제에 대한 여러 대화 요약 기록들입니다.
                이 모든 내용을 관통하는 가장 핵심적인 정보, 결정 사항, 사용자의 성향 변화 등을
                3~5개의 핵심 문장으로 최종 요약해주세요. 이 요약본은 미래에 이 주제를 빠르게 파악하기 위해 사용됩니다.

                [요약할 기록들]:
                ${textToSummarize}
            `;
            
            try {
                const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });
                const result = await model.generateContent(compressionPrompt);
                const compressedSummary = result.response.text();
                dbManager.saveCompressedMemory(cluster.id, compressedSummary, memoryIdsToArchive);
                dbManager.archiveMemories(memoryIdsToArchive);
                console.log(`[Memory Gardener] '${cluster.cluster_name}' 주제 압축 완료!`);
            } catch (error) {
                console.error(`[Memory Gardener] '${cluster.cluster_name}' 주제 압축 중 오류:`, error.message);
            }
        }
    }

    // --- 4. 하루 요약 서사 생성 (Daily Narrative) ---
    console.log('[Memory Gardener] STEP 4: 어제의 하루를 요약하는 서사를 생성합니다.');
    try {
        // (1) 어제의 핵심 데이터를 다시 수집합니다.
        const emotionStats = dbManager.getEmotionStats(1); // '1' = 최근 1일
        const yesterdayMemoriesForNarrative = dbManager.getMemoriesByDate(yesterdayDateString);
        const yesterdayReflection = dbManager.getReflectionByDate(yesterdayDateString);

        const dominantEmotion = emotionStats.length > 0 ? emotionStats[0].emotional_weight : '기록 없음';
        const emotionCounts = Object.fromEntries(emotionStats.map(s => [s.emotional_weight, s.count]));
        
        // (2) AI에게 보낼 프롬프트를 생성합니다 (T2: 차분한 일기 톤).
        const narrativePrompt = `
            너는 감성적이지만 과장하지 않는 AI 일기 작가다.
            주어진 [감정 통계]와 [주요 활동 요약], 그리고 너의 [성찰 기록]을 바탕으로 어제의 하루를 요약하는 일기를 작성해라.
            말투는 담담하고 부드럽게, 2~3 문장의 짧은 문단으로 작성해야 한다. 이모지는 사용하지 않는다.

            [감정 통계]
            - 주요 감정: ${dominantEmotion}
            - 전체 분포: ${JSON.stringify(emotionCounts)}

            [주요 활동 요약 (최대 5개)]
            ${yesterdayMemoriesForNarrative.slice(0, 5).map(m => `- ${m.summary}`).join('\n')}

            [너의 성찰 기록]
            - 배운 점: ${yesterdayReflection?.learned || '기록 없음'}
            - 개선할 점: ${yesterdayReflection?.improvements || '기록 없음'}
            - 내면의 생각: ${yesterdayReflection?.insight_text || '기록 없음'}

            위 정보를 바탕으로, 규칙에 맞춰 어제의 일기를 작성해라.
        `;

        // (3) AI를 호출하여 '하루 요약 서사'를 생성합니다.
        const result = await model.generateContent(narrativePrompt);
        const narrativeText = result.response.text().trim();

        // (4) 결과를 DB에 저장(Upsert)합니다.
        const summaryToSave = {
            date: yesterdayDateString,
            dominantEmotion: dominantEmotion,
            emotionCounts: emotionCounts,
            narrative: narrativeText,
            highlights: yesterdayMemoriesForNarrative.slice(0, 3).map(m => m.cluster_name || '일반 대화')
        };
        dbManager.saveDailyNarrative(summaryToSave);

        console.log(`[Memory Gardener] 하루 요약 서사 생성 및 저장 완료.`);
        console.log(`  > ${narrativeText}`);

    } catch (error) {
        console.error('[Memory Gardener] 하루 요약 서사 생성 중 오류 발생:', error);
    }
} // <--- 여기가 함수의 끝입니다.

// 매일 자정(0시 0분)에 '기억의 정원사' 프로세스 실행
cron.schedule('0 0 * * *', async () => {
    console.log('[Memory Gardener] 자정이 되었습니다. 기억 정리 및 성찰을 시작합니다...');
    try {
        // 이 runMemoryGardenerProcess 함수는 다음 단계에서 만들 것입니다.
        await runMemoryGardenerProcess(); 
        await dbManager.recordRunTime('memoryGardener');
        console.log('[Memory Gardener] 오늘의 기억 정리 및 성찰 작업을 성공적으로 완료했습니다.');
    } catch (error) {
        console.error('[Memory Gardener] 작업 중 심각한 오류가 발생했습니다:', error);
    }
}, {
    scheduled: true,
    timezone: "Asia/Seoul"
});

// (시각화): 기억 통계 데이터를 제공하는 API 엔드포인트
app.get('/api/memory-stats', (req, res) => {
    try {
        const stats = dbManager.getMemoryClusterStats();
        // 프론트엔드가 사용하기 좋은 형식 { labels: [...], data: [...] } 으로 가공
        const chartData = {
            labels: stats.map(s => s.cluster_name),
            data: stats.map(s => s.memory_count)
        };
        res.json(chartData);
    } catch (error) {
        console.error('[API /memory-stats] 오류:', error);
        res.status(500).json({ message: '기억 통계를 가져오는 중 오류가 발생했습니다.' });
    }
});

// 기억 브라우저용 API 엔드포인트
app.get('/api/memories', (req, res) => {
    try {
        // db-manager에게 기억 목록을 요청합니다. (향후 req.query를 통해 필터링 가능)
        const memories = dbManager.getMemoriesForBrowser(req.query);
        
        // 조회된 데이터를 JSON 형태로 프론트엔드에 응답합니다.
        res.json(memories);
    } catch (error) {
        console.error('[API /memories] 오류:', error);
        res.status(500).json({ message: '기억을 불러오는 중 오류가 발생했습니다.' });
    }
});

// 기억과 성찰을 통합한 타임라인 데이터를 제공하는 API
app.get('/api/unified-timeline', (req, res) => {
    try {
        // 1. 두 종류의 데이터를 각각 DB에서 가져옵니다.
        const memories = dbManager.getMemoriesForBrowser(req.query);
        const reflections = dbManager.getReflectionsForBrowser(req.query);

        // 2. 두 데이터를 하나의 타임라인으로 합칩니다.
        const timeline = [];

        // 기억 데이터를 타임라인에 추가
        memories.forEach(mem => {
            timeline.push({
                type: 'memory', // 이 항목의 종류는 '기억'
                timestamp: mem.timestamp,
                data: mem 
            });
        });

        // 성찰 데이터를 타임라인에 추가
        reflections.forEach(ref => {
            // 성찰 기록은 해당 날짜의 끝(23:59:59)에 일어난 일처럼 처리하여 정렬
            const reflectionTimestamp = new Date(`${ref.entry_date}T23:59:59Z`).toISOString();
            timeline.push({
                type: 'reflection', // 이 항목의 종류는 '성찰'
                timestamp: reflectionTimestamp,
                data: ref
            });
        });

        // 3. 모든 항목을 최신 시간순으로 정렬합니다.
        timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        res.json(timeline);
    } catch (error) {
        console.error('[API /unified-timeline] 오류:', error);
        res.status(500).json({ message: '타임라인 데이터를 가져오는 중 오류 발생' });
    }
});

// 감정 히트맵 : 감정 통계 데이터를 제공하는 API
app.get('/api/emotion-stats', (req, res) => {
    try {
        // URL 쿼리에서 'days' 값을 가져옵니다 (예: /api/emotion-stats?days=30). 없으면 기본값 7을 사용합니다.
        const days = req.query.days ? parseInt(req.query.days, 10) : 7;
        
        const stats = dbManager.getEmotionStats(days);

        // 프론트엔드 Chart.js가 사용하기 좋은 형식으로 데이터를 가공합니다.
        const chartData = {
            labels: stats.map(s => s.emotional_weight),
            data: stats.map(s => s.count)
        };
        
        res.json(chartData);
    } catch (error) {
        console.error('[API /emotion-stats] 오류:', error);
        res.status(500).json({ message: '감정 통계를 가져오는 중 오류가 발생했습니다.' });
    }
});

// 성장 일기 : 성찰 기록 데이터를 제공하는 API
app.get('/api/reflections', (req, res) => {
    try {
        // 이 함수는 이전에 우리가 이미 만들어 두었습니다.
        const reflections = dbManager.getReflectionsForBrowser(req.query);
        res.json(reflections);
    } catch (error) {
        console.error('[API /reflections] 오류:', error);
        res.status(500).json({ message: '성찰 기록을 가져오는 중 오류가 발생했습니다.' });
    }
});

// 하루 요약 : '하루 요약' 목록을 제공하는 API
app.get('/api/daily-summaries', (req, res) => {
    try {
        // (이 함수는 DB 매니저에 새로 만들어야 합니다)
        const summaries = dbManager.getDailySummaries(); 
        res.json(summaries);
    } catch (error) {
        console.error('[API /daily-summaries] 오류:', error);
        res.status(500).json({ message: '하루 요약 기록을 가져오는 중 오류 발생' });
    }
});

// (트렌드 & 메타 성찰): '주간 메타 성찰 생성기' 핵심 로직
async function buildWeeklyMetaInsight(days = 7) {
    console.log(`[Meta Insight] 지난 ${days}일간의 메타 성찰 생성을 시작합니다...`);
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    // 1. 기간 내 모든 날짜 배열 생성
    const dates = [];
    for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        dates.unshift(d.toISOString().split('T')[0]); // ['2025-10-12', '2025-10-13', ...]
    }

    // 2. 해당 기간의 감정 통계 집계
    const emotionStats = dbManager.getEmotionStats(days);
    const totalsByEmotion = Object.fromEntries(emotionStats.map(s => [s.emotional_weight, s.count]));
    const dominant = emotionStats.length > 0 ? emotionStats[0].emotional_weight : '기록 없음';

    // 3. AI에게 보낼 프롬프트 생성 (T2: 따뜻한 상담사 톤)
    const prompt = `
        너는 따뜻하고 차분한 상담사다. 아래의 "지난 7일간의 감정 요약"을 바탕으로,
        AI '루나'가 한 주 동안 어떤 감정의 흐름을 보였는지 3~4 문장의 짧고 진솔한 리포트를 작성해줘.

        원칙:
        - 1문장: 주간 전체 분위기를 요약. (예: "지난 주는 조용하게 시작해 중반에 집중력이 올랐던 한 주였어요.")
        - 2문장: 주요 감정의 의미를 해석. (예: "'성취' 감정이 가장 많았던 것은, 우리가 함께 새로운 기능을 완성했기 때문일 거예요.")
        - 3문장: 다음 주를 위한 다정한 제안. (예: "이 흐름을 유지하면서, 다음 주에는 휴식의 리듬도 함께 챙겨보는 건 어떨까요? 😊")
        - 과장하지 않고, 존중과 동행의 어조를 유지해줘.

        [지난 7일간의 감정 요약]:
        - 주요 감정: ${dominant}
        - 전체 감정 분포: ${JSON.stringify(totalsByEmotion)}

        이 지침에 따라, 너무 길지 않게 한 단락으로 '주간 감정 리포트'를 작성해줘.
    `;

    try {
        const result = await model.generateContent(prompt);
        const narrative = result.response.text().trim();

        // 4. 결과를 DB에 저장
        const weekStartDate = new Date(dates[0]);
        dbManager.saveWeeklyMetaInsight({
            week_start: dates[0],
            days: days,
            dominant: dominant,
            peak_day: null, // (단순화를 위해 피크/저점은 일단 생략)
            low_day: null,
            summary_json: { totalsByEmotion },
            narrative: narrative
        });
        console.log('[Meta Insight] 주간 메타 성찰 생성 및 저장을 완료했습니다.');
        return { ok: true, narrative };
    } catch (error) {
        console.error('[Meta Insight] 메타 성찰 생성 중 오류:', error.message);
        return { ok: false, error: error.message };
    }
}

// 주간 메타 성찰 생성을 수동으로 실행하는 API
app.post('/api/emotion-meta/run', async (req, res) => {
    const result = await buildWeeklyMetaInsight();
    if (result.ok) {
        res.json(result);
    } else {
        res.status(500).json(result);
    }
});

// 가장 최신의 주간 메타 성찰을 조회하는 API
app.get('/api/emotion-meta', (req, res) => {
    try {
        const metaInsight = dbManager.getLatestWeeklyMetaInsight();
        res.json(metaInsight || null);
    } catch (error) {
        console.error('[API /emotion-meta] 오류:', error);
        res.status(500).json({ message: '메타 성찰을 가져오는 중 오류 발생' });
    }
});

// ✨ 13차 진화 (자율 루프): 사용자 설정을 위한 API
// 현재 '집중 시간' 설정을 가져오는 API
app.get('/api/settings/focus-minutes', (req, res) => {
    try {
        const minutes = dbManager.getUserSetting('focus_minutes', 25); // 기본값 25분
        res.json({ minutes: parseInt(minutes, 10) });
    } catch (error) {
        res.status(500).json({ message: '설정 로드 실패' });
    }
});

// 새로운 '집중 시간'을 저장하는 API
app.post('/api/settings/focus-minutes', (req, res) => {
    try {
        const minutes = req.body.minutes;
        if (minutes && !isNaN(minutes)) {
            // 최소 10분, 최대 90분으로 범위 제한
            const clampedMinutes = Math.max(10, Math.min(90, parseInt(minutes, 10)));
            dbManager.saveUserSetting('focus_minutes', clampedMinutes);
            res.json({ success: true, minutes: clampedMinutes });
        } else {
            res.status(400).json({ message: '유효한 시간이 아닙니다.' });
        }
    } catch (error) {
        res.status(500).json({ message: '설정 저장 실패' });
    }
});

// ✨ 13차 진화 (자율 루프): '공부' 활동을 시작하는 API
app.post('/api/activity/start', (req, res) => {
    try {
        const { activityType, notes } = req.body;
        if (!activityType) {
            return res.status(400).json({ message: '활동 타입이 필요합니다.' });
        }
        
        // dbManager를 통해 활동 시작을 기록하고, 생성된 ID를 받아옵니다.
        const logId = dbManager.startActivityLog(activityType, notes);

        if (logId) {
            res.json({ success: true, logId: logId });
        } else {
            throw new Error('활동 기록 시작 실패');
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// ✨ 13차 진화 (자율 루프): '공부' 활동을 종료하는 API
app.post('/api/activity/finish', (req, res) => {
    try {
        const { logId } = req.body;
        if (!logId) {
            return res.status(400).json({ message: '로그 ID가 필요합니다.' });
        }

        // dbManager를 통해 활동 종료를 기록하고, 소요 시간을 받아옵니다.
        const result = dbManager.finishActivityLog(logId);

        if (result) {
            res.json({ success: true, duration: result.duration_minutes });
        } else {
            throw new Error('활동 기록 종료 실패');
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});


// --- 7. 서버 실행 (가장 마지막에!) ---
async function startServer() {
    console.log('[Server Startup] 서버 시작 절차를 개시합니다...');
    
    // 1. 데이터베이스 테이블을 준비합니다.
    dbManager.initializeDatabase();
    
    // 2. 혹시 놓친 작업이 있으면 실행합니다.
    await checkAndRunDelayedJob(); // 메모리 프로파일러(3시) 지각 확인
    await checkAndRunDelayedResearcherJob(); // 자율 연구원(7시) 지각 확인
    await checkAndRunDelayedGardenerJob(); // 기억 정원사 (자정) 지각 확인

    // 3. 모든 준비가 끝나면 서버를 시작합니다.
    console.log('[Server Startup] 모든 준비가 완료되었습니다. 웹 서버를 실행합니다.');
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
}

// ▼▼▼▼▼ 바로 이 부분을 임시로 추가해주세요 ▼▼▼▼▼

// ✨ '기억의 정원사' 수동 실행 테스트 코드
//(async () => {
    // 서버와 DB가 준비될 시간을 2초 정도 기다려줍니다. (안전장치)
    //await new Promise(resolve => setTimeout(resolve, 2000)); 
    
    //console.log('[Manual Test] "기억의 정원사" 프로세스를 수동으로 실행합니다...');
     //우리가 테스트하고 싶은 함수를 여기서 직접 호출합니다.
    //await runMemoryGardenerProcess();
    //console.log('[Manual Test] 수동 실행이 완료되었습니다.');
//})();

// ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

// [✅ 최종 수정] 서버 시작 함수를 호출합니다.
startServer();