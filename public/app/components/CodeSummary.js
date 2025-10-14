// [Component] Renders the UI for a code file summary.
import { createDOMElement } from '../../../components/common.js';

export function create(summary) {
    const { filename, size, language, lineCount, fullCode } = summary;

    const fileIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

    const header = createDOMElement('div', { className: 'code-summary-header' },
        createDOMElement('div', { className: 'file-icon' }),
        createDOMElement('div', { className: 'file-info' },
            createDOMElement('div', { className: 'file-name' }, filename),
            createDOMElement('div', { className: 'file-meta' }, `${language} · ${(size / 1024).toFixed(1)} KB · ${lineCount} lines`)
        )
    );
    header.querySelector('.file-icon').innerHTML = fileIcon;

    const details = createDOMElement('details', { className: 'code-summary-details' },
        createDOMElement('summary', {}, '코드 보기'),
        createDOMElement('div', { className: 'code-summary-preview' },
            createDOMElement('pre', {}, createDOMElement('code', {}, fullCode))
        )
    );

    return createDOMElement('div', { className: 'code-summary-wrapper' }, header, details);
}