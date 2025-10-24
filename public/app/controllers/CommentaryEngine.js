// public/app/controllers/CommentaryEngine.js (✨ 최종 완성본)

export const CommentaryEngine = {
    player: null,
    chapters: [],
    intervalId: null,
    isPlayingCommentary: false,
    cooldown: 7000,

    overlayEl: document.getElementById('ai-commentary-overlay'),
    emotionBarEl: document.getElementById('emotion-bar'),

    emotionColors: {
        calm: "linear-gradient(90deg,#90caf9,#64b5f6)",
        tense: "linear-gradient(90deg,#ef5350,#d32f2f)",
        emotional: "linear-gradient(90deg,#ba68c8,#8e24aa)",
        funny: "linear-gradient(90deg,#ffb74d,#f57c00)",
        excited: "linear-gradient(90deg,#81c784,#43a047)",
        sad: "linear-gradient(90deg,#90a4ae,#607d8b)",
        neutral: "linear-gradient(90deg,#e0e0e0,#bdbdbd)", // 중립 감정 추가
    },

    start(player, chapters) {
        this.stop(); // 새로운 해설 시작 전, 기존 엔진은 반드시 멈춥니다.
        this.player = player;
        this.chapters = chapters;
        console.log("🎙️ Commentary Engine v2.6 FINAL Started.");
        
        this.intervalId = setInterval(() => this.loop(), 3000);
    },

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            this.player = null;
            this.isPlayingCommentary = false; // 상태 초기화
            console.log("🎙️ Commentary Engine Stopped and Cleaned Up.");
        }
    },

    loop() {
        if (!this.player || typeof this.player.getPlayerState !== 'function' || this.isPlayingCommentary) {
            return;
        }
        
        // YT.PlayerState.PLAYING (값: 1)
        if (this.player.getPlayerState() !== 1) {
            return; // 영상이 재생 중이 아니면 아무것도 하지 않음
        }

        const currentTime = this.player.getCurrentTime();
        let activeSegment = null;

        for (const chapter of this.chapters) {
            for (const segment of chapter.segments) {
                // 이 세그먼트가 이미 해설되었는지 확인
                if (segment.commentaryPlayed) continue;

                const nextSegment = chapter.segments[chapter.segments.indexOf(segment) + 1];
                const endTime = nextSegment ? nextSegment.start : segment.start + 30;
                if (currentTime >= segment.start && currentTime < endTime) {
                    activeSegment = segment;
                    break;
                }
            }
            if (activeSegment) break;
        }

        if (activeSegment) {
            this.isPlayingCommentary = true;
            activeSegment.commentaryPlayed = true; // 해설 재생 플래그 설정
            this.playCommentary(activeSegment);
            setTimeout(() => { this.isPlayingCommentary = false; }, this.cooldown);
        }
    },

    async playCommentary(segment) {
        let wasPlaying = this.player.getPlayerState() === 1;
        try {
            if(wasPlaying) this.player.pauseVideo();

            const response = await fetch('/api/generate-commentary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: segment.summary,
                    emotion: segment.emotion_tag || 'calm',
                }),
            });
            const data = await response.json();

            if (data.audioContent) {
                const audio = new Audio("data:audio/mp3;base64," + data.audioContent);
                audio.volume = 0.9;
                audio.play();
                
                audio.onended = () => {
                    if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                        this.player.playVideo();
                    }
                };
                
                this.updateEmotionBar(segment.emotion_tag);
                this.showOverlayText(segment.summary);
            } else {
                if (wasPlaying) this.player.playVideo();
            }
        } catch (error) {
            console.error('Commentary Playback Error:', error);
            if (wasPlaying && this.player && typeof this.player.playVideo === 'function') {
                this.player.playVideo();
            }
        }
    },
    
    showOverlayText(text) {
        if (!this.overlayEl) this.overlayEl = document.getElementById('ai-commentary-overlay');
        this.overlayEl.textContent = text;
        this.overlayEl.classList.add('show');
        setTimeout(() => this.overlayEl.classList.remove('show'), 5000);
    },
    updateEmotionBar(emotion) {
        if (!this.emotionBarEl) this.emotionBarEl = document.getElementById('emotion-bar');
        const emotionKey = emotion || 'calm';
        this.emotionBarEl.style.background = this.emotionColors[emotionKey] || this.emotionColors.calm;
    }
};