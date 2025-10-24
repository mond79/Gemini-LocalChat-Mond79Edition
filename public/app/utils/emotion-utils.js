// [ChatGPT 제안 채택] 감정별 음성/색상 프로필
export const EMO_PROFILES = {
  funny:     { pitch: 2.0,  rate: 1.15, color: "#ffb74d" },
  tense:     { pitch: -3.0, rate: 1.05, color: "#ef5350" },
  excited:   { pitch: 3.5,  rate: 1.2,  color: "#81c784" },
  emotional: { pitch: -1.5, rate: 0.95, color: "#ba68c8" },
  sad:       { pitch: -4.0, rate: 0.9,  color: "#90a4ae" },
  neutral:   { pitch: 0.0,  rate: 1.0,  color: "#9e9e9e" },
  calm:      { pitch: 0.0,  rate: 1.0,  color: "#90caf9" },
};

export const getEmotionProfile = (kind) => EMO_PROFILES[kind] || EMO_PROFILES.neutral;

// 선형 보간 함수
const lerp = (a, b, t) => a + (b - a) * t;

// 헥스(Hex) 색상 코드를 보간하는 함수
function blendHexColor(hex1, hex2, t) {
    const parseHex = (h) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const c1 = parseHex(hex1);
    const c2 = parseHex(hex2);
    const blended = c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
    return `#${blended.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

// 두 감정 프로필 상태를 보간하는 메인 함수
export function interpolateEmotionState(prevState, targetProfile, alpha) {
    return {
        pitch: lerp(prevState.pitch, targetProfile.pitch, alpha),
        rate: lerp(prevState.rate, targetProfile.rate, alpha),
        color: blendHexColor(prevState.color, targetProfile.color, alpha),
    };
}