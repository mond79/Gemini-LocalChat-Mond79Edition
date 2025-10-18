async function fetchMemories() {
    try {
        const response = await fetch('/api/memories');
        if (!response.ok) throw new Error('기억 데이터 로드 실패');
        return await response.json();
    } catch (error) {
        console.error('기억을 불러오는 중 오류:', error);
        return null;
    }
}

function renderMemoryList(container, memories) {
    if (!container) return;
    
    if (!memories || memories.length === 0) {
        container.innerHTML = '<p>표시할 기억이 없습니다.</p>';
        return;
    }

    const memoriesHtml = memories.map(memory => `
        <div class="memory-item" style="border-bottom: 1px solid var(--border-color); padding: 10px 5px; margin-bottom: 5px;">
            <p style="font-size: 0.9em; margin: 0 0 5px 0;"><strong>ID ${memory.id}:</strong> ${memory.summary}</p>
            <div style="font-size: 0.8em; color: var(--text-color-secondary); display: flex; justify-content: space-between;">
                <span>📅 ${new Date(memory.timestamp).toLocaleString()}</span>
                <span><strong>주제:</strong> ${memory.cluster_name || '분류 안됨'}</span>
                <span><strong>상태:</strong> ${memory.is_archived ? '🗄️ 보관됨' : '✅ 활성'}</span>
            </div>
        </div>
    `).join('');

    container.innerHTML = memoriesHtml;
}

export const MemoryBrowser = {
    async render() {
        const listContainer = document.getElementById('memory-browser-list');
        if (!listContainer) return;

        listContainer.innerHTML = '<p>기억을 불러오는 중...</p>';
        const memories = await fetchMemories();
        renderMemoryList(listContainer, memories);
    }
};