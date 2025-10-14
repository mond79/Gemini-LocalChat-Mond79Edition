# Copilot Instructions for Gemini Local Chat — Mond Edition

## Project Overview
- **Purpose:** Local web app for interacting with Google Gemini API, with added voice chat, weather, map, and web search features. All chat history is stored in-browser; API keys are managed securely via a Node.js proxy server.
- **Main server:** `server.js` (Node.js/Express)
- **Frontend:** `public/index.html` (Vanilla JS, HTML, CSS)
- **Data:** User chat histories in `chat_histories/`, user profile in `user_profile.json`

## Key Architectural Patterns
- **Container-Component-Service Pattern:** 
  - Containers (`public/app/containers/*`): Smart components that manage state and logic
  - Components (`public/app/components/*`): Dumb UI components for pure rendering 
  - Services (`public/app/services/*`): Business logic and external communication
  - Example: See `ChatContainer.js`, `Message.js`, and `ChatService.js`

- **API Key Security:** All API keys are loaded from `.env` and never exposed to the frontend. Never hardcode or log secrets.
- **Tool Functions:** Server exposes tools (web search, weather, scraping, YouTube transcript, user profile memory) as callable functions for the AI model. See `server.js` section 3 & 4 for all available tools and their parameters.
- **Function Calling:** The main `/api/chat` endpoint supports function-calling: if a user message contains a URL or a request for weather/profile, the server may call the relevant tool and return the result to the model.
- **Chat History:** Each chat session is stored as a JSON file in `chat_histories/`, keyed by a UUID chatId. User profile facts are stored in `user_profile.json`.
- **HTTPS by Default:** The server attempts to launch with HTTPS using local certs (`localhost-key.pem`, `localhost.pem`). Falls back to HTTP if certs are missing.

## Developer Workflows
- **Start server:** `npm start` (see `server.js` for port/config)
- **Environment setup:** Copy `.env.example` to `.env` and fill in API keys. Required: `GEMINI_API_KEY`, `SERPAPI_API_KEY`, `OPENWEATHER_API_KEY`, `KAKAO_API_KEY`, `GOOGLE_API_KEY` (for TTS)
- **Install dependencies:** `npm install`
- **Test server (manual):** Use `test-server.js` or API tools like Postman to hit endpoints.
- **Debugging:** Server logs are verbose and in Korean; check console output for `[Function Executed]`, `[API]`, `[History]` tags.

## Project-Specific Conventions
- **Korean-first:** Most logs, comments, and UI are in Korean. User-facing strings should default to Korean.
- **Function tool pattern:** When adding new tools, define the function, add to the `tools` object, and declare in the `functionDeclarations` array for the model.
- **No frontend frameworks:** All UI logic is in vanilla JS in `public/`.
- **Sensitive data:** Never commit `.env` or user data files. `.gitignore` is preconfigured.

## Integration Points
- **External APIs:**
  - Google Gemini (chat)
  - SERPAPI (web search)
  - OpenWeather (weather)
  - Kakao Map (geocoding)
  - Google TTS (speech synthesis)
  - Puppeteer (web scraping)
  - YoutubeTranscript (YouTube captions)
- **PDF/Text extraction:** `/api/extract-text` endpoint parses PDF uploads using `pdf-parse`.

## Examples
- To add a new tool (e.g., translation):
  1. Implement the function in section 3 of `server.js`.
  2. Add to the `tools` object.
  3. Add a declaration in `functionDeclarations` in `/api/chat`.
- To debug a chat session: Find the relevant chatId in `chat_histories/`, inspect the JSON for message/part structure.

---
For further details, see `README.md` and inline comments in `server.js`.
