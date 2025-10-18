// 백엔드에서 통합 타임라인 데이터를 가져오는 함수
async function fetchTimeline() {
    try {
        const response = await fetch('/api/unified-timeline');
        if (!response.ok) throw new Error('타임라인 데이터 로드 실패');
        return await response.json();
    } catch (error) {
        console.error('타임라인을 불러오는 중 오류:', error);
        return null;
    }
}

// 타임라인 데이터를 받아서 HTML로 변환하고 렌더링하는 함수
function renderTimeline(container, timeline) {
    if (!container) return;
    
    if (!timeline || timeline.length === 0) {
        container.innerHTML = '<p>표시할 기록이 없습니다. AI와 대화를 나누고 자정이 지나면 기록이 생성됩니다.</p>';
        return;
    }

    const emotionMap = {
        '긍정': { icon: '😊', color: '#4CAF50' },
        '성취': { icon: '🏆', color: '#FFC107' },
        '중립': { icon: '😐', color: '#9E9E9E' },
        '부정': { icon: '😟', color: '#F44336' },
        '혼란': { icon: '🤔', color: '#2196F3' }
    };

    let currentDay = null;
    let timelineHtml = '';

    timeline.forEach(item => {
        const itemDate = new Date(item.timestamp);
        const itemDay = itemDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

        if (itemDay !== currentDay) {
            currentDay = itemDay;
            timelineHtml += `<h3 class="timeline-date-header" style="margin-top: 20px; padding-bottom: 5px; border-bottom: 2px solid var(--primary-color); color: var(--text-color-primary);">${currentDay}</h3>`;
        }

        if (item.type === 'memory') {
            const memory = item.data;
            timelineHtml += `
                <div class="memory-item" style="border-left: 3px solid var(--border-color); padding: 10px 15px; margin: 10px 0;">
                    <p style="font-size: 0.9em; margin: 0 0 8px 0; color: var(--text-color-primary);">${memory.summary}</p>
                    <div style="font-size: 0.8em; color: var(--text-color-secondary); display: flex; justify-content: space-between; align-items: center;">
                        <span>🕒 ${itemDate.toLocaleTimeString('ko-KR')}</span>
                        <span style="background-color: var(--background-color-secondary); padding: 2px 6px; border-radius: 4px;"><strong>주제:</strong> ${memory.cluster_name || '분류 안됨'}</span>
                        <span><strong>상태:</strong> ${memory.is_archived ? '🗄️ 보관됨' : '✅ 활성'}</span>
                    </div>
                </div>
            `;
        } else if (item.type === 'reflection') {
            const reflection = item.data;
            
            // ✨ 1. emotional_weight 값이 null이나 undefined일 경우를 대비해 '중립'을 기본값으로 설정합니다.
            const emotionKey = reflection.emotional_weight || '중립';
            const emotion = emotionMap[emotionKey];

            // ✨ 2. 배경색은 감정색의 15% 투명도를, 테두리는 100% 감정색을 사용합니다.
            timelineHtml += `
                <div class="reflection-item" style="background-color: rgba(${hexToRgb(emotion.color)}, 0.15); border-left: 4px solid ${emotion.color}; padding: 15px; margin: 15px 0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
                    <p style="margin: 0 0 12px 0; font-size: 1.05em; color: var(--text-color-primary);">
                        <span style="font-size: 1.5em; vertical-align: -3px; margin-right: 8px;">${emotion.icon}</span> 
                        <strong style="color: ${emotion.color}; font-weight: 600;">AI의 성찰 (${emotionKey}):</strong>
                        <span style="font-style: italic;">${reflection.insight_text}</span>
                    </p>
                    <ul style="margin: 0; padding-left: 30px; font-size: 0.9em; color: var(--text-color-secondary); list-style-type: '– ';">
                        <li><strong>배운 점:</strong> ${reflection.learned}</li>
                        <li style="margin-top: 5px;"><strong>개선할 점:</strong> ${reflection.improvements}</li>
                    </ul>
                </div>
            `;
        }
    });

    container.innerHTML = timelineHtml;
}

// ✨ HEX 색상 코드를 RGBA에서 사용할 수 있도록 변환하는 헬퍼 함수
function hexToRgb(hex) {
    if (!hex) return '128,128,128'; // 기본 회색
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) { // #RGB 형식
        r = "0x" + hex[1] + hex[1];
        g = "0x" + hex[2] + hex[2];
        b = "0x" + hex[3] + hex[3];
    } else if (hex.length === 7) { // #RRGGBB 형식
        r = "0x" + hex[1] + hex[2];
        g = "0x" + hex[3] + hex[4];
        b = "0x" + hex[5] + hex[6];
    }
    return `${+r},${+g},${+b}`;
}

// ✨ 이 부분이 가장 중요합니다!
// SettingsController에서 호출할 수 있도록 render 함수를 가진 객체를 export 합니다.
export const MemoryBrowser = {
    async render() {
        const listContainer = document.getElementById('memory-browser-list');
        if (!listContainer) {
            // 아직 UI가 준비되지 않았을 수 있으므로, 잠시 후 다시 시도합니다.
            setTimeout(() => this.render(), 100);
            return;
        }

        listContainer.innerHTML = '<p style="color: var(--text-color-secondary);">AI의 역사 기록을 불러오는 중...</p>';
        const timeline = await fetchTimeline();
        renderTimeline(listContainer, timeline);
    }
};