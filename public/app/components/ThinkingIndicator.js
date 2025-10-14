// [Component] Renders and manages the loading indicator.
import { createDOMElement } from '../../../components/common.js';

// [MODIFIED] Simplified to create a single div for CSS animation.
function create() {
    const indicator = createDOMElement('div', { id: 'thinking-indicator' });
    return indicator;
}

function remove() {
    const existing = document.getElementById('thinking-indicator');
    if (existing) existing.remove();
}

// [MODIFIED] Simplified manage function. The startTime is no longer used but kept for compatibility.
export function manage(show, startTime, container) {
    remove();
    if (show && container) {
        const indicatorElement = create();
        container.appendChild(indicatorElement);
        return true;
    }
    return false;
}