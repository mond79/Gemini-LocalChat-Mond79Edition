// [HCA] This utility is solely responsible for syntax highlighting using highlight.js.
let hljs;

export function init(hljsInstance) {
    hljs = hljsInstance;
}

export function applySyntaxHighlighting(container) {
    if (!hljs || !container) return;

    const blocks = container.querySelectorAll('pre code:not([data-highlighted])');
    blocks.forEach(block => {
        try {
            hljs.highlightElement(block);
            block.dataset.highlighted = 'true';
        } catch (e) {
            console.error('Highlight.js error:', e);
        }
    });
}

/**
 * [궁극의 해결책] 어떤 텍스트든 마크다운->HTML 변환, 소독, 하이라이팅까지
 * 안전하고 완벽하게 처리하는 통합 렌더링 함수
 * @param {string} text - 렌더링할 원본 텍스트
 * @returns {string} - 화면에 바로 삽입해도 되는 안전한 HTML 문자열
 */
export function renderSecureContent(text) {
  // 1단계: 마크다운을 HTML로 변환 (marked.js)
  const rawHtml = window.marked.parse(text || '');

  // 2단계: 변환된 HTML에서 위험한 태그 소독 (DOMPurify)
  // [수정] 짧은 코드가 사라지는 현상을 막기 위해, <div> 태그를 허용 목록에 추가합니다.
  const sanitizedHtml = window.DOMPurify.sanitize(rawHtml, { ADD_TAGS: ['div'] });
  
  // 3단계: 임시 div를 만들어 소독된 HTML을 넣고, 코드 블록만 찾아 색칠 준비
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = sanitizedHtml;
  
  const codeBlocks = tempDiv.querySelectorAll('pre code');
  if (codeBlocks.length > 0) {
    codeBlocks.forEach((block) => {
      // 4단계: 코드 블록을 찾아 색칠! (highlight.js)
      // 'hljs' 변수는 이 파일 상단에서 이미 초기화되었으므로 바로 사용할 수 있습니다.
      hljs.highlightElement(block);
    });
  }
  
  // 5단계: 모든 작업이 끝난 HTML 내용을 문자열로 반환
  return tempDiv.innerHTML;
}