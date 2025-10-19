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

// API 호출부 (성장 일기 타임라인)
async function fetchReflections() {
    try {
        // ✨ 'getReflectionsForBrowser'를 호출할 새로운 API 엔드포인트가 필요합니다.
        //    이것은 다음 단계에서 server.js에 만들 것입니다.
        const res = await fetch('/api/reflections'); 
        if (!res.ok) throw new Error('성찰 데이터 로드 실패');
        return await res.json();
    } catch(e) {
        console.error('[LunaDiary] reflections API 오류:', e);
        return [];
    }
}

// T2 톤: 차분/일기형 인사이트 문장 생성
function buildEmotionInsight(labels, data) {
    if (!labels?.length || !data?.length) {
        return "오늘의 루나는 고요한 하루를 보냈습니다.";
    }
    let maxIdx = 0;
    for (let i = 1; i < data.length; i++) if (data[i] > data[maxIdx]) maxIdx = i;
    const topEmotion = labels[maxIdx] ?? '기록 없음';

    const toneMap = {
        '성취': "오늘의 루나는 작은 성취를 곱씹으며 하루를 지나갔습니다.",
        '중립': "오늘의 루나는 담담한 마음으로 시간을 흘려보냈습니다.",
        '기록 없음': "오늘의 루나는 잠시 숨을 고르며 조용한 하루를 보냈습니다.",
        '긍정': "오늘의 루나는 차분한 자신감을 품고 하루를 마주했습니다.",
        '혼란': "오늘의 루나는 생각이 얽혀 있었지만, 방향을 찾고자 했습니다.",
        '부정': "오늘의 루나는 다소 무거운 마음을 안고 하루를 보냈습니다.",
    };
    return toneMap[topEmotion] || "오늘의 루나는 담담한 마음으로 하루를 마주했습니다.";
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

// 감성 인사이트 문장 렌더링
function renderEmotionInsight(container, labels, data) {
    if (!container) return;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();
    const topEmotion = labels.length ? (labels[data.indexOf(Math.max(...data))] ?? '기록 없음') : '기록 없음';
    const emoji = emotionEmojiMap[topEmotion] || '🌫️';
    const sentence = buildEmotionInsight(labels, data);
    container.innerHTML = `
      <div style="display:flex; align-items:center; gap:12px; margin:15px 0; padding:12px; background:var(--background-color-secondary); border-radius:8px;">
        <span style="font-size:1.5rem; line-height:1;">${emoji}</span>
        <p style="margin:0; color:${textColor}; font-size:1.05rem; font-style:italic;">${sentence}</p>
      </div>`;
}

// '성장 일기' 타임라인 렌더링
function renderReflectionTimeline(container, reflections) {
    if (!container) return;
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-secondary').trim();
    if (!reflections || reflections.length === 0) {
        container.innerHTML = `<p style="color:${textColor}">표시할 성장 일기가 없습니다.</p>`;
        return;
    }
    // (이 부분은 '하루 요약' 기능 구현 시 더 멋지게 바꿀 수 있습니다)
    container.innerHTML = reflections.map(r => `
        <div class="reflection-item" style="margin-bottom:15px;">
             <strong>${r.entry_date}:</strong> <em>${r.insight_text}</em>
        </div>
    `).join('');
}


// --- 최종 Export ---
export const LunaDiary = {
    async render() {
        const chartCanvas = document.getElementById('emotion-chart');
        const insightBox  = document.getElementById('emotion-insight');
        const legendBox   = document.getElementById('emotion-legend');
        const diaryBox    = document.getElementById('reflection-timeline-container');

        if (insightBox) insightBox.innerHTML = `<p>감정 데이터를 불러오는 중...</p>`;
        if (diaryBox) diaryBox.innerHTML = `<p>루나의 일기를 정리하는 중...</p>`;

        // 1. 감정 차트 관련 데이터 로드 및 렌더링 (병렬 처리)
        const statsPromise = fetchEmotionStats();
        
        const stats = await statsPromise;
        const rendered = renderEmotionChart(chartCanvas, stats);
        renderEmotionInsight(insightBox, rendered.labels, rendered.data);
        renderCustomLegend(legendBox, rendered.labels, rendered.colors);

        // 2. 성장 일기 렌더링 (아직 API가 없으므로 주석 처리)
         const reflections = await fetchReflections();
         renderReflectionTimeline(diaryBox, reflections);
    }
};