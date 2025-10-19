// HEX 색상 코드를 "r,g,b" 문자열로 변환
export function hexToRgb(hex) {
    if (!hex) return '0,0,0';
    const parsed = hex.startsWith('#') ? hex.slice(1) : hex;
    if (parsed.length !== 3 && parsed.length !== 6) return '0,0,0';
    const bigint = parseInt(parsed, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `${r},${g},${b}`;
}

// HEX 색상 코드를 {r, g, b} 객체로 변환
function hexToRgbObj(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    let parsed = hex.startsWith('#') ? hex.slice(1) : hex;
    if (parsed.length === 3) {
        parsed = parsed.split('').map(c => c + c).join('');
    }
    const bigint = parseInt(parsed, 16);
    return {
        r: (bigint >> 16) & 255,
        g: (bigint >> 8) & 255,
        b: bigint & 255,
    };
}

// 상대 휘도를 계산하여 색상의 밝기를 판단
function relativeLuminance({ r, g, b }) {
    const toLin = v => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
}

// 현재 테마가 어두운지 확인
export function isDarkTheme() {
    const root = document.documentElement;
    const bg = getComputedStyle(root).getPropertyValue('--background-color-primary').trim() || '#111';
    return relativeLuminance(hexToRgbObj(bg)) < 0.4;
}

// 어두운 테마일 때 색상을 더 밝게 보정
export function adjustForTheme(hex, lightenOnDark = 0.2) {
    if (!isDarkTheme()) return hex;
    const { r, g, b } = hexToRgbObj(hex);
    const up = v => Math.min(255, Math.round(v + (255 - v) * lightenOnDark));
    const nr = up(r), ng = up(g), nb = up(b);
    return `#${[nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// 감성 팔레트 (ChatGPT 제안)
export const emotionColorMap = {
    '긍정': '#4CAF50',
    '성취': '#FFC107',
    '중립': '#9E9E9E',
    '부정': '#F44336',
    '혼란': '#2196F3',
    '기록 없음': '#616161'
};

// 작은 이모지 맵 (E1 스타일)
export const emotionEmojiMap = {
    '긍정': '😊',
    '성취': '🏆',
    '중립': '😐',
    '부정': '😟',
    '혼란': '🤔',
    '기록 없음': '🌫️'
};