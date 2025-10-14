// [HCA] A highly reusable helper function for creating DOM elements.
// This avoids repetitive document.createElement and attribute setting code.
export function createDOMElement(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const key in attributes) {
        const value = attributes[key];
        if (key === 'className') {
            element.className = value;
        } else if (typeof value === 'boolean') {
            // [MODIFIED] Handle boolean attributes like 'disabled' correctly.
            if (value) {
                element.setAttribute(key, '');
            }
        } else {
            element.setAttribute(key, value);
        }
    }
    for (const child of children) {
        if (typeof child === 'string') {
            element.appendChild(document.createTextNode(child));
        } else if (child instanceof HTMLElement) {
            element.appendChild(child);
        }
    }
    return element;
}