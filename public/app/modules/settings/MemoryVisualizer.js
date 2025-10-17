// 차트 객체를 저장하여, 다시 그릴 때 기존 차트를 파괴하기 위한 변수
let chartInstance = null;

// 백엔드 API로부터 통계 데이터를 비동기적으로 가져오는 함수
async function fetchData() {
    try {
        const response = await fetch('/api/memory-stats');
        if (!response.ok) {
            // 서버 응답이 실패하면 오류를 발생시킴
            throw new Error(`서버 응답 오류: ${response.statusText}`);
        }
        return await response.json();
    } catch (error) {
        // 네트워크 오류 등이 발생했을 때 콘솔에 로그를 남기고 null 반환
        console.error("기억 통계 데이터 fetching 중 오류:", error);
        return null;
    }
}

// 캔버스 요소와 데이터를 받아 실제 차트를 그리는 함수
function renderChart(canvasElement, chartData) {
    // 만약 이전에 그려진 차트가 있다면, 깨끗하게 파괴하고 새로 그림
    if (chartInstance) {
        chartInstance.destroy();
    }

    if (!canvasElement) return; // 캔버스 요소가 없으면 함수 종료
    const ctx = canvasElement.getContext('2d');

    // ✨ 1. 이 줄을 'white'로 고정합니다.
    const textColor = 'white'; 
    // const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-color-primary').trim();

    // 데이터가 없거나 비어있을 경우, 사용자에게 메시지를 표시
    if (!chartData || !chartData.labels || chartData.labels.length === 0) {
        ctx.font = '16px sans-serif';
        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        // 캔버스 중앙에 텍스트를 그립니다.
        ctx.fillText("아직 분석할 기억 데이터가 부족합니다.", canvasElement.width / 2, 50);
        return;
    }

    // Chart.js를 사용하여 새로운 차트 객체 생성
    chartInstance = new Chart(ctx, {
        type: 'doughnut', // 'pie'보다 가운데가 비어있어 더 세련된 'doughnut' 타입 사용
        data: {
            labels: chartData.labels, // 차트의 각 조각 이름 (예: '기술', '음악')
            datasets: [{
                data: chartData.data, // 각 조각의 값 (예: 50, 30)
                // 각 조각에 적용될 아름다운 색상 목록
                backgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', 
                    '#4BC0C0', '#9966FF', '#FF9F40'
                ],
                hoverBackgroundColor: [
                    '#FF6384', '#36A2EB', '#FFCE56', 
                    '#4BC0C0', '#9966FF', '#FF9F40'
                ],
                // 조각 사이의 경계선 색상 (현재 테마의 배경색과 유사하게)
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--background-color-secondary').trim(),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true, // 컨테이너 크기에 맞춰 차트 크기 자동 조절
            maintainAspectRatio: false, // 컨테이너 비율에 꽉 차도록 함
            plugins: {
                legend: { // 범례(각 색상이 무엇을 의미하는지 보여주는 부분) 설정
                    position: 'right', // 범례를 차트 오른쪽에 표시
                    // ✨ 2. 여기 labels.color 도 'white'로 고정합니다.
                    labels: { color: 'white' } 
                    
                },
                title: {
                    display: false // 차트 자체의 제목은 사용하지 않음 (HTML의 h2 제목으로 대체)
                }
            }
        }
    });
}

// SettingsController에서 호출할 수 있도록 render 함수를 가진 객체를 export
export const MemoryVisualizer = {
    async render() {
        // HTML에서 id가 'memory-chart'인 캔버스 요소를 찾음
        const canvasElement = document.getElementById('memory-chart');
        if (!canvasElement) return; // 캔버스가 없으면 종료
        
        // 백엔드에서 데이터를 가져올 때까지 기다림
        const chartData = await fetchData();
        // 가져온 데이터로 차트를 그림
        renderChart(canvasElement, chartData);
    }
};