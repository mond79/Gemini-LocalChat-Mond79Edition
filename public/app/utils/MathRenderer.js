// [CoreDNA] This module exclusively handles math rendering using KaTeX or MathJax.
import { appState } from '../state/AppState.js';

export function renderMathInString(htmlString) {
    if (typeof katex === 'undefined') {
        console.warn('KaTeX not loaded, skipping string pre-rendering.');
        return htmlString;
    }
    const processedDisplay = htmlString.replace(/\$\$([\s\S]*?)\$\$/g, (match, expression) => {
        try {
            return katex.renderToString(expression, { displayMode: true, throwOnError: false, strict: false });
        } catch (e) {
            console.warn('KaTeX pre-rendering error (display):', e);
            return match;
        }
    });
    const processedInline = processedDisplay.replace(/\$([^$]+?)\$/g, (match, expression) => {
        try {
            return katex.renderToString(expression, { displayMode: false, throwOnError: false, strict: false });
        } catch (e) {
            console.warn('KaTeX pre-rendering error (inline):', e);
            return match;
        }
    });
    return processedInline;
}

function autoScaleMath(element) {
    const mathBlocks = element.querySelectorAll('.katex-display, .MathJax');
    mathBlocks.forEach(block => {
        block.style.transform = 'scale(1)';
        block.style.transformOrigin = 'left';
        const parentWidth = block.parentElement.clientWidth;
        const blockWidth = block.scrollWidth;
        if (blockWidth > parentWidth) {
            const scale = parentWidth / blockWidth;
            block.style.transform = `scale(${scale})`;
        }
    });
}

function _renderWithKatex(element) {
    if (typeof katex === 'undefined') {
        console.warn('KaTeX is not loaded.');
        return;
    }
    const textNodes = Array.from(element.querySelectorAll('.text-part, p, li, blockquote'));
    textNodes.forEach(node => {
        if (node.querySelector('.katex')) return;
        const text = node.innerHTML;
        const processedText = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, expression) => {
            try { return katex.renderToString(expression, { displayMode: true, throwOnError: false, strict: false }); } catch (e) { return match; }
        }).replace(/\$([^$]+?)\$/g, (match, expression) => {
            try { return katex.renderToString(expression, { displayMode: false, throwOnError: false, strict: false }); } catch (e) { return match; }
        });
        node.innerHTML = processedText;
    });
}

async function _renderWithMathJax(element) {
    if (typeof MathJax === 'undefined' || !MathJax.typesetPromise) {
        console.warn('MathJax is not ready.');
        return;
    }
    try {
        await MathJax.typesetPromise([element]);
    } catch (e) {
        console.warn('MathJax rendering error:', e);
    }
}

export function renderMathInElement(element) {
    if (!element) return;
    const overrideRenderer = element.dataset.mathRenderer;
    const renderer = overrideRenderer || appState.settings.mathRenderer;
    if (renderer === 'mathjax') {
        _renderWithMathJax(element).then(() => autoScaleMath(element));
    } else {
        _renderWithKatex(element);
        autoScaleMath(element);
    }
}

export function init() {}