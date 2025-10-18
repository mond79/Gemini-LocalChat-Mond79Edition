// 백엔드에서 통합 타임라인 데이터를 가져오는 함수
async function fetchTimeline() {
    try {
        // ✨ API 주소를 '/api/memories'에서 '/api/unified-timeline'으로 변경!
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
        container.innerHTML = '<p>표시할 기록이 없습니다.</p>';
        return;
    }

    let currentDay = null;
    let timelineHtml = '';

    // timeline 배열의 각 항목을 순회하며 HTML 생성
    timeline.forEach(item => {
        const itemDate = new Date(item.timestamp);
        const itemDay = itemDate.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

        // 날짜가 바뀌면, 새로운 날짜 구분선을 추가
        if (itemDay !== currentDay) {
            currentDay = itemDay;
            timelineHtml += `<h3 class="timeline-date-header" style="margin-top: 20px; padding-bottom: 5px; border-bottom: 2px solid var(--primary-color);">${currentDay}</h3>`;
        }

        // 항목의 타입('memory' 또는 'reflection')에 따라 다른 스타일을 적용
        if (item.type === 'memory') {
            const memory = item.data;
            timelineHtml += `
                <div class="memory-item" style="border-left: 3px solid var(--border-color); padding: 10px 15px; margin: 10px 0;">
                    <p style="font-size: 0.9em; margin: 0 0 8px 0;">${memory.summary}</p>
                    <div style="font-size: 0.8em; color: var(--text-color-secondary); display: flex; justify-content: space-between; align-items: center;">
                        <span>🕒 ${itemDate.toLocaleTimeString('ko-KR')}</span>
                        <span style="background-color: var(--background-color-secondary); padding: 2px 6px; border-radius: 4px;"><strong>주제:</strong> ${memory.cluster_name || '분류 안됨'}</span>
                        <span><strong>상태:</strong> ${memory.is_archived ? '🗄️ 보관됨' : '✅ 활성'}</span>
                    </div>
                </div>
            `;
        } else if (item.type === 'reflection') {
            const reflection = item.data;
            timelineHtml += `
                <div class="reflection-item" style="background-color: rgba(153, 102, 255, 0.1); border-left: 3px solid #9966FF; padding: 15px; margin: 15px 0; border-radius: 4px;">
                    <p style="margin: 0 0 10px 0; font-style: italic;"><strong>✨ AI의 성찰:</strong> ${reflection.insight_text}</p>
                    <ul style="margin: 0; padding-left: 20px; font-size: 0.85em; color: var(--text-color-secondary);">
                        <li><strong>배운 점:</strong> ${reflection.learned}</li>
                        <li><strong>개선할 점:</strong> ${reflection.improvements}</li>
                    </ul>
                </div>
            `;
        }
    });

    container.innerHTML = timelineHtml;
}

export const MemoryBrowser = {
    async render() {
        const listContainer = document.getElementById('memory-browser-list');
        if (!listContainer) return;

        listContainer.innerHTML = '<p>AI의 역사 기록을 불러오는 중...</p>';
        const timeline = await fetchTimeline();
        renderTimeline(listContainer, timeline);
    }
};