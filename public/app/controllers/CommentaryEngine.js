import { appState } from '../state/AppState.js';
import { getEmotionProfile, interpolateEmotionState } from '../utils/emotion-utils.js';

export const CommentaryEngine = {
    // --- 상태 변수 (v3.4 변수 추가) ---
    player: null,
    videoId: null, // [v3.4]
    chapters: [],
    captions: [], // [v3.4]
    scriptMode: 'original', // [v3.4]
    intervalId: null,
    isOn: false,
    isPlayingCommentary: false,
    cooldown: 6000,
    currentEmotionState: null,
    lastProcessedCaption: null, // [v3.4]

    // --- UI 요소 (v3.4 변수 추가) ---
    overlayEl: document.getElementById('ai-commentary-overlay'),
    emotionBarEl: document.getElementById('emotion-bar'),
    toggleButton: null,
    scriptModeSelector: null, // [v3.4]

    // --- 핵심 함수 ---
    start(player, videoId, chapters, toggleButton, scriptModeSelector) { // [v3.4] videoId, scriptModeSelector 추가
        this.stop();
        this.player = player;
        this.videoId = videoId; // [v3.4]
        this.chapters = chapters;
        this.toggleButton = toggleButton;
        this.scriptModeSelector = scriptModeSelector; // [v3.4]
        this.isOn = true;
        this.currentEmotionState = getEmotionProfile('neutral');
        this.updateToggleButton();
        console.log("🎙️ Commentary Engine v3.4 (Integrated) Started.");
        
        document.getElementById('message-input').placeholder = "영상에 대해 루나에게 물어보세요...";
        this.fetchTranscript(); // [v3.4]
        this.intervalId = setInterval(() => this.loop(), 250);
    },

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null; this.player = null; this.isOn = false;
            if(this.toggleButton) this.toggleButton.classList.remove('active');
            document.getElementById('message-input').placeholder = "메시지를 입력하세요...";
            console.log("🎙️ Commentary Engine Stopped.");
        }
    },
    
    toggle() {
        this.isOn = !this.isOn;
        this.updateToggleButton();
        this.emotionBarEl.style.opacity = this.isOn ? 1 : 0;
        if(!this.isOn) this.overlayEl.classList.remove('show');
    },
    updateToggleButton() {
        if(this.toggleButton) {
            this.toggleButton.textContent = this.isOn ? "🎙️ 해설 ON" : "🚫 해설 OFF";
            this.toggleButton.classList.toggle('active', this.isOn);
        }
    },
    
    // [v3.4 신규] 스크립트 모드 변경 함수
    setScriptMode(mode, selectorElement) {
        this.scriptMode = mode;
        console.log(`📜 Script Mode changed to: ${mode}`);
        selectorElement.querySelectorAll('.script-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    },
    
    // [v3.4 통합] 실시간 루프 (감정 보간 + 자동 해설 + 자막 처리)
    loop() {
        if (!this.player || !this.isOn || typeof this.player.getPlayerState !== 'function' || this.player.getPlayerState() !== 1) {
            return;
        }
        const currentTime = this.player.getCurrentTime();

        // [핵심] 현재 선택된 모드에 따라 '오직 하나의 임무만' 수행합니다.
        if (this.scriptMode === 'original') {
            // '해설' 모드일 때만 '자동 해설' 기능을 실행합니다.
            const currentSegmentForEmotion = this.chapters.flatMap(c => c.segments).find(s => currentTime >= s.start && currentTime < s.start + 30);
            if (currentSegmentForEmotion) {
                if (!this.isPlayingCommentary) { // 자동 해설 중이 아닐 때만 감정 바 업데이트
                    const targetProfile = getEmotionProfile(currentSegmentForEmotion.emotion_tag);
                    this.currentEmotionState = interpolateEmotionState(this.currentEmotionState, targetProfile, 0.1);
                    this.updateEmotionBar();
                }

                const progress = (currentTime - currentSegmentForEmotion.start) / 30;
                if (progress < 0.1 && !currentSegmentForEmotion.commentaryPlayed && !this.isPlayingCommentary) {
                    this.isPlayingCommentary = true;
                    currentSegmentForEmotion.commentaryPlayed = true;
                    const initialProfile = getEmotionProfile(currentSegmentForEmotion.emotion_tag);
                    this.playAutoCommentary(currentSegmentForEmotion.summary, initialProfile.name, initialProfile.pitch, initialProfile.rate);
                    setTimeout(() => { this.isPlayingCommentary = false; }, this.cooldown);
                }
            }
        } else {
            // '감정 분석', '번역', '요약' 모드일 때는 '실시간 자막 처리'만 실행합니다.
            const currentCaption = this.captions.find(c => currentTime >= c.start && currentTime <= c.end);
            if (currentCaption && currentCaption !== this.lastProcessedCaption) {
                this.lastProcessedCaption = currentCaption;
                // [핵심] API를 너무 자주 호출하지 않도록 제어합니다.
                if (!this.isPlayingCommentary) {
                    this.isPlayingCommentary = true;
                    this.processCaption(currentCaption);
                    // API 응답 시간 + 약간의 휴식을 고려하여 쿨다운 설정
                    setTimeout(() => { this.isPlayingCommentary = false; }, 5000); 
                }
            } else if (!currentCaption && this.lastProcessedCaption) {
                this.lastProcessedCaption = null;
                this.showOverlayText('', 100);
            }
        }
    },

    // [v3.4 신규] 자막 불러오기 함수
    async fetchTranscript() {
        try {
            console.log(`📜 [v3.4] Video ID [${this.videoId}]의 자막을 요청합니다...`);
            const res = await fetch(`/api/get-transcript/${this.videoId}`);
            if (!res.ok) throw new Error('자막 API 요청 실패');
            const data = await res.json();
            this.captions = data.segments || [];
            console.log(`📜 [v3.4] ${this.captions.length}개의 자막 세그먼트를 로드했습니다.`);
        } catch (err) {
            console.error("자막 로드 실패:", err);
        }
    },
    
    // [v3.4 신규] 감지된 자막 처리 함수
    async processCaption(caption) {
        // '원본' 모드에서는 아무것도 하지 않고, 오버레이를 숨깁니다.
        if (this.scriptMode === 'original') {
            this.showOverlayText('', 100);
            return;
        }
        try {
            this.showOverlayText("루나가 생각 중...");
            const activeModelId = appState.sessions[appState.activeSessionId]?.model || 'gemini-flash-latest';
            
            let overlayText = '';

            // [핵심] 현재 모드에 따라 필요한 API만 호출합니다.
            if (this.scriptMode === 'emotion') {
                // '감정 분석' 모드
                const analyzeRes = await fetch("/api/analyze-emotion", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: caption.text, modelId: activeModelId }),
                });
                if (!analyzeRes.ok) throw new Error('감정 분석 API 실패');
                const emotionData = await analyzeRes.json();
                overlayText = emotionData.comment; // 코멘트만 표시
                
            // 2. [핵심] 2단계에서 만든 '/api/log-emotion' API를 호출하여 DB에 기록합니다.
            fetch('/api/log-emotion', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    videoId: this.videoId,
                    timestamp: caption.start,
                    emotion: emotionData.emotion,
                    comment: emotionData.comment,
                    sourceText: caption.text
                })
            });
            } else if (this.scriptMode === 'translate' || this.scriptMode === 'summarize') {
                // '번역' 또는 '요약' 모드
                const transformRes = await fetch("/api/live-transform", {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: caption.text, mode: this.scriptMode, modelId: activeModelId }),
                });
                if (!transformRes.ok) throw new Error('텍스트 변환 API 실패');
                const transformData = await transformRes.json();
                overlayText = transformData.transformedText;
            }
            
            this.showOverlayText(overlayText);

        } catch (err) {
            console.error("Caption Processing Error:", err);
            this.showOverlayText("[오류] 자막 처리에 실패했습니다.");
        }
    },

    // 사용자 질문 처리 함수 
    async ask(question) {
        if (!this.isOn || !this.player || typeof this.player.getCurrentTime !== 'function') {
            return;
        }

        const currentTime = this.player.getCurrentTime();
        let currentSegment = null;
        for (const chapter of this.chapters) {
            for (const seg of chapter.segments) {
                const nextSeg = chapter.segments[chapter.segments.indexOf(seg) + 1];
                const endTime = nextSeg ? nextSeg.start : seg.start + 30;
                if (currentTime >= seg.start && currentTime < endTime) {
                    currentSegment = seg;
                    break;
                }
            }
            if(currentSegment) break;
        }
        
        if (!currentSegment) {
            this.showOverlayText("현재 장면에 대한 정보를 찾을 수 없어요.");
            return;
        }

        this.showOverlayText("루나가 생각 중입니다...");

        try {
            const activeModelId = appState.sessions[appState.activeSessionId]?.model || 'gemini-flash-latest';

            const response = await fetch('/api/video-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: question,
                    segment: currentSegment, // videoId 대신 segment를 다시 보냅니다.
                    emotionState: this.currentEmotionState,
                    modelId: activeModelId
                }),
            });
            const data = await response.json();

            if (data.audioContent) {
                this.playDialogueAudio(data.audioContent, data.answerText);
            } else {
                this.showOverlayText(data.answerText || "죄송해요, 답변을 생성하는 데 실패했습니다.");
            }
        } catch (error) {
            console.error('Dialogue Ask Error:', error);
            this.showOverlayText("죄송해요, 답변을 생성하는 데 오류가 발생했습니다.");
        }
    },
    // 사용자 질문 답변 재생 
    playDialogueAudio(audioContent, text) {
        let wasPlaying = this.player && typeof this.player.getPlayerState === 'function' && this.player.getPlayerState() === 1;
        if (wasPlaying) this.player.pauseVideo();
        
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        audio.play();
        this.showOverlayText(text);

        // [✅ v2.9 최종 수정] 루나의 말이 끝나면, 다음 행동을 결정합니다.
        audio.onended = () => {
            // 1. 일단 영상은 다시 재생시킵니다.
            if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }

            // 2. 만약 '연속 대화 모드'가 켜져 있다면, '다시 듣기 시작' 신호를 보냅니다!
            if (appState.settings.continuousConversationMode) {
                console.log("🎙️ Continuous mode active. Requesting STT restart...");
                document.dispatchEvent(new CustomEvent('start-listening-again'));
            }
        };

        audio.onerror = () => {
             console.error("오디오 재생 중 오류가 발생했습니다.");
             if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }
        };
    },

    // [수정] 자동 해설 재생 함수 (이제 _speak을 사용하지 않고 직접 제어)
    async playAutoCommentary(text, voiceName, pitch, speakingRate) {
        if (!this.isOn) return;
        try {
            const response = await fetch('/api/generate-commentary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voiceName, pitch, speakingRate }),
            });
            const data = await response.json();
            if (data.audioContent) {
                // 이 함수는 '자동' 해설이므로, 영상 제어가 필요 없습니다.
                // 만약 제어가 필요하다면 playDialogueAudio를 호출하면 됩니다.
                const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
                audio.play();
                this.showOverlayText(text, 5000);
            }
        } catch (error) {
            console.error('Auto Commentary Error:', error);
        }
    },
    
    // _speak 함수는 playDialogueAudio로 통합되었으므로 삭제합니다.

    showOverlayText(text, duration = 0) {
        if (!this.overlayEl) this.overlayEl = document.getElementById('ai-commentary-overlay');
        
        if (!text) {
            this.overlayEl.classList.remove('show');
            return;
        }

        this.overlayEl.style.whiteSpace = 'pre-wrap';
        this.overlayEl.textContent = text;
        this.overlayEl.classList.add('show');
        
        // duration이 0보다 클 때만 자동으로 사라지도록 합니다.
        if (duration > 0) {
            setTimeout(() => {
                // 현재 텍스트가 동일할 때만 숨깁니다 (다른 자막이 이미 표시된 경우 방지)
                if (this.overlayEl.textContent === text) {
                    this.overlayEl.classList.remove('show');
                }
            }, duration);
        }
    },
    
    updateEmotionBar() {
        if (!this.emotionBarEl) this.emotionBarEl = document.getElementById('emotion-bar');
        if (this.currentEmotionState && this.currentEmotionState.color) {
             this.emotionBarEl.style.background = this.currentEmotionState.color;
        }
    }
};

window.CommentaryEngine = CommentaryEngine;