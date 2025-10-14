// [CoreDNA] This component renders the hierarchical list of folders and sessions with FLIP animations.
import { $ } from '../utils/dom.js';
import { createDOMElement } from './common.js';
import { formatRelativeTime } from '../utils/TimeFormatter.js';

let elements;
export function init() { elements = { sessionList: $('#session-list') }; }

export function beginRename(itemId) { /* ... unchanged ... */ const listItem = $(`li[data-item-id="${itemId}"]`); if (!listItem || listItem.classList.contains('editing')) return; listItem.classList.add('editing'); const titleSpan = listItem.querySelector('.session-title, .folder-name'); const input = listItem.querySelector('.title-input'); titleSpan.classList.add('hidden'); input.classList.remove('hidden'); input.value = titleSpan.textContent; input.focus(); input.select(); }

export function render(state) {
    const firstPositions = new Map();
    const listItems = elements.sessionList.querySelectorAll('li[data-item-id]');
    listItems.forEach(li => {
        firstPositions.set(li.dataset.itemId, li.getBoundingClientRect());
    });

    elements.sessionList.innerHTML = '';
    const sortedRootItems = sortItems(state.sidebarItems, state.sessions, state.settings.sidebarSortMode);
    if (sortedRootItems.length === 0) {
        elements.sessionList.innerHTML = '<li class="no-sessions">채팅 기록이 없습니다.</li>';
        return;
    }
    sortedRootItems.forEach(item => renderItem(item, 0, state));

    const lastListItems = elements.sessionList.querySelectorAll('li[data-item-id]');
    lastListItems.forEach(li => {
        const itemId = li.dataset.itemId;
        const firstPos = firstPositions.get(itemId);
        if (!firstPos) return;
        const lastPos = li.getBoundingClientRect();
        const dx = firstPos.left - lastPos.left;
        const dy = firstPos.top - lastPos.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            li.style.transition = 'none';
            li.style.transform = `translate(${dx}px, ${dy}px)`;
        }
    });

    requestAnimationFrame(() => {
        lastListItems.forEach(li => {
            if (li.style.transform) {
                li.style.transition = '';
                li.style.transform = '';
            }
        });
    });
}

function renderItem(item, level, state) {
    const listItem = item.type === 'folder'
        ? createFolderElement(item, level, state)
        : createSessionElement(item, level, state);

    elements.sessionList.appendChild(listItem);

    if (item.type === 'folder') {
        const childrenContainer = createDOMElement('ul', { className: `folder-children-container ${item.isOpen ? "" : "collapsed"}` });
        const sortedChildren = sortItems(item.children, state.sessions, state.settings.sidebarSortMode);
        sortedChildren.forEach(child => renderItemRecursive(child, level + 1, state, childrenContainer));
        elements.sessionList.appendChild(childrenContainer);
    }
}

function renderItemRecursive(item, level, state, container) {
    const listItem = item.type === 'folder'
        ? createFolderElement(item, level, state)
        : createSessionElement(item, level, state);

    container.appendChild(listItem);

    if (item.type === 'folder') {
        const childrenContainer = createDOMElement('ul', { className: `folder-children-container ${item.isOpen ? "" : "collapsed"}`});
        const sortedChildren = sortItems(item.children, state.sessions, state.settings.sidebarSortMode);
        sortedChildren.forEach(child => renderItemRecursive(child, level + 1, state, childrenContainer));
        container.appendChild(childrenContainer);
    }
}

function createFolderElement(folder, level, state) {
    const { id, name, isOpen } = folder;
    const toggleBtn = createDOMElement('button', { className: `toggle-folder-btn ${isOpen ? "" : "closed"}` });
    toggleBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>`;
    const folderIcon = createDOMElement('span', { className: 'item-icon' });
    folderIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path></svg>`;
    const nameSpan = createDOMElement('span', { className: 'folder-name' }, name);
    const nameInput = createDOMElement('input', { type: 'text', className: 'title-input hidden', value: name });
    const titleWrapper = createDOMElement('div', { className: 'item-title-wrapper' }, nameSpan, nameInput);
    // [MODIFIED] New wrapper for content to handle indentation correctly.
    const contentWrapper = createDOMElement('div', { className: 'item-content-wrapper', style: `--level: ${level}` }, folderIcon, titleWrapper);
    return createDOMElement('li', { 'data-item-id': id, 'data-item-type': 'folder', className: 'folder-item', draggable: 'true' }, toggleBtn, contentWrapper);
}

function createSessionElement(sessionItem, level, state) {
    const session = state.sessions[sessionItem.id];
    if (!session) return document.createDocumentFragment();
    const { id, title, isPinned, lastModified, tags } = session;
    const isActive = id === state.activeSessionId;
    const isLoading = !!state.loadingStates[id];
    const sessionIcon = createDOMElement('span', { className: 'item-icon' });
    sessionIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>`;
    const titleSpan = createDOMElement('span', { className: 'session-title' }, title);
    const timeSpan = createDOMElement('span', { className: 'session-time' }, formatRelativeTime(lastModified));
    const nameWrapper = createDOMElement('div', { className: 'session-name-wrapper'}, titleSpan, timeSpan);
    const titleInput = createDOMElement('input', { type: 'text', className: 'title-input hidden', value: title });
    const titleWrapper = createDOMElement('div', { className: 'item-title-wrapper' }, nameWrapper, titleInput);
    const actionsDiv = createSessionActions(isPinned, isActive);
    const contentWrapper = createDOMElement('div', { className: 'item-content-wrapper', style: `--level: ${level}` }, sessionIcon, titleWrapper);
    
    const li = createDOMElement('li', { 'data-item-id': id, 'data-item-type': 'session', className: 'session-item', draggable: 'true' }, contentWrapper, actionsDiv);

    if (tags && tags.length > 0) {
        const tagsContainer = createDOMElement('div', { className: 'session-tags-container' });
        tags.forEach(tag => {
            const tagEl = createDOMElement('span', { className: 'session-tag' }, tag);
            tagsContainer.appendChild(tagEl);
        });
        // Insert tags container after the content wrapper, inside the li
        contentWrapper.parentNode.insertBefore(tagsContainer, actionsDiv);
    }

    if (isActive) li.classList.add('active');
    if (isPinned) li.classList.add('pinned');
    if (isLoading) {
        const spinner = createDOMElement('div', { className: 'session-loading-spinner' });
        li.insertBefore(spinner, actionsDiv);
    }
    return li;
}

function createSessionActions(isPinned, isActive) { /* ... unchanged ... */ const pinBtn = createDOMElement('button', { className: `session-action-btn pin-btn ${isPinned ? 'pinned' : ''}`, title: isPinned ? '고정 해제' : '고정' }); pinBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>'; const deleteBtn = createDOMElement('button', { className: 'session-action-btn delete-btn', title: '삭제' }); deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>'; const actionsDiv = createDOMElement('div', { className: 'session-actions' }); if(isActive) actionsDiv.classList.add('active-actions'); actionsDiv.appendChild(pinBtn); actionsDiv.appendChild(deleteBtn); return actionsDiv; }
function sortItems(items, sessions, sortMode) { /* ... unchanged ... */ const getSortable = (item) => { const session = item.type === 'session' ? sessions[item.id] : null; const name = item.type === 'folder' ? item.name : session?.title || ''; return { isPinned: session?.isPinned || false, isFolder: item.type === 'folder', lastModified: session?.lastModified || 0, createdAt: session?.createdAt || parseInt(item.id.split('-')[1], 10), name: name.toLowerCase() }; }; return [...items].sort((a, b) => { const sortA = getSortable(a); const sortB = getSortable(b); if (sortA.isPinned !== sortB.isPinned) return sortA.isPinned ? -1 : 1; if (sortA.isFolder !== sortB.isFolder) return sortA.isFolder ? -1 : 1; switch (sortMode) { case 'asc': return sortA.name.localeCompare(sortB.name); case 'desc': return sortB.name.localeCompare(sortA.name); case 'createdAt': return sortB.createdAt - sortA.createdAt; case 'lastModified': default: return sortB.lastModified - sortA.lastModified; } }); }