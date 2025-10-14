// [HCA] A reusable component for showing non-intrusive notifications.
import { createDOMElement } from './common.js';
import { $ } from '../utils/dom.js';

let elements;
export function init() {
    elements = {
        container: $('#toast-container'),
    };
}

export function show(message, type = 'info', duration = 3000) {
    if (!elements.container) return;

    const className = `toast-message ${type === 'warning' ? 'toast-warning' : ''}`;
    const toastElement = createDOMElement('div', { className }, message);
    elements.container.appendChild(toastElement);

    // Animate in
    setTimeout(() => {
        toastElement.classList.add('show');
    }, 10);

    // Set timeout to remove the element
    setTimeout(() => {
        toastElement.classList.remove('show');
        // Remove from DOM after transition ends
        toastElement.addEventListener('transitionend', () => {
            toastElement.remove();
        });
    }, duration);
}