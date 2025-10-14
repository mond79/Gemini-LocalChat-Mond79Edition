# Gemini Local Chat Interface

## 1. 개요 (Overview)

Google Gemini API와 상호작용하기 위한 독립 실행형(Standalone) 로컬 웹 애플리케이션입니다. 모든 대화 기록과 설정은 사용자의 브라우저(LocalStorage)에 저장되며, Node.js 기반의 백엔드 프록시를 통해 API 키를 안전하게 관리합니다.

[![Watch youtube how to install](http://img.youtube.com/vi/IqjXARzz97Q?si=hqU4eoPU7Z4bwON2/1.jpg)](https://youtu.be/IqjXARzz97Q?si=hqU4eoPU7Z4bwON2)

**주요 목표:**
*   **데이터 주권:** 모든 사용자 데이터를 외부 서버 없이 로컬 환경에 저장합니다.
*   **API 키 보안:** Node.js 프록시를 통해 API 키가 클라이언트에 노출되는 것을 방지합니다.
*   **고급 기능 제공:** 세션/폴더 관리, 시스템 프롬프트, 상세한 API 사용량 추적 등 전문적인 기능을 지원합니다.

## 2. 핵심 기능 (Core Features)

#### **채팅 인터페이스**
*   **계층적 세션 관리:** 드래그 앤 드롭을 지원하는 폴더 구조로 채팅 세션을 체계적으로 관리합니다.
*   **콘텐츠 렌더링:** Markdown, 테이블, 구문 강조가 적용된 코드 블록, LaTeX 수학 공식을 지원합니다.
*   **파일 첨부:** 이미지, PDF, 텍스트 파일을 대화의 일부로 첨부할 수 있습니다.

#### **API 및 모델 관리**
*   **다중 API 키:** 기본 키의 할당량 초과 시 예비 키를 자동으로 사용하는 폴백(Fallback) 기능을 지원합니다.
*   **모델 관리 대시보드:** 모델별 일일 호출 제한 및 비용($/1M 토큰)을 직접 설정하고 관리합니다.
*   **생성 파라미터 제어:** Temperature(창의성)와 Top-P(다양성) 값을 UI에서 실시간으로 조절할 수 있습니다.

#### **시스템 프롬프트 관리**
*   AI의 역할과 행동을 정의하는 시스템 프롬프트를 템플릿으로 저장 및 재사용할 수 있습니다.
*   특정 템플릿을 기본값으로 설정하여 새 채팅 세션에 자동으로 적용할 수 있습니다.

#### **API 사용량 대시보드**
*   기간, 모델, 태그별로 API 사용량을 필터링하고 시각화합니다.
*   예상 비용, 토큰 사용량, API 호출 횟수를 차트와 상세 기록으로 제공합니다.

## 3. 시스템 아키텍처 (System Architecture)

### **프론트엔드 (Vanilla JS)**
*   사용자 인터페이스 전체를 담당하며, `project-structure.txt`에 명시된 'Container-Component-Service' 패턴에 따라 모듈화되어 있습니다.

### **백엔드 (Node.js Proxy)**
*   백엔드는 API 요청을 중계하는 프록시 서버 역할을 수행하며, 다음과 같은 필수적인 기능을 담당합니다.
    1.  **보안:** `GEMINI_API_KEY`를 서버 환경(`.env` 파일)에만 저장하여 클라이언트 노출을 방지합니다.
    2.  **CORS 우회:** 브라우저의 동일 출처 정책(Same-Origin Policy) 제약을 받지 않고 안정적으로 Google API 서버와 통신합니다.
    3.  **서버 측 연산:** PDF 파일 파싱과 같이 브라우저 환경에서 처리하기 어려운 작업을 수행합니다.

### **데이터 저장소 (Browser LocalStorage)**
*   세션, 설정, API 키, 사용 기록 등 모든 영속적인 데이터는 사용자의 브라우저 내 `LocalStorage`에 저장됩니다.

## 4. 기술 스택 (Tech Stack)

#### **Frontend**
*   **Core:** HTML5, CSS3, ES6+ JavaScript (Vanilla JS, No Frameworks)
*   **Markdown & Code:** `marked` (Markdown to HTML), `highlight.js` (Syntax Highlighting)
*   **Math Rendering:** `KaTeX`, `MathJax`
*   **Data Visualization:** `Chart.js`
*   **Security:** `DOMPurify` (HTML Sanitization)

#### **Backend**
*   **Runtime:** Node.js
*   **Framework:** Express.js
*   **API Client:** `@google/generative-ai`
*   **Middleware & Utilities:** `cors`, `dotenv`, `pdf-parse`

#### **Architecture & Tooling**
*   **Design Pattern:** Container-Component-Service, API Proxy
*   **Package Manager:** npm
*   **Packaging:** `pkg` (For creating standalone executables)

## 5. 시작하기 (Getting Started)

#### **사전 요구사항**
*   [Node.js](https://nodejs.org/) (LTS 버전 권장)
*   `npm` (Node.js 설치 시 포함)

#### **설치**
1.  **리포지토리 클론:**
    ```bash
    git clone [리포지토리_URL]
    cd [디렉토리명]
    ```

2.  **의존성 설치:**
    ```bash
    npm install
    ```

#### **환경설정**
1.  프로젝트 루트 디렉토리에 `.env` 파일을 생성합니다.
2.  파일 내에 자신의 Gemini API 키를 다음과 같이 추가합니다.
    ```
    GEMINI_API_KEY="YOUR_API_KEY_HERE"
    ```

#### **애플리케이션 실행**
*   아래 명령어를 실행하면 웹 서버가 시작되고, 자동으로 브라우저에서 애플리케이션이 열립니다.
    ```bash
    npm start
    ```

*   **실행 로직:** `npm start` 명령어는 `server.js`를 실행하여 `localhost:3333` 포트에 Express 서버를 구동합니다. 이 서버는 프론트엔드 리소스(`public` 디렉토리)를 제공하고, Gemini API 요청을 처리하는 프록시 역할을 동시에 수행합니다.

---

**주의:** 이 애플리케이션은 최종 패치가 적용되기 전까지 일부 기능이 정상적으로 작동하지 않을 수 있습니다.

---

## English Version

### 1. Overview

A standalone, local web application for interacting with the Google Gemini API. All conversation history and settings are stored in the user's browser (LocalStorage), and the API key is managed securely through a Node.js-based backend proxy.

**Key Objectives:**
*   **Data Sovereignty:** Store all user data in the local environment without external servers.
*   **API Key Security:** Prevent client-side exposure of the API key via a Node.js proxy.
*   **Advanced Features:** Support professional features like session/folder management, system prompts, and detailed API usage tracking.

### 2. Core Features

#### **Chat Interface**
*   **Hierarchical Session Management:** Systematically organize chat sessions in a folder structure with drag-and-drop support.
*   **Content Rendering:** Supports Markdown, tables, code blocks with syntax highlighting, and LaTeX mathematical formulas.
*   **File Attachments:** Attach images, PDFs, and text files as part of the conversation context.

#### **API & Model Management**
*   **Multiple API Keys:** Supports a fallback mechanism to automatically use alternate keys when the primary key's quota is exceeded.
*   **Model Management Dashboard:** Set and manage daily call limits and costs ($/1M tokens) for each model.
*   **Generation Parameter Control:** Adjust Temperature (creativity) and Top-P (diversity) values in real-time through the UI.

#### **System Prompt Management**
*   Save and reuse system prompts that define the AI's role and behavior as templates.
*   Set a specific template as the default to automatically apply it to new chat sessions.

#### **API Usage Dashboard**
*   Filter and visualize API usage by period, model, and tags.
*   Provides estimated costs, token usage, and API call counts in charts and detailed logs.

### 3. System Architecture

#### **Frontend (Vanilla JS)**
*   Manages the entire user interface, modularized according to the 'Container-Component-Service' pattern detailed in `project-structure.txt`.

#### **Backend (Node.js Proxy)**
*   The backend serves as a proxy server for API requests and performs the following essential functions:
    1.  **Security:** Stores the `GEMINI_API_KEY` exclusively in the server environment (`.env` file) to prevent client-side exposure.
    2.  **CORS Bypass:** Enables stable communication with the Google API server without being restricted by the browser's Same-Origin Policy.
    3.  **Server-Side Operations:** Handles tasks that are difficult or impossible in a browser environment, such as parsing PDF files.

#### **Data Storage (Browser LocalStorage)**
*   All persistent data, including sessions, settings, API keys, and usage history, is stored in the user's browser LocalStorage.

### 4. Tech Stack

#### **Frontend**
*   **Core:** HTML5, CSS3, ES6+ JavaScript (Vanilla JS, No Frameworks)
*   **Markdown & Code:** `marked` (Markdown to HTML), `highlight.js` (Syntax Highlighting)
*   **Math Rendering:** `KaTeX`, `MathJax`
*   **Data Visualization:** `Chart.js`
*   **Security:** `DOMPurify` (HTML Sanitization)

#### **Backend**
*   **Runtime:** Node.js
*   **Framework:** Express.js
*   **API Client:** `@google/generative-ai`
*   **Middleware & Utilities:** `cors`, `dotenv`, `pdf-parse`

#### **Architecture & Tooling**
*   **Design Pattern:** Container-Component-Service, API Proxy
*   **Package Manager:** npm
*   **Packaging:** `pkg` (For creating standalone executables)

### 5. Getting Started

#### **Prerequisites**
*   [Node.js](https://nodejs.org/) (LTS version recommended)
*   `npm` (included with Node.js installation)

#### **Installation**
1.  **Clone the repository:**
    ```bash
    git clone [REPOSITORY_URL]
    cd [DIRECTORY_NAME]
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

#### **Configuration**
1.  Create a `.env` file in the project root directory.
2.  Add your Gemini API key to the file as follows:
    ```
    GEMINI_API_KEY="YOUR_API_KEY_HERE"
    ```

#### **Running the Application**
*   Run the following command to start the web server. It will automatically open the application in your default browser.
    ```bash
    npm start
    ```

*   **Execution Logic:** The `npm start` command executes `server.js`, which runs an Express server on `localhost:3333`. This server serves the frontend resources (the `public` directory) and simultaneously acts as a proxy for Gemini API requests.

---

**Note:** Some features of this application may not function correctly until the final patch is applied.
