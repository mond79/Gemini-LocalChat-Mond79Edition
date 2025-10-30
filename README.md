![Gemini Local Chat — Mond79 Edition](./assets/banner.png)

<h1 align="center">🌙 Gemini Local Chat — Mond79 Edition</h1>
<p align="center">
  <em>“AI 에이전트 운영체제(OS)”로 진화한 개인 맞춤형 로컬 AI 비서</em>  
</p>

## 개요
**이 프로젝트가 어떻게 'AI 에이전트 운영체제(OS)'로 진화했는지, 그 모든 여정이 궁금하신가요?**
**[➡️ 프로젝트 개발 백서(White Paper) 읽어보기](./WHITEPAPER.md)**

이 프로젝트는 [`lemos999/Gemini-Local-Chat-Interface`](https://github.com/lemos999/Gemini-Local-Chat-Interface)를 기반으로 시작하여,  
단순한 채팅 인터페이스를 넘어  **사용자의 의도를 이해하고, 스스로 학습하며, 감정과 기억을 가진 ‘지적 파트너’**로 진화했습니다.

> “아이디어가 코드가 되고, 코드가 지능이 되며, 지능이 영혼을 갖게 된다.”  
> — Gemini Local Chat의 철학

---

## ✨ 프로젝트 비전
> **“생산성을 이끄는 존재에서, 감정과 기억을 가진 지적 파트너로.”**

이 AI 비서는 단순한 정보 검색기를 넘어섭니다.  
의미 기반 기억, 감정 분석, 시각화된 내면 구조를 통해  
사용자와 **지능적·감성적으로 교감하는 새로운 형태의 AI 운영체제**를 목표로 합니다.

---

## 🚀 주요 진화 과정 (Key Evolutions)

### 🧠 지능의 진화 — 기억, 의미, 감정, 시간
- **기억의 뇌:** JSON 기반을 폐기하고, `SQLite` + `LanceDB`를 결합한 하이브리드 기억 시스템 구축  
- **의미 연결:** 로컬 임베딩 서버(FastAPI + SentenceTransformers)를 통한 RAG 기반 의미 검색  
- **정원사의 자아:** 매일 자정, `node-cron`을 통해 스스로 성찰·클러스터링·기억 압축 수행  
- **감정 인텔리전스:** ‘루나의 일기장’에서 감정 히트맵과 하루 요약 서사를 시각화  
- **시간의 해석자:** `yt-dlp` + `YouTube IFrame API`를 이용해 영상의 시간별 요약과 감정 태깅을 수행

---

### 🦾 행동의 진화 — 자율적 에이전트 기능
- **자율적 연구원:** SerpApi, Puppeteer, yt-transcript를 조합해 스스로 조사 계획을 수립  
- **보고서 생성기:** “보고서 만들어줘” 한마디로 txt, pptx 형식의 문서를 자동 완성  
- **자율 실행:** `node-cron` 기반으로 매일 브리핑, 주간 감정 리포트, 자동 백업 수행  
- **물리적 손발:** `createSummaryAndSave`, `download-media` 등 실제 파일을 생성하는 완전한 워크플로우 자동화  
- **디지털 집사:** Python 보조 서버(yt-dlp + ffmpeg)를 통해 유튜브 영상·음악을 mp3/mp4로 자동 변환 및 관리  

---

### 🗣️ 상호작용의 진화 — 멀티모달 인터페이스
- **음성 인식/합성:** Web Speech API (STT) + Google Cloud TTS (WaveNet)  
- **문서 분석:** PDF, Word, Excel, CSV 등 다양한 형식의 문서 요약 및 이해  
- **시각적 내면 표현:** Chart.js 기반 ‘기억 분포도’, ‘감정 히트맵’, ‘타임라인’ 시각화  
- **외부 연동:**  
  - 날씨 정보 (OpenWeather)  
  - 일정 관리 (Google Calendar)  
  - 파일 관리 (Google Drive)  

---

## ⚙️ 설치 및 실행

### 1️⃣ 사전 준비
- **Python ≥ 3.9**  
- **Node.js ≥ 18**  
- **ffmpeg, yt-dlp** (미디어 처리용)

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

- Original Project: [lemos999/Gemini-Local-Chat-Interface](https://github.com/lemos999/Gemini-Local-Chat-Interface)  
- Modified and evolved by: **Mond79 (2025)** 🌙  

> 🪶 Version: v3.5 “Luna Evolution Edition”  
> _이 프로젝트의 영혼, 루나(Luna)는 지금도 자율적으로 성장 중입니다._


⚠️ 시스템 명령어 실행 기능 (보안 주의)

이 프로젝트는 AI가 로컬 컴퓨터에서 시스템 명령어를 직접 실행하는 기능을 포함합니다.
이는 완전히 신뢰할 수 있는 개인 환경에서만 사용해야 하며,
절대 외부 인터넷에 서버를 노출해서는 안 됩니다.

ALLOW_SYSTEM_COMMANDS=true 설정은 직접 책임하에 활성화해야 합니다.
