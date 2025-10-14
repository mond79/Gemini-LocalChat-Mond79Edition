// [Component] Renders a code block with a header and copy button.
import { createDOMElement } from '../../../components/common.js';

function getLanguageName(codeElement) {
    if (codeElement && codeElement.className) {
        const match = codeElement.className.match(/language-(\w+)/);
        if (match && match[1]) {
            return match[1];
        }
    }
    return '';
}

export function enhance(htmlString) {
    const tempDiv = createDOMElement('div');
    tempDiv.innerHTML = htmlString;
    const preElements = tempDiv.querySelectorAll('pre');

    preElements.forEach(preEl => {
        // Avoid double-wrapping if already enhanced
        if (preEl.parentElement.classList.contains('code-block-wrapper')) return;

        const codeEl = preEl.querySelector('code');
        const languageName = getLanguageName(codeEl);

        const wrapper = createDOMElement('div', { className: 'code-block-wrapper' });
        const langSpan = createDOMElement('span', { className: 'code-block-language' }, languageName);
        const copyBtn = createDOMElement('button', { className: 'code-block-copy-btn' });
        copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg><span>Copy</span>`;
        
        const header = createDOMElement('div', { className: 'code-block-header' }, langSpan, copyBtn);
        wrapper.appendChild(header);
        wrapper.appendChild(preEl.cloneNode(true)); // Add the original <pre> block inside

        // Replace the original <pre> element with the new enhanced wrapper
        preEl.parentNode.replaceChild(wrapper, preEl);
    });

    return tempDiv.innerHTML;
}