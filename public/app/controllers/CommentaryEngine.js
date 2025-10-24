import { appState } from '../state/AppState.js';
import { getEmotionProfile, interpolateEmotionState } from '../utils/emotion-utils.js';

export const CommentaryEngine = {
    // --- 상태 변수 ---
    player: null,
    chapters: [],
    intervalId: null,
    isOn: false,
    isPlayingCommentary: false,
    cooldown: 6000,
    currentEmotionState: null,

    // --- UI 요소 ---
    overlayEl: document.getElementById('ai-commentary-overlay'),
    emotionBarEl: document.getElementById('emotion-bar'),
    toggleButton: null,

    // --- 핵심 함수 ---
    start(player, chapters, toggleButton) {
        this.stop();
        this.player = player;
        this.chapters = chapters;
        this.toggleButton = toggleButton;
        this.isOn = true;
        this.currentEmotionState = getEmotionProfile('neutral');
        this.updateToggleButton();
        console.log("🎙️ Commentary Engine v2.8 FINAL Started.");
        
        document.getElementById('message-input').placeholder = "영상에 대해 루나에게 물어보세요...";

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

    loop() {
        if (!this.player || !this.isOn || typeof this.player.getPlayerState !== 'function' || this.player.getPlayerState() !== 1) {
            return;
        }

        const currentTime = this.player.getCurrentTime();
        let currentSegment = null;
        let progress = 0;

        for (const chapter of this.chapters) {
            for (let i = 0; i < chapter.segments.length; i++) {
                const seg = chapter.segments[i];
                const nextSeg = chapter.segments[i+1];
                const endTime = nextSeg ? nextSeg.start : seg.start + 30;
                if (currentTime >= seg.start && currentTime < endTime) {
                    currentSegment = seg;
                    progress = (currentTime - seg.start) / (endTime - seg.start);
                    break;
                }
            }
            if (currentSegment) break;
        }
        
        if (currentSegment) {
            const targetProfile = getEmotionProfile(currentSegment.emotion_tag);
            this.currentEmotionState = interpolateEmotionState(this.currentEmotionState, targetProfile, 0.1);
            this.updateEmotionBar();

            if (progress < 0.1 && !currentSegment.commentaryPlayed && !this.isPlayingCommentary) {
                this.isPlayingCommentary = true;
                currentSegment.commentaryPlayed = true;
                
                const initialProfile = getEmotionProfile(currentSegment.emotion_tag);
                this.playAutoCommentary(currentSegment.summary, initialProfile.name, initialProfile.pitch, initialProfile.rate);
                
                setTimeout(() => { this.isPlayingCommentary = false; }, this.cooldown);
            }
        }
    },

    async ask(question) {
        if (!this.isOn || !this.player || typeof this.player.getCurrentTime !== 'function') return;

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
            // 1. 🟢 [추가] 현재 UI에서 선택된 모델 ID를 가져옵니다.
            const activeModelId = appState.sessions[appState.activeSessionId]?.model || 'gemini-flash-latest';

            const response = await fetch('/api/video-dialogue', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    question: question,
                    segment: currentSegment,
                    emotionState: this.currentEmotionState,
                    // 2. 🟢 [추가] 가져온 모델 ID를 함께 전송합니다.
                    modelId: activeModelId
                }),
            });
            const data = await response.json();

            // 3. 🟢 [수정] _speak 대신 playDialogueAudio를 사용합니다. (이전 버전에서 이름이 바뀌었네요, 제가 실수했습니다.)
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

    playDialogueAudio(audioContent, text) {
        let wasPlaying = this.player && typeof this.player.getPlayerState === 'function' && this.player.getPlayerState() === 1;
        if (wasPlaying) this.player.pauseVideo();
        
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        audio.play();
        this.showOverlayText(text);

        audio.onended = () => {
            if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }
        };
    },

    // [✅ 핵심] '자동 해설'을 위한 함수도 이제 단일화된 음성 출력 함수를 호출합니다.
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
                this._speak(data.audioContent, text);
            }
        } catch (error) {
            console.error('Auto Commentary Error:', error);
        }
    },

    _speak(audioContent, text) {
        // 1. 영상이 재생 중이었는지 상태를 기억합니다.
        let wasPlaying = this.player && typeof this.player.getPlayerState === 'function' && this.player.getPlayerState() === 1;

        // 2. 영상이 재생 중이었다면, 잠시 멈춥니다.
        if (wasPlaying) {
            this.player.pauseVideo();
        }
        
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        audio.play();
        this.showOverlayText(text);

        // 3. 루나의 말이 끝나면, 원래 영상이 재생 중이었을 경우에만 다시 재생합니다.
        audio.onended = () => {
            if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }
        };

        // 4. 혹시 오디오 재생에 문제가 생길 경우를 대비한 안전장치
        audio.onerror = () => {
             console.error("오디오 재생 중 오류가 발생했습니다.");
             if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }
        };
    },

    showOverlayText(text) {
        if (!this.overlayEl) this.overlayEl = document.getElementById('ai-commentary-overlay');
        this.overlayEl.textContent = text;
        this.overlayEl.classList.add('show');
        setTimeout(() => this.overlayEl.classList.remove('show'), 5000);
    },
    
    updateEmotionBar() {
        if (!this.emotionBarEl) this.emotionBarEl = document.getElementById('emotion-bar');
        if (this.currentEmotionState && this.currentEmotionState.color) {
             this.emotionBarEl.style.background = this.currentEmotionState.color;
        }
    }
};