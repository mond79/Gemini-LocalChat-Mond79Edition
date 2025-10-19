// ✨ 1. color.js에서 모든 시각적 도구를 가져옵니다.
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
        const res = await fetch('/api/emotion-meta');
        if (!res.ok) throw new Error('메타 성찰 데이터 로드 실패');
        return await res.json();
    } catch (e) {
        console.error('[LunaDiary] emotion-meta API 오류:', e);
        return null;
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

                // ▼▼▼▼▼ 바로 이 부분을 아래의 최종 코드로 교체해주세요 ▼▼▼▼▼
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

// '성장 일기' 타임라인 렌더링 (진짜 최종 수정본)
function renderReflectionTimeline(container, summaries) {
    if (!container) return;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-secondary').trim();
    if (!summaries || summaries.length === 0) {
        container.innerHTML = `<p style="color:${textColor};">표시할 성장 일기가 없습니다.</p>`;
        return;
    }

    container.innerHTML = summaries.map(summary => {
        // 1. summary 객체에서 데이터를 안전하게 추출합니다.
        const entryDateString = summary.entry_date || ''; // 변수 이름을 'entryDateString'으로 사용
        const narrative = summary.narrative || '요약 내용이 없습니다.';
        const emotionCounts = summary.emotion_counts ? JSON.parse(summary.emotion_counts) : {};

        const chips = Object.entries(emotionCounts).map(([emotion, count]) => 
            `<span style="background-color: var(--background-color-tertiary); color: var(--text-color-secondary); font-size: 0.8em; padding: 2px 8px; border-radius: 12px; margin-right: 6px;">
                ${emotionEmojiMap[emotion] || ''} ${emotion} ${count}회
            </span>`
        ).join('');

        // 2. 날짜 문자열을 변환하는 로직입니다.
        let formattedDate = '날짜 기록 없음';
        if (entryDateString) { // 'entryDateString' 변수를 사용합니다.
            const parts = entryDateString.split('-');
            if (parts.length === 3) {
                // new Date(년, 월-1, 일) 형식으로 안전하게 생성
                const dateObj = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
                if (!isNaN(dateObj)) {
                    formattedDate = dateObj.toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'long',
                        timeZone: 'UTC' // UTC 기준으로 날짜를 해석하도록 하여 하루 차이 문제 방지
                    });
                }
            }
        }
        
        // 3. 최종 HTML을 생성합니다.
        return `
            <div class="reflection-item" style="margin-bottom: 20px;">
                <h4 style="margin: 0 0 8px 0; color: var(--text-color-primary);">
                    ${formattedDate} 
                </h4>
                <p style="margin:0 0 10px 0; color: var(--text-color-primary); font-style: italic;">
                    "${narrative}"
                </p>
                <div style="display: flex; flex-wrap: wrap; gap: 5px;">${chips}</div>
            </div>`;
    }).join('<hr style="border: 0; border-top: 1px solid var(--border-color); margin: 25px 0;">');
}

// ✨ 주간 메타 성찰 UI를 렌더링하는 새로운 함수
function renderMetaInsight(container, insight) {
    if (!container) return;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();
    const secondaryColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-secondary').trim();

    if (!insight || !insight.narrative) {
        container.innerHTML = `<p style="color:${secondaryColor};">표시할 주간 메타 성찰이 아직 없습니다. (매주 일요일 자정에 자동 생성됩니다)</p>`;
        return;
    }

    const dominantEmoji = emotionEmojiMap[insight.dominant_emotion] || '🤔';
    
    container.innerHTML = `
        <div style="background-color: var(--background-color-secondary); border-left: 5px solid var(--primary-color); padding: 15px 20px; border-radius: 8px;">
            <p style="margin: 0; color: ${textColor}; white-space: pre-wrap; line-height: 1.6;">${insight.narrative}</p>
            <div style="margin-top: 15px; font-size: 0.9em; color: ${secondaryColor};">
                <strong>주간 요약:</strong> ${dominantEmoji} ${insight.dominant_emotion}
            </div>
        </div>
    `;
}

// --- 최종 Export ---
// --- 최종 Export ---
export const LunaDiary = {
    async render() {
        // 1. UI 컨테이너들을 가져옵니다.
        const chartCanvas = document.getElementById('emotion-chart');
        const insightBox  = document.getElementById('emotion-insight');
        const legendBox   = document.getElementById('emotion-legend');
        const diaryBox    = document.getElementById('reflection-timeline-container');
        const metaBox     = document.getElementById('meta-insight-container');

        // 2. 로딩 메시지를 먼저 표시합니다.
        if (insightBox) insightBox.innerHTML = `<p style="color:var(--text-color-secondary);">감정 데이터를 불러오는 중...</p>`;
        if (diaryBox) diaryBox.innerHTML = `<p style="color:var(--text-color-secondary);">루나의 일기를 정리하는 중...</p>`;
        if (metaBox) metaBox.innerHTML = `<p style="color:var(--text-color-secondary);">주간 메타 성찰을 불러오는 중...</p>`;

        // 1. 모든 데이터를 병렬로 불러옵니다.
        const [stats, summaries, metaInsight] = await Promise.all([
            fetchEmotionStats(),
            fetchDailySummaries(),
            fetchLatestMetaInsight()
        ]);

        // 2. 감정 차트 렌더링
        const renderedChart = renderEmotionChart(chartCanvas, stats);
        renderCustomLegend(legendBox, renderedChart.labels, renderedChart.colors);

        // ▼▼▼▼▼ 바로 이 부분을 다시 수정합니다! ▼▼▼▼▼

        // 3. '오늘의 일기'와 '과거의 일기'로 데이터를 분리합니다.
        const latestSummary = summaries && summaries.length > 0 ? summaries[0] : null;
        const pastSummaries = summaries && summaries.length > 1 ? summaries.slice(1) : []; // 두 번째 항목부터 끝까지

        // 4. 감성 인사이트에는 '오늘의 일기'만 전달합니다.
        renderEmotionInsight(insightBox, latestSummary);
        
        // 5. 성장 일기 타임라인에는 '과거의 일기' 목록만 전달합니다.
        renderReflectionTimeline(diaryBox, pastSummaries);
        
        // 6. 주간 메타 성찰 렌더링
        renderMetaInsight(metaBox, metaInsight);
    }
};