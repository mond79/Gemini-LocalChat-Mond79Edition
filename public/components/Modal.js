// [CoreDNA] Manages all modal dialogs.
// [MODIFIED] Decoupled from application logic by using CustomEvents.
import { $ } from '../utils/dom.js';

let elements;
let currentModalType = null;

export function init() {
    elements = {
        modalContainer: $('#modal-container'),
        modalOverlay: $('#modal-overlay'),
        modalContent: $('#modal-content'),
        modalCloseBtn: $('#modal-close-btn'),
        imageModal: $('#image-modal-container'),
        imageModalOverlay: $('#image-modal-overlay'),
        imageModalElement: $('#image-modal-element'),
        imageModalCloseBtn: $('#image-modal-close-btn')
    };

    elements.modalOverlay.addEventListener('click', closeModal);
    elements.modalCloseBtn.addEventListener('click', closeModal);
    elements.imageModalOverlay.addEventListener('click', closeImageModal);
    elements.imageModalCloseBtn.addEventListener('click', closeImageModal);
    
    // 프롬프트 에디터에서 닫기 요청 처리
    document.addEventListener('modal-close-requested', closeModal);
}

// [NEW] Generic function to open a modal with arbitrary HTML content
export function openModalWithContent(contentElement) {
    elements.modalContent.innerHTML = ''; // Clear previous content
    elements.modalContent.appendChild(contentElement);
    elements.modalContainer.classList.remove('modal-hidden');
}

// [MODIFIED] Specific modal openers now use the generic one
async function openModal(htmlFile, jsFile, modalType) {
    try {
        const response = await fetch(htmlFile);
        if (!response.ok) throw new Error(`${htmlFile} not found`);
        const contentWrapper = document.createElement('div');
        contentWrapper.innerHTML = await response.text();

        if (jsFile) {
            // Use dynamic import for module scripts
            const scriptModule = await import(`../${jsFile}`);
            // If the module has an init function, call it with the content wrapper
            if (scriptModule && typeof scriptModule.init === 'function') {
                scriptModule.init(contentWrapper);
            }
        }
        openModalWithContent(contentWrapper);
        currentModalType = modalType;
        
        // 프롬프트 에디터 모달인 경우 특별한 클래스 추가
        if (modalType === 'promptEditor') {
            elements.modalContainer.classList.add('prompt-editor-active');
        }
    } catch (error) {
        console.error('Modal Error:', error);
        alert(`창을 여는 중 오류 발생: ${error.message}`);
    }
}

export function openPromptEditorModal() { openModal('prompt_editor.html', 'prompt_editor.js', 'promptEditor'); }

export function closeModal() {
    elements.modalContainer.classList.add('modal-hidden');
    elements.modalContainer.classList.remove('prompt-editor-active');
    elements.modalContent.innerHTML = '';

    document.dispatchEvent(new CustomEvent('modal-closed', {
        detail: { modalType: currentModalType }
    }));

    currentModalType = null;
}

export function openImageModal(src) { elements.imageModalElement.src = src; elements.imageModal.classList.remove('modal-hidden'); }
export function closeImageModal() { elements.imageModal.classList.add('modal-hidden'); elements.imageModalElement.src = ''; }