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
            this.intervalId = null;
            this.player = null;
            this.isOn = false;
            if(this.toggleButton) this.toggleButton.classList.remove('active');
            
            document.getElementById('message-input').placeholder = "메시지를 입력하세요...";

            // [✅ 최종 수정] 엔진이 멈출 때, 오버레이 자막을 확실하게 숨깁니다.
            if (this.overlayEl) {
                this.overlayEl.classList.remove('show');
            }

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
                this._speak(data.audioContent, data.answerText, true); // 'true'는 연속 대화 모드를 활성화하라는 신호
            } else {
                this.showOverlayText(data.answerText || "죄송해요, 답변을 생성하는 데 실패했습니다.");
            }
        } catch (error) {
            console.error('Dialogue Ask Error:', error);
            this.showOverlayText("죄송해요, 답변을 생성하는 데 오류가 발생했습니다.");
        }
    },
    // [최종] 모든 음성 출력을 책임지는 단 하나의 '마스터' 함수 (타이머 기능 탑재)
    _speak(audioContent, text, isDialogue) {
        // 1. 영상 제어 (기존과 동일)
        let wasPlaying = this.player && typeof this.player.getPlayerState === 'function' && this.player.getPlayerState() === 1;
        if (wasPlaying) {
            this.player.pauseVideo();
        }
        
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        audio.play();
        
        // 2. [핵심] 상황에 맞는 '사라지는 시간'을 결정합니다.
        //    - 사용자와의 대화(isDialogue)이면 8초
        //    - 자동 해설이면 5초
        const duration = isDialogue ? 8000 : 5000;
        this.showOverlayText(text, duration);

        // 3. 음성 재생이 끝나면 다음 행동을 결정합니다 (기존과 동일)
        audio.onended = () => {
            if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }
            if (isDialogue && appState.settings.continuousConversationMode) {
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

    // [최종] '자동 해설' 함수는 이제 '마스터' 함수를 호출합니다.
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
                // isDialogue: false -> 자동 해설이므로 연속 대화 모드를 켜지 않습니다.
                this._speak(data.audioContent, text, false);
            }
        } catch (error) {
            console.error('Auto Commentary Error:', error);
        }
    },
    
    // [최종] '사용자 질문 답변'도 이제 '마스터' 함수를 호출합니다. (이 함수는 ask 함수 안에서 호출됩니다)
    playDialogueAudio(audioContent, text) {
        // isDialogue: true -> 사용자와의 대화이므로 연속 대화 모드를 켤 수 있습니다.
        this._speak(audioContent, text, true);
    },

    showOverlayText(text, duration = 0) {
        if (!this.overlayEl) this.overlayEl = document.getElementById('ai-commentary-overlay');
        
        // [핵심] 이전 타이머가 있다면 즉시 제거하여, 사라지는 도중에 새 메시지가 뜨는 것을 방지합니다.
        if (this.overlayTimer) {
            clearTimeout(this.overlayTimer);
            this.overlayTimer = null;
        }

        if (!text) {
            this.overlayEl.classList.remove('show');
            return;
        }

        this.overlayEl.style.whiteSpace = 'pre-wrap';
        this.overlayEl.textContent = text;
        this.overlayEl.classList.add('show');
        
        // [핵심] duration이 0보다 클 때만 (즉, '자동 해설'이나 '질문 답변'일 때만) 자동으로 사라지도록 합니다.
        if (duration > 0) {
            this.overlayTimer = setTimeout(() => {
                this.overlayEl.classList.remove('show');
            }, duration);
        }
        // duration이 0이면 (즉, '실시간 자막' 모드이면) 자동으로 사라지지 않고 계속 남아있습니다.
    },
    
    updateEmotionBar() {
        if (!this.emotionBarEl) this.emotionBarEl = document.getElementById('emotion-bar');
        if (this.currentEmotionState && this.currentEmotionState.color) {
             this.emotionBarEl.style.background = this.currentEmotionState.color;
        }
    }
};

window.CommentaryEngine = CommentaryEngine;