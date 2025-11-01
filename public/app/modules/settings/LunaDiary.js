// ✨ 1. color.js에서 모든 시각적 도구를 가져옵니다.
import { createDOMElement } from '../../../components/common.js';
import { emotionColorMap, emotionEmojiMap, adjustForTheme } from '../../utils/color.js';

let emotionChartInstance = null;

// API 호출부 (감정 통계)
async function fetchEmotionStats() {
    try {
        const res = await fetch('/api/emotion-stats');
        if (!res.ok) throw new Error('감정 통계 데이터 로드 실패');
        return await res.json();
    } catch (e) {
        console.error('[LunaDiary] emotion-stats API 오류:', e);
        return null;
    }
}

// API 호출부: 하루 요약 목록
async function fetchDailySummaries() {
    try {
        const res = await fetch('/api/daily-summaries');
        if (!res.ok) throw new Error('하루 요약 데이터 로드 실패');
        return await res.json();
    } catch (e) {
        console.error('[LunaDiary] daily-summaries API 오류:', e);
        return [];
    }
}

// ✨ API 호출: 최신 주간 메타 성찰
async function fetchLatestMetaInsight() {
    try {
        // [핵심] 이제 안전한 GET 방식의 '/api/latest-weekly-report' API를 호출합니다.
        const res = await fetch('/api/latest-weekly-report');
        if (!res.ok) throw new Error('최신 주간 보고서 데이터 로드 실패');
        
        const data = await res.json();
        return data.ok ? data : null;
    } catch (e) {
        console.error('[LunaDiary] latest-weekly-report API 오류:', e);
        return null;
    }
}

// 성장 기록(Reflections) 탐색 API 호출부 
async function fetchReflections({ query, time_range, limit = 50, sort_by = 'latest' }) {
    try {
        const response = await fetch('/api/query-reflections', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, time_range, limit, sort_by }),
        });
        if (!response.ok) throw new Error('성찰 기록 쿼리 API 응답 실패');
        return await response.json();
    } catch (error) {
        console.error('[LunaDiary] query-reflections API 오류:', error);
        return []; // 실패 시 빈 배열 반환
    }
}

// 도넛 차트 렌더링
function renderEmotionChart(canvas, chartData) {
    if (emotionChartInstance) emotionChartInstance.destroy();
    if (!canvas) return { labels: [], data: [], colors: [] };
    const ctx = canvas.getContext('2d');
    const root = document.documentElement;
    const textColor = getComputedStyle(root).getPropertyValue('--text-color-primary').trim();
    const bgSecondary = getComputedStyle(root).getPropertyValue('--background-color-secondary').trim();

    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        ctx.font = '16px sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.fillText('아직 분석할 감정 데이터가 없습니다.', canvas.width / 2, 50);
        return { labels: [], data: [], colors: [] };
    }

    const labels = chartData.labels.map(l => l ?? '기록 없음');
    // ✨ 테마에 맞게 보정된 색상을 사용합니다.
    const colors = labels.map(label => adjustForTheme(emotionColorMap[label] || '#E0E0E0'));

    emotionChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: chartData.data, backgroundColor: colors, borderColor: bgSecondary, borderWidth: 3, hoverOffset: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, cutout: '60%',
            plugins: {
                legend: { display: false },
                title: { display: false },

                tooltip: {
                    // 툴팁 상자 스타일
                    backgroundColor: bgSecondary,
                    // ✨ 툴팁 본문의 글자 색상만 지정합니다.
                    bodyColor: textColor, 
                    // ✨ 제목 부분의 글자 색상은 사용하지 않습니다.
                    titleColor: 'rgba(0, 0, 0, 0)',

                    // ✨ 툴팁 내용을 만드는 콜백 함수
                    callbacks: {
                        // ✨ 제목(title) 콜백은 빈 문자열을 반환하여 아예 표시되지 않게 합니다.
                        title: function(context) {
                            return '';
                        },

                        // ✨ 본문(label) 콜백이 '제목: 값'의 역할을 모두 수행합니다.
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            return `${label}: ${value} 회`;
                        }
                    }
                }
                // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
            }
        }
    });

    return { labels, data: chartData.data, colors };
}

// 커스텀 범례(Legend) 렌더링
function renderCustomLegend(container, labels, colors) {
    if (!container) return;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();
    const items = labels.map((label, i) => `
      <div style="display:flex; align-items:center; gap:8px; margin:6px 10px;">
        <span style="width:12px; height:12px; border-radius:50%; background:${colors[i]};"></span>
        <span style="font-size:0.95em; color:${textColor};">${label}</span>
        <span style="font-size:0.95em; opacity:0.9;">${emotionEmojiMap[label] || '•'}</span>
      </div>`).join('');
    container.innerHTML = `<div style="display:flex; flex-wrap:wrap; justify-content:center;">${items}</div>`;
}

// 감성 인사이트 문장 렌더링 (✨ 안정성 강화 버전)
function renderEmotionInsight(container, summary) { // 'summary'는 latestSummary 객체입니다.
    if (!container) return;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();
    
    let emoji = '🗓️';
    let sentence;

    // ✨ summary 객체가 null이 아닐 때만 내부 속성에 접근합니다.
    if (summary && summary.narrative) {
        emoji = emotionEmojiMap[summary.dominant_emotion] || '🗓️';
        sentence = summary.narrative;
    } else {
        // ✨ summary가 null이거나 narrative가 없을 경우, 기본 문장을 설정합니다.
        sentence = "오늘의 일기는 아직 작성되지 않았습니다.";
    }

    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; margin:15px 0; padding:12px; background:var(--background-color-secondary); border-radius:8px;">
        <span style="font-size:1.5rem; line-height:1;">${emoji}</span>
        <p style="margin:0; color:${textColor}; font-size:1.05rem; font-style:italic;">${sentence}</p>
      </div>`;
}

// '성장 일기' 타임라인 렌더링 
function renderReflectionTimeline(container, entries) {
    if (!container) return;
    
    if (!entries || entries.length === 0) {
        container.innerHTML = `<p style="color:var(--text-color-secondary);">표시할 성장 일기가 없습니다.</p>`;
        return;
    }

    const timelineHtml = entries.map((entry, index) => {
        let entryDateString, narrativeHtml, chipsHtml;

        // [핵심] marked.parse() 함수를 사용하여 DB 데이터를 HTML로 변환합니다.
        if (entry.narrative) { // '하루 요약' 데이터 처리
            entryDateString = entry.entry_date;
            // '하루 요약' 서사도 마크다운으로 처리하여 줄바꿈 등을 예쁘게 보여줍니다.
            narrativeHtml = marked.parse(entry.narrative || ''); 
            const emotionCounts = entry.emotion_counts ? JSON.parse(entry.emotion_counts) : {};
            chipsHtml = Object.entries(emotionCounts).map(([emotion, count]) => 
                `<span class="emotion-chip">${emotionEmojiMap[emotion] || ''} ${emotion} ${count}회</span>`
            ).join('');
        
        } else { // '성장 기록' 데이터 처리
            entryDateString = entry.entry_date;
            
            // ▼▼▼ 바로 이 부분이 '코드 형식'을 되살리는 핵심입니다! ▼▼▼
            // DB에서 가져온 learned, improvements 등의 텍스트를 marked.parse()로 처리합니다.
            // 이렇게 하면 내부에 있던 백틱(```)이 <pre><code> 태그로 변환됩니다.
            const learnedContent = marked.parse(entry.learned || '*기록 없음*');
            const improvementsContent = marked.parse(entry.improvements || '*기록 없음*');
            const insightContent = marked.parse(entry.insight_text || '*기록 없음*');

            narrativeHtml = `
                <div class="diary-entry-section"><strong>배운 점:</strong>${learnedContent}</div>
                <div class="diary-entry-section"><strong>개선할 점:</strong>${improvementsContent}</div>
                <div class="diary-entry-section"><strong>인사이트:</strong>${insightContent}</div>
            `;
            const emotion = entry.emotional_weight || 'neutral';
            chipsHtml = `<span class="emotion-chip">${emotionEmojiMap[emotion] || ''} ${emotion}</span>`;
        }

        // 날짜 변환 로직 
        let formattedDate = '날짜 기록 없음';
        if (entryDateString) {
            const parts = entryDateString.split('-');
            if (parts.length === 3) {
                const dateObj = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                if (!isNaN(dateObj)) {
                    formattedDate = dateObj.toLocaleDateString('ko-KR', {
                        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', timeZone: 'UTC'
                    });
                }
            }
        }
        
        const itemHtml = `
            <div class="reflection-item" style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 8px 0; color: var(--text-color-primary);">${formattedDate}</h4>
                <div style="margin:0 0 10px 0; color: var(--text-color-primary);">${narrativeHtml}</div>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">${chipsHtml}</div>
            </div>`;

        const separator = index < entries.length - 1 ? '<hr style="border: 0; border-top: 1px solid var(--border-color); margin: 25px 0;">' : '';
        
        return itemHtml + separator;

    }).join('');

    container.innerHTML = timelineHtml;

    // [추가] highlight.js를 다시 실행하여 새로 생긴 코드 블록에 색을 입힙니다.
    container.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
}

// ✨ 주간 메타 성찰 UI를 렌더링하는 새로운 함수
function renderMetaInsight(container, report) {
    if (!container) return;
    const secondaryColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-secondary').trim();

    if (!report || !report.narrative) {
        container.innerHTML = `<p style="color:${secondaryColor}; margin-top: 10px;">표시할 주간 보고서가 아직 없습니다.</p>`;
        return;
    }

    const { range, narrative, stats } = report;

    // --- [✨ 진짜 최종 수정] 모든 데이터의 존재 여부를 한 단계씩 안전하게 확인합니다. ---
    
    // 1. stats 객체가 없는 경우
    if (!stats) {
        container.innerHTML = `
            <div class="weekly-insight-card">
                <h4 class="weekly-insight-card__title">✨ 루나의 주간 성찰 리포트</h4>
                <p class="weekly-insight-card__narrative">"${narrative}"</p>
            </div>`;
        return;
    }

    // 2. stats는 있지만, 상세 데이터가 부족할 경우를 대비한 기본값 설정
    const startDate = range?.startISO ? new Date(range.startISO).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '정보 없음';
    const endDate = range?.endISO ? new Date(new Date(range.endISO).getTime() - 86400000).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' }) : '';
    
    // [핵심] 바로 이 부분에서 오류가 발생했습니다. distribution이 비어있을 수 있습니다.
    const dominantOverall = stats.emotionStats?.overall?.distribution?.[0];
    
    const dominantEmoji = dominantOverall ? emotionEmojiMap[dominantOverall.emotion] || '🤔' : '🤔';
    const dominantEmotionText = dominantOverall ? dominantOverall.emotion : '기록 없음';
    const avgMinutesText = stats.sessionStats?.avgMinutes ?? '0'; // ?? 연산자로 null/undefined일 경우 0으로 처리
    const volatilityText = stats.emotionStats?.focus?.volatility ?? 'N/A';

    // 3. 이제 모든 데이터가 안전하게 준비되었으므로, 최종 UI를 그립니다.
    container.innerHTML = `
        <div class="weekly-insight-card">
            <h4 class="weekly-insight-card__title">✨ 루나의 주간 성찰 리포트</h4>
            <p class="weekly-insight-card__narrative">"${narrative}"</p>
            <div class="weekly-insight-card__stats">
                <span>🗓️ <strong>기간:</strong> ${startDate} ~ ${endDate}</span>
                <span>${dominantEmoji} <strong>주요 감정:</strong> ${dominantEmotionText}</span>
                <span>⏱️ <strong>평균 집중:</strong> ${avgMinutesText}분</span>
                <span>📈 <strong>감정 변동성(Focus):</strong> ${volatilityText}</span>
            </div>
        </div>
    `;
}

export const LunaDiary = {
    isInitialized: false, // 초기화 여부를 기억하는 '깃발'

    // [역할 1] '성장 기록' 목록을 검색하고 다시 그리는 함수
    async handleSearch() {
        const queryInput = document.getElementById('diary-search-query');
        const timeRangeSelect = document.getElementById('diary-time-range');
        const timelineContainer = document.getElementById('reflection-timeline-container');

        if (!queryInput || !timeRangeSelect || !timelineContainer) return;
        
        timelineContainer.innerHTML = `<p style="color:var(--text-color-secondary);">모든 기록을 검색하는 중...</p>`;

        const query = queryInput.value.toLowerCase(); // 검색어는 소문자로 바꿔서 비교
        const timeRange = timeRangeSelect.value;

        const [reflections, allSummaries] = await Promise.all([
            fetchReflections({
                query: query,
                time_range: timeRange
            }),
            fetchDailySummaries()
        ]);

        // --- [핵심 수정] ---
        // 가져온 '모든 하루 일기(allSummaries)'를 여기서 직접 필터링합니다.
        const filteredSummaries = allSummaries.filter(summary => {
            // 1. 키워드 필터링: 일기 내용(narrative)에 검색어가 포함되어 있는지 확인
            const matchesQuery = !query || (summary.narrative && summary.narrative.toLowerCase().includes(query));

            // 2. 기간 필터링
            if (!matchesQuery) return false; // 키워드가 안 맞으면 바로 탈락

            if (timeRange === '전체') {
                return true; // '전체' 기간이면 무조건 통과
            }
            
            const entryDate = new Date(summary.entry_date);
            const today = new Date();
            let startDate = new Date();

            if (timeRange === '지난 7일') {
                startDate.setDate(today.getDate() - 7);
            } else if (timeRange === '지난 30일') {
                startDate.setDate(today.getDate() - 30);
            }
            // entryDate가 startDate 이후인지 확인 (시간은 무시하고 날짜만 비교)
            return entryDate.setHours(0,0,0,0) >= startDate.setHours(0,0,0,0);
        });
        
        // 필터링된 '성찰 기록'과, 여기서 직접 필터링한 '하루 일기'를 합칩니다.
        const combinedEntries = [...reflections, ...filteredSummaries];
        combinedEntries.sort((a, b) => new Date(b.entry_date) - new Date(a.entry_date));
        
        renderReflectionTimeline(timelineContainer, combinedEntries);
    },

    // [역할 2] 탭이 보일 때마다 호출되는 '진입점' 함수
    async show() {
        if (!this.isInitialized) {
            console.warn("[LunaDiary] 아직 초기화되지 않았습니다. init()이 먼저 호출되어야 합니다.");
            return;
        }
        // 탭이 보일 때마다 항상 최신 검색 결과를 보여줍니다.
        await this.handleSearch();
    },

    // [역할 3] '최초 1회'만 실행되는 진짜 '초기화' 함수
    async init() {
        if (this.isInitialized) return; // 이미 초기화되었으면 아무것도 하지 않음
        console.log('📔 루나의 통합 일기장 모듈 v2.5 (중복 선언 및 이벤트 버그 수정) 초기화 시작...');
        
        // 1. 상단 감성 요약 부분 렌더링
        const chartCanvas = document.getElementById('emotion-chart');
        const legendBox   = document.getElementById('emotion-legend');
        const metaBox     = document.getElementById('meta-insight-container');

        if (metaBox) metaBox.innerHTML = `<p>주간 보고서를 불러오는 중...</p>`;
        
        const [stats, metaInsight] = await Promise.all([
            fetchEmotionStats(),
            fetchLatestMetaInsight()
        ]);

        const renderedChart = renderEmotionChart(chartCanvas, stats);
        if (renderedChart) {
            renderCustomLegend(legendBox, renderedChart.labels, renderedChart.colors);
        }
        renderMetaInsight(metaBox, metaInsight);

        // --- [수정] 필요한 DOM 요소들을 여기서 한 번만 찾아옵니다. ---
        const searchButton = document.getElementById('diary-search-btn');
        const timeRangeSelect = document.getElementById('diary-time-range');
        const queryInput = document.getElementById('diary-search-query');
        
        // 2. 동적 스타일 적용 로직
        function applyThemeStyles() {
            const isDarkMode = document.body.classList.contains('dark-mode');
            if (searchButton) { // 이미 위에서 찾은 변수를 사용합니다.
                searchButton.style.border = '1px solid';
                if (isDarkMode) {
                    searchButton.style.backgroundColor = 'var(--primary-color)';
                    searchButton.style.color = 'white';
                    searchButton.style.borderColor = 'var(--primary-color)';
                } else {
                    searchButton.style.backgroundColor = 'white';
                    searchButton.style.color = '#555';
                    searchButton.style.borderColor = '#ccc';
                }
            }
            if (timeRangeSelect) { // 이미 위에서 찾은 변수를 사용합니다.
                if (isDarkMode) {
                    timeRangeSelect.style.backgroundColor = '#3a3a3c';
                    timeRangeSelect.style.color = '#f2f2f7';
                } else {
                    timeRangeSelect.style.backgroundColor = 'white';
                    timeRangeSelect.style.color = 'var(--text-color)';
                }
            }
        }

        // 3. 이벤트 연결 (✨✨✨ 최종 수정 포인트 ✨✨✨)
        if (searchButton && !searchButton.dataset.initialized) {
        
        searchButton.addEventListener('click', (e) => { 
            e.preventDefault(); // 1. 혹시 모를 기본 동작(새로고침) 방지
            e.stopImmediatePropagation(); // 2. [핵심!] 이벤트가 SettingsController로 전파되는 것을 차단!
            this.handleSearch();
        });
        
        queryInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // 1. 기본 동작(새로고침) 방지
                e.stopImmediatePropagation(); // 2. [핵심!] 이벤트 전파 차단!
                this.handleSearch();
            }
        });
            
            const themeObserver = new MutationObserver(applyThemeStyles);
            themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
            
            searchButton.dataset.initialized = 'true';
        }
        
        applyThemeStyles();

        this.isInitialized = true;

        // ▼▼▼ 이 }; 바로 위에 아래 한 줄을 추가해주세요 ▼▼▼
        window.LunaDiary = LunaDiary; 
    }
};