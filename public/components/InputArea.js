// [CoreDNA] Manages the input textarea, send button, and file preview.
import { $ } from '../utils/dom.js';
import { createDOMElement } from './common.js';
import { appState } from '../app/state/AppState.js';
import { handlers } from '../app/events/handlerOrchestrator.js';

let elements;
export function init() {
    elements = {
        messageInput: $('#message-input'),
        sendBtn: $('#send-btn'),
        imageUploadInput: $('#image-upload-input'),
        imagePreviewContainer: $('#image-preview-container'),
        temperatureSlider: $('#temperature-slider'),
        temperatureValue: $('#temperature-value'),
        topPSlider: $('#top-p-slider'),
        topPValue: $('#top-p-value')
    };
    elements.messageInput.addEventListener('input', autoResizeTextarea);
    
    // 온도 슬라이더 이벤트
    elements.temperatureSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        elements.temperatureValue.textContent = value.toFixed(1);
        appState.settings.temperature = value;
        handlers.handleSaveSettings();
    });
    
    // Top-P 슬라이더 이벤트
    elements.topPSlider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        elements.topPValue.textContent = value.toFixed(1);
        appState.settings.topP = value;
        handlers.handleSaveSettings();
    });
}

export function render(state) {
    const isActiveSessionLoading = !!state.loadingStates[state.activeSessionId];
    const { attachedFiles } = state;
    const messageText = elements.messageInput.value.trim();

    elements.messageInput.disabled = isActiveSessionLoading;
    elements.imageUploadInput.disabled = isActiveSessionLoading;
    elements.messageInput.placeholder = isActiveSessionLoading ? 'AI가 응답하는 중...' : '메시지를 입력하세요...';

    // [MODIFIED] Toggle button between Send and Stop states
    if (isActiveSessionLoading) {
        elements.sendBtn.classList.add('stop-generating');
        elements.sendBtn.title = '응답 중지';
        elements.sendBtn.disabled = false; // The stop button must be clickable
    } else {
        elements.sendBtn.classList.remove('stop-generating');
        elements.sendBtn.title = '전송';
        elements.sendBtn.disabled = !messageText && attachedFiles.length === 0;
    }

    // 온도와 Top-P 슬라이더 값 업데이트
    if (elements.temperatureSlider && elements.temperatureValue) {
        elements.temperatureSlider.value = state.settings.temperature || 1.0;
        elements.temperatureValue.textContent = (state.settings.temperature || 1.0).toFixed(1);
    }
    
    if (elements.topPSlider && elements.topPValue) {
        elements.topPSlider.value = state.settings.topP || 0.9;
        elements.topPValue.textContent = (state.settings.topP || 0.9).toFixed(1);
    }

    renderFilePreviews(attachedFiles);
}

export function getTextValue() {
    return elements.messageInput.value.trim();
}

export function clearInput() {
    elements.messageInput.value = '';
    elements.imageUploadInput.value = '';
    autoResizeTextarea.call(elements.messageInput);
}

// ==========================================================
// [✅ 바로 이 부분이 추가/수정된 부분입니다!]
// 음성 인식 결과를 입력창에 설정하는 새로운 함수
export function setTextValue(text) {
    elements.messageInput.value = text;
    // 텍스트 길이에 맞춰 입력창 크기를 조절하고, 전송 버튼 상태를 업데이트합니다.
    autoResizeTextarea.call(elements.messageInput);
    render(appState); 
}
// [✅ 여기까지가 추가/수정된 부분입니다!]
// ==========================================================

function renderFilePreviews(files) {
    elements.imagePreviewContainer.innerHTML = '';
    if (!files || files.length === 0) return;

    files.forEach((file, index) => {
        const removeBtn = createDOMElement('button', { className: 'preview-remove-btn' }, '×');
        removeBtn.onclick = () => handlers.handleRemoveAttachedFile(index);

        let previewContent;
        if (file.type.startsWith('image/')) {
            previewContent = createDOMElement('img', { src: file.data, className: 'preview-image' });
        } else {
            const fileIcon = createDOMElement('div', { className: 'file-icon' });
            fileIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;
            const fileName = createDOMElement('span', { className: 'file-name' }, file.name);
            const fileSize = createDOMElement('span', { className: 'file-size' }, `(${(file.size / 1024).toFixed(1)} KB)`);
            previewContent = createDOMElement('div', { className: 'file-info-preview' }, fileIcon, fileName, fileSize);
        }

        const previewItem = createDOMElement('div', { className: 'preview-item' },
            previewContent,
            removeBtn
        );
        elements.imagePreviewContainer.appendChild(previewItem);
    });
}

function autoResizeTextarea() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
}