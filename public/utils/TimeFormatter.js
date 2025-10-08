// [HCA] A reusable utility for formatting timestamps into human-readable relative strings.
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const now = new Date();
    const then = new Date(timestamp);
    const diff = now - then;

    if (diff < MINUTE) {
        return '방금 전';
    }
    if (diff < HOUR) {
        return `${Math.floor(diff / MINUTE)}분 전`;
    }
    if (diff < DAY) {
        // Check if it was today
        if (now.getDate() === then.getDate()) {
            return `${Math.floor(diff / HOUR)}시간 전`;
        }
    }
    if (diff < DAY * 2 && now.getDate() - 1 === then.getDate()) {
        return '어제';
    }
    // Default format for older dates
    return then.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}