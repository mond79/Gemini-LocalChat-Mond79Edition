// [HCA] A generic, reusable context menu component with submenu support.
import { $ } from '../utils/dom.js';
import { createDOMElement } from './common.js';

let elements;
export function init() {
    elements = {
        menu: $('#context-menu'),
    };
    document.addEventListener('click', () => hide());
}

export function show(x, y, items) {
    elements.menu.innerHTML = '';
    items.forEach(item => {
        elements.menu.appendChild(createMenuItem(item));
    });

    elements.menu.classList.remove('hidden');
    const menuRect = elements.menu.getBoundingClientRect();
    const bodyRect = document.body.getBoundingClientRect();
    let left = x;
    let top = y;
    if (x + menuRect.width > bodyRect.width) {
        left = x - menuRect.width;
    }
    if (y + menuRect.height > bodyRect.height) {
        top = y - menuRect.height;
    }
    elements.menu.style.left = `${left}px`;
    elements.menu.style.top = `${top}px`;
}

function createMenuItem(item) {
    if (item.type === 'separator') {
        return createDOMElement('li', { className: 'separator' });
    }

    const li = createDOMElement('li', {}, item.label);
    if (item.submenu && item.submenu.length > 0) {
        li.classList.add('has-submenu');
        const submenuUl = createDOMElement('ul', { className: 'submenu' });
        item.submenu.forEach(subItem => {
            submenuUl.appendChild(createMenuItem(subItem));
        });
        li.appendChild(submenuUl);
    } else {
        li.addEventListener('click', (e) => {
            e.stopPropagation();
            if(item.action) item.action();
            hide();
        });
    }
    return li;
}

export function hide() {
    elements.menu.classList.add('hidden');
}