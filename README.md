🌙 README.md (완성본)
# Gemini Local Chat — Mond79 Edition 🌙

이 버전은 [lemos999의 Gemini Local Chat Interface](https://github.com/lemos999/Gemini-Local-Chat-Interface)를 기반으로  
다음 기능들이 추가된 **커스텀 로컬 AI 챗 인터페이스**입니다.

---

## ✨ 주요 변경 사항 (What's New)

- 🎥 **미디어 분석**	       (유튜브 영상 / 자막 분석 기능 (YouTube Transcript + Video Parsing))
- 📄 **문서 리더**	           (PDF / TXT 뿐만 아니라 Word (.docx), Excel (.xlsx), 이미지 파일 분석 지원)
- 🎤 **음성 채팅 업그레이드**  (Google Cloud TTS 기반 실시간 음성 응답)
- 🌐 **웹 검색 강화**          (SERPAPI → 실제 사이트 접속 후 본문 스크래핑 (DOM Parser 기반))
- 🧠 **기억 확장**	           (Local JSON + 브라우저 LocalStorage를 혼합한 세션 기억 구조)
- 🧩 **보안 개선**	           (.env 기반 API 키 + axios proxy 보호 구조 유지)
- ⚡ **8로컬 AI 프레임워크**	  (Google Gemini 2.5 Pro / Flash 모델 호환)
- ☁️ **실시간 날씨 검색**      (날씨 정보 표시 , 위치 검색)


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
GOOGLE_API_KEY=your_google_api_key_here



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

⚠️ 경고: 시스템 명령어 실행 기능
이 프로젝트는 AI가 로컬 컴퓨터에서 시스템 명령어를 실행하는 실험적인 기능을 포함합니다. 이 기능은 완벽하게 신뢰할 수 있는 개인 로컬 환경에서만 사용하도록 설계되었습니다. 절대로 이 서버를 외부 인터넷에 노출하지 마십시오. 이 기능을 활성화하려면 .env 파일에 ALLOW_SYSTEM_COMMANDS=true 설정을 직접 추가해야 합니다.