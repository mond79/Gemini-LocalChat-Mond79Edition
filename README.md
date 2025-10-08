🌙 README.md (완성본)
# Gemini Local Chat — Mond Edition 🌙

이 버전은 [lemos999의 Gemini Local Chat Interface](https://github.com/lemos999/Gemini-Local-Chat-Interface)를 기반으로  
다음 기능들이 추가된 **커스텀 로컬 AI 챗 인터페이스**입니다.

---

## ✨ 주요 변경 사항 (What's New)

- 🎤 **음성 채팅 기능** (무료 음성 API 기반)
- ☁️ **OpenWeather API 연동** (날씨 정보 표시)
- 🗺️ **Kakao Map API 연동** (지도 / 위치 검색)
- 🔍 **웹 검색 기능 (SERPAPI 연동)**
- 🧩 **보안 강화:** `.env` 기반 API 키 관리
- 🎨 **UI 및 구조 개선**

---

## 🧠 프로젝트 개요

Google Gemini API와 상호작용하는 로컬 웹 애플리케이션으로,  
모든 대화 기록은 브라우저 `LocalStorage`에 저장되고,  
API 키는 **Node.js 프록시 서버**를 통해 안전하게 관리됩니다.

---

## ⚙️ 설치 및 실행 방법

### 1️⃣ 프로젝트 클론
```bash
git clone https://github.com/mond79/Gemini-LocalChat-Mond79Edition.git
cd Gemini-LocalChat-MondEdition

2️⃣ 패키지 설치
npm install

3️⃣ 환경 변수 설정

.env 파일을 새로 만들고 아래 내용을 추가하세요:

GEMINI_API_KEY=your_gemini_api_key_here
SERPAPI_API_KEY=your_serpapi_key_here
OPENWEATHER_API_KEY=your_openweather_api_key_here
KAKAO_API_KEY=your_kakao_api_key_here


⚠️ .env는 절대 깃허브에 업로드하지 마세요!
.gitignore에 이미 포함되어 있습니다.

4️⃣ 실행
npm start


브라우저가 자동으로 열리며, http://localhost:3333 에서 실행됩니다.

🏗️ 기술 스택
영역	기술
Frontend	HTML5, CSS3, JavaScript (Vanilla JS)
Backend	Node.js (Express), dotenv, cors, pdf-parse
AI API	Google Gemini API
기타 API	SERPAPI, OpenWeather, Kakao Map
시각화	Chart.js, highlight.js
보안	DOMPurify (HTML Sanitization)
💬 크레딧

Original project: lemos999/Gemini-Local-Chat-Interface

Modified and extended by Mond79 (2025) 🌙