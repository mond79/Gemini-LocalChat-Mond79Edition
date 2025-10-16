🌙 Gemini Local Chat — Mond79 Edition 🌙

**이 프로젝트가 어떻게 'AI 에이전트 운영체제(OS)'로 진화했는지, 그 모든 여정이 궁금하신가요?**
**[➡️ 프로젝트 개발 백서(White Paper) 읽어보기](./WHITEPAPER.md)**


이 프로젝트는 lemos999/Gemini-Local-Chat-Interface를 기반으로 시작하여, 단순한 채팅 인터페이스를 넘어 **사용자의 작업을 이해하고, 스스로 학습하며, 자율적으로 행동하는 'AI 에이전트 운영체제(OS)'**로 진화한 개인 맞춤형 AI 비서입니다.


✨ 프로젝트의 비전: '생산성을 이끄는 존재'


이 AI 비서는 단순한 정보 검색 도구가 아닙니다. 사용자의 의도를 파악하고, 과거의 기억을 의미적으로 연결하며, 스스로 계획을 세워 작업을 수행하고, 심지어 사용자가 시키지 않은 일까지 먼저 준비하는 능동적인 파트너를 지향합니다.


🚀 주요 진화 과정 (Key Evolutions)


🧠 두뇌의 혁신: 완전한 로컬 기억 시스템 구축
기억 시스템 대수술 (7차 진화): 기존의 불안정한 .json 파일 기반 기억 시스템을 완전히 폐기하고, 빠르고 안정적인 로컬 SQLite 데이터베이스로 모든 기억(대화, 프로필, 할 일)을 통합했습니다.

의미 기반 기억 (8차 진화): 자체 구축한 **로컬 임베딩 서버(Python/FastAPI)**와 **로컬 벡터 데이터베이스(LanceDB)**를 연동하여, AI가 시간 순서를 넘어 대화의 **'의미'와 '맥락'**을 이해하고 과거의 모든 기억을 연관 검색하는 RAG(검색 증강 생성) 시스템을 완성했습니다.


🦾 행동의 진화: 자율적 에이전트 기능


자율적 연구원: 특정 주제에 대해 스스로 웹 검색(SerpApi), 사이트 분석(Puppeteer), 영상 스크립트 추출(youtube-transcript)을 조합하여 조사 계획을 수립하고, 최종적으로 **보고서(txt) 또는 발표 자료(pptx)**를 창작합니다.
살아있는 비서: node-cron을 통해 매일 스스로 일어나 사용자의 관심사를 파악하고, 밤새 관련 정보를 조사하여 아침 브리핑을 미리 준비합니다.
워크플로우 자동화: "회의록 저장해줘" 한마디에 대화 내용을 이해하고, 요약한 뒤, 바탕화면에 파일을 생성하는 완전한 워크플로우를 자율적으로 수행합니다.
물리적 세계 제어: executeCommand를 통해 계산기, 메모장 등 로컬 컴퓨터의 응용 프로그램을 직접 실행합니다.


🗣️ 상호작용의 진화: 멀티모달 인터페이스


음성 대화: Web Speech API (STT)와 Google Cloud TTS (WaveNet 음성)를 결합하여 자연스러운 음성 대화가 가능합니다.
다양한 문서 이해: PDF, Word(.docx), Excel(.xlsx) 등 다양한 형식의 문서를 이해하고 요약, 분석합니다.
외부 세계 연동: 실시간 날씨 정보(OpenWeather), 캘린더(Google Calendar), **드라이브(Google Drive)**와 연동하여 사용자의 디지털 라이프를 관리합니다.


⚙️ 설치 및 실행 방법


1️⃣ 사전 준비
이 프로젝트는 두 개의 서버(Node.js, Python)로 작동합니다. Python 3.9 이상 및 Node.js 18 이상이 설치되어 있어야 합니다.

2️⃣ 프로젝트 클론 및 설치

# 프로젝트 클론
git clone https://github.com/mond79/Gemini-LocalChat-Mond79Edition.git
cd Gemini-LocalChat-Mond79Edition

# Node.js 패키지 설치
npm install

# Python 가상 환경 생성 및 라이브러리 설치
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

(참고: requirements.txt 파일이 없다면, pip install fastapi uvicorn "sentence-transformers" "torch torchvision toraudio --index-url https://download.pytorch.org/whl/cu121" 명령어를 직접 실행하세요.)

3️⃣ 환경 변수 설정
.env.example 파일을 복사하여 .env 파일을 새로 만들고, 아래 내용을 자신의 API 키로 채워주세요.

# Google Gemini API Key (채팅 및 AI 기능용)
GEMINI_API_KEY=your_gemini_api_key_here

# (선택) 각종 도구용 API 키
SERPAPI_API_KEY=...
OPENWEATHER_API_KEY=...
KAKAO_API_KEY=...
GOOGLE_API_KEY=... # Google Cloud TTS용
GOOGLE_CLIENT_ID=... # Google Calendar/Drive용
GOOGLE_CLIENT_SECRET=... # Google Calendar/Drive용
PEXELS_API_KEY=... # PPT 이미지 검색용

# (선택) 민감 정보 익명화 키워드 (쉼표로 구분, 공백 없음)
SENSITIVE_KEYWORDS=내이름,프로젝트명

# (선택) 시스템 명령어 실행 허용 (보안 주의!)
ALLOW_SYSTEM_COMMANDS=true
⚠️ .env 파일은 .gitignore에 포함되어 있어 GitHub에 절대 올라가지 않습니다.

4️⃣ 실행

AI 비서를 실행하려면 두 개의 터미널을 사용해야 합니다.
1. (터미널 1) 의미 엔진 서버 실행:

# 가상 환경 활성화
.\venv\Scripts\Activate.ps1
# 서버 시작
python embedding_server.py

(모델을 처음 다운로드할 때 시간이 걸릴 수 있습니다.)

2. (터미널 2) 메인 애플리케이션 서버 실행:
code

npm start

이제 브라우저가 자동으로 열리며, http://localhost:3333 에서 AI 비서를 사용할 수 있습니다.

🏗️ 기술 스택

영역	            기술
Main Backend	    Node.js (Express), SQLite, LanceDB, node-cron, Puppeteer
Embedding Server	Python (FastAPI), SentenceTransformers, PyTorch
Frontend	        Vanilla JavaScript, HTML5, CSS3, Web Speech API
AI / API	        Google Gemini API, Google Cloud TTS, SerpApi, OpenWeather, Kakao Map, Pexels
보안	            dotenv, DOMPurify

💬 크레딧

Original project: lemos999/Gemini-Local-Chat-Interface
Modified and evolved by Mond79 (2025) 🌙

⚠️ 경고: 시스템 명령어 실행 기능

이 프로젝트는 AI가 로컬 컴퓨터에서 시스템 명령어를 실행하는 실험적인 기능을 포함합니다. 이 기능은 완벽하게 신뢰할 수 있는 개인 로컬 환경에서만 사용하도록 설계되었습니다. 절대로 이 서버를 외부 인터넷에 노출하지 마십시오. 이 기능을 활성화하려면 .env 파일에 ALLOW_SYSTEM_COMMANDS=true 설정을 직접 추가해야 합니다.