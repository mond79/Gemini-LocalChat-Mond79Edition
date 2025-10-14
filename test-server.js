require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pdf = require('pdf-parse');
const { exec } = require('child_process');

const app = express();
const port = 3334; // 다른 포트 사용

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

app.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`🚀 테스트 서버가 ${url} 에서 실행 중입니다.`);
  
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