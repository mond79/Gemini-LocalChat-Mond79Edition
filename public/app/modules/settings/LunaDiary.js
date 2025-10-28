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
        if (metaBox) metaBox.innerHTML = `<p style="color:var(--text-color-secondary);">주간 보고서를 생성하는 중...</p>`;

        // 1. 모든 데이터를 병렬로 불러옵니다.
        const [stats, summaries, metaInsight] = await Promise.all([
            fetchEmotionStats(),
            fetchDailySummaries(),
            fetchLatestMetaInsight()
        ]);

        // 2. 감정 차트 렌더링
        const renderedChart = renderEmotionChart(chartCanvas, stats);
        renderCustomLegend(legendBox, renderedChart.labels, renderedChart.colors);

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