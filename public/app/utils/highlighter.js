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