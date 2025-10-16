![Gemini Local Chat — Mond79 Edition](./assets/banner.png)

<h1 align="center">🌙 Gemini Local Chat — Mond79 Edition</h1>
<p align="center">
  <em>“AI 에이전트 운영체제(OS)”로 진화한 개인 맞춤형 로컬 AI 비서</em>  
</p>

## 개요
**이 프로젝트가 어떻게 'AI 에이전트 운영체제(OS)'로 진화했는지, 그 모든 여정이 궁금하신가요?**
**[➡️ 프로젝트 개발 백서(White Paper) 읽어보기](./WHITEPAPER.md)**

이 프로젝트는 [`lemos999/Gemini-Local-Chat-Interface`](https://github.com/lemos999/Gemini-Local-Chat-Interface)를 기반으로 시작하여,  
단순한 채팅 인터페이스를 넘어 **사용자의 작업을 이해하고, 스스로 학습하며, 자율적으로 행동하는 개인 맞춤형 AI 비서**로 진화했습니다.

---

## ✨ 프로젝트 비전
> **“생산성을 이끄는 존재”**

이 AI 비서는 단순한 정보 검색 도구가 아닙니다.  
사용자의 의도를 파악하고, 과거의 기억을 의미적으로 연결하며,  
스스로 계획을 세워 작업을 수행하고, 심지어 사용자가 시키지 않은 일도 먼저 준비하는 **능동적 파트너**를 지향합니다.

---

## 🚀 주요 진화 과정 (Key Evolutions)

### 🧠 두뇌의 혁신 — 완전한 로컬 기억 시스템
- **7차 진화: 기억 시스템 대수술**  
  불안정한 `.json` 기반 기억 방식을 폐기하고, 빠르고 안정적인 **로컬 SQLite 데이터베이스**로 통합했습니다.  
- **8차 진화: 의미 기반 기억 (Semantic Memory)**  
  자체 구축한 **로컬 임베딩 서버 (Python/FastAPI)** 와 **로컬 벡터 DB (LanceDB)** 를 연동하여  
  AI가 대화의 **‘의미’와 ‘맥락’**을 이해하고, RAG(Search-Augmented Generation) 구조로 과거 대화와 연결합니다.

---

### 🦾 행동의 진화 — 자율적 에이전트 기능
- **자율적 연구원:** SerpApi, Puppeteer, Youtube Transcript를 조합해 스스로 조사 계획을 세우고  
  결과를 **보고서(txt)** 또는 **발표 자료(pptx)** 형태로 생성합니다.  
- **살아있는 비서:** `node-cron`을 통해 매일 새벽 자동으로 기동,  
  사용자의 관심사를 조사하고 **아침 브리핑**을 준비합니다.  
- **워크플로우 자동화:** “회의록 저장해줘” 한마디면  
  요약·정리·파일 생성까지 자동 처리합니다.  
- **물리적 제어:** `executeCommand`를 통해 계산기, 메모장 등 로컬 프로그램을 직접 실행합니다.

---

### 🗣️ 상호작용의 진화 — 멀티모달 인터페이스
- **음성 대화:** Web Speech API (STT) + Google Cloud TTS (WaveNet) 결합으로 자연스러운 음성 대화  
- **문서 이해:** PDF, Word, Excel 등 다양한 문서를 분석 및 요약  
- **외부 연동:**  
  - 실시간 날씨 (OpenWeather)  
  - 일정 관리 (Google Calendar)  
  - 파일 관리 (Google Drive)

---

## ⚙️ 설치 및 실행

### 1️⃣ 사전 준비
이 프로젝트는 **Node.js 서버**와 **Python 서버**로 구성되어 있습니다.  
- Python ≥ 3.9  
- Node.js ≥ 18

---

### 2️⃣ 프로젝트 클론 및 설치
```bash
git clone https://github.com/mond79/Gemini-LocalChat-Mond79Edition.git
cd Gemini-LocalChat-Mond79Edition

Node.js 패키지 설치

npm install

Python 가상 환경 생성 및 라이브러리 설치

python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt

참고: requirements.txt가 없다면 직접 다음 명령어를 실행하세요.

pip install fastapi uvicorn "sentence-transformers" "torch torchvision torchaudio" --index-url https://download.pytorch.org/whl/cu121

3️⃣ 환경 변수 설정

.env.example을 복사해 .env 파일을 만들고, 아래 내용을 채워 넣으세요.

# Google Gemini API Key (채팅 및 AI 기능용)
GEMINI_API_KEY=your_gemini_api_key_here

# (선택) 각종 도구용 API 키
SERPAPI_API_KEY=...
OPENWEATHER_API_KEY=...
KAKAO_API_KEY=...
GOOGLE_API_KEY=...       # Google Cloud TTS용
GOOGLE_CLIENT_ID=...     # Google Calendar/Drive용
GOOGLE_CLIENT_SECRET=... # Google Calendar/Drive용
PEXELS_API_KEY=...       # PPT 이미지 검색용

# (선택) 민감 정보 익명화 키워드 (쉼표로 구분, 공백 없음)
SENSITIVE_KEYWORDS=내이름,프로젝트명

# (선택) 시스템 명령어 실행 허용 (보안 주의!)
ALLOW_SYSTEM_COMMANDS=true

⚠️ .env 파일은 .gitignore에 포함되어 있으며, 절대 GitHub에 업로드하지 마세요.

4️⃣ 실행
(터미널 1) 의미 엔진 서버 실행

.\venv\Scripts\Activate.ps1        # 가상 환경 활성화
python embedding_server.py         # 서버 시작

(터미널 2) 메인 서버 실행

npm start                          # 채팅 시작

이제 브라우저에서 http://localhost:3333 으로 접속해 AI 비서를 사용할 수 있습니다.

🧩 기술 스택

| 영역                   | 기술                                                                           |
| -------------------- | ---------------------------------------------------------------------------- |
| **Backend**          | Node.js (Express), SQLite, LanceDB, node-cron, Puppeteer                     |
| **Embedding Server** | Python (FastAPI), SentenceTransformers, PyTorch                              |
| **Frontend**         | Vanilla JS, HTML5, CSS3, Web Speech API                                      |
| **AI / API**         | Google Gemini API, Google Cloud TTS, SerpApi, OpenWeather, Kakao Map, Pexels |
| **보안**               | dotenv, DOMPurify                                                            |

💬 크레딧

Original Project: lemos999/Gemini-Local-Chat-Interface
Modified and evolved by: Mond79 (2025) 🌙

⚠️ 시스템 명령어 실행 기능 (보안 주의)

이 프로젝트는 AI가 로컬 컴퓨터에서 시스템 명령어를 직접 실행하는 기능을 포함합니다.
이는 완전히 신뢰할 수 있는 개인 환경에서만 사용해야 하며,
절대 외부 인터넷에 서버를 노출해서는 안 됩니다.

ALLOW_SYSTEM_COMMANDS=true 설정은 직접 책임하에 활성화해야 합니다.
