// [Module] Manages API Key and Model settings UI and logic.
import { saveData } from '../../../utils/storage.js';
import { createDOMElement } from '../../../components/common.js';
import * as Modal from '../../../../components/Modal.js';

let appState, elements, controller;
let allAvailableModels = [];

const getApiKeyIdentifier = (key) => key ? `key_${key.slice(-4)}` : 'no_key';

async function fetchAllModels() {
    if (allAvailableModels.length > 0) return allAvailableModels;
    const apiKeyToUse = appState.settings?.apiKey || (appState.settings?.fallbackApiKeys || [])[0];
    if (apiKeyToUse) {
        try {
            const response = await fetch('/api/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: apiKeyToUse }) });
            const data = await response.json();
            if (!response.ok) throw new Error(data.message);
            allAvailableModels = data.models;
            return allAvailableModels;
        } catch (error) {
            console.error("Failed to fetch models:", error);
            allAvailableModels = [];
            return [];
        }
    }
    return [];
}

function getManagedModelsSorted() {
    if (!appState.settings.managedModels) return [];
    const favorites = appState.settings.favoriteModels || [];
    const managedModelsDetails = appState.settings.managedModels
        .map(id => allAvailableModels.find(m => m.id === id))
        .filter(Boolean);

    return managedModelsDetails.sort((a, b) => {
        const aIsFav = favorites.includes(a.id);
        const bIsFav = favorites.includes(b.id);
        if (aIsFav && !bIsFav) return -1;
        if (!aIsFav && bIsFav) return 1;
        return a.name.localeCompare(b.name);
    });
}

function createModelCard(model) {
    const { id, name } = model;
    const favorites = appState.settings.favoriteModels || [];
    const isFav = favorites.includes(id);
    const dailyLimits = appState.settings.dailyLimits || {};
    const limit = dailyLimits[id] || 0;
    const modelCosts = appState.settings.modelCosts[id] || { input: 0, output: 0 };
    const primaryKeyId = getApiKeyIdentifier(appState.settings.apiKey);
    const usage = appState.dailyUsage?.usageByKey?.[primaryKeyId]?.calls?.[id] || 0;
    const usagePercent = limit > 0 ? (usage / limit) * 100 : 0;

    const card = createDOMElement('div', { class: `model-card ${isFav ? 'favorite-card' : ''}`, 'data-model-id': id });
    const starIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;
    const removeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    const progressBarInner = createDOMElement('div', { class: 'usage-progress-bar-inner', style: `width: ${Math.min(usagePercent, 100)}%` });
    if (usage >= limit && limit > 0) progressBarInner.classList.add('limit-exceeded');
    else if (usage >= limit * 0.8 && limit > 0) progressBarInner.classList.add('limit-warning');

    card.innerHTML = `
        <button class="favorite-btn ${isFav ? 'active' : ''}" data-model-id="${id}" title="즐겨찾기">${starIcon}</button>
        <div class="model-name">${name}</div>
        <button class="remove-model-btn" data-model-id="${id}" title="대시보드에서 제거">${removeIcon}</button>
        <div class="usage-progress-bar"></div>
        <div class="model-controls">
            <div class="control-group">
                <label for="limit-${id}">일일 호출 제한</label>
                <input type="number" id="limit-${id}" data-model-id="${id}" data-setting-type="dailyLimit" value="${limit}" min="0">
            </div>
            <div class="control-group">
                <label for="cost-input-${id}">입력 비용 ($/1M)</label>
                <input type="number" id="cost-input-${id}" step="0.01" data-model-id="${id}" data-setting-type="modelCost" data-cost-type="input" data-value-type="float" value="${modelCosts.input}">
            </div>
            <div class="control-group">
                <label for="cost-output-${id}">출력 비용 ($/1M)</label>
                 <input type="number" id="cost-output-${id}" step="0.01" data-model-id="${id}" data-setting-type="modelCost" data-cost-type="output" data-value-type="float" value="${modelCosts.output}">
            </div>
        </div>
        <div class="usage-text">오늘 사용량: ${usage} / ${limit === 0 ? '∞' : limit}</div>
    `;
    card.querySelector('.usage-progress-bar').appendChild(progressBarInner);
    return card;
}

function renderModelDashboard() {
    const container = document.getElementById('model-dashboard-container');
    if (!container) return;
    container.innerHTML = '';
    const sortedManagedModels = getManagedModelsSorted();
    if (sortedManagedModels.length === 0) {
        const emptyMessage = createDOMElement('div', { class: 'empty-dashboard-message' });
        emptyMessage.innerHTML = `<p>관리할 모델이 없습니다. 우측 상단의 '+ 모델 추가' 버튼을 클릭하여 시작하세요.</p>`;
        container.appendChild(emptyMessage);
        return;
    }
    sortedManagedModels.forEach(model => {
        const card = createModelCard(model);
        container.appendChild(card);
    });
}

async function render() {
    const container = document.getElementById('model-dashboard-container');
    if (!appState.settings?.apiKey) {
        container.innerHTML = `<p class="status-error" style="text-align: center;">기본 API 키를 먼저 검증하세요</p>`;
        return;
    }
    await fetchAllModels();
    renderModelDashboard();
}

function handleToggleFavorite(modelId) {
    const favorites = appState.settings.favoriteModels || [];
    const index = favorites.indexOf(modelId);
    if (index > -1) favorites.splice(index, 1);
    else favorites.push(modelId);
    appState.settings.favoriteModels = favorites;
    saveData(appState);
    render();
}

function renderFallbackKeysList() {
    elements.fallbackKeysList.innerHTML = '';
    const fallbackKeys = appState.settings.fallbackApiKeys || [];
    fallbackKeys.forEach((key, index) => {
        const item = createDOMElement('div', { class: 'fallback-key-item' });
        item.innerHTML = `
            <div class="fallback-key-content">
                <div class="api-input-wrapper">
                    <input type="password" class="fallback-key-input" placeholder="대체 API 키 #${index + 1}" value="${key}">
                    <button class="validate-fallback-btn">검증</button>
                </div><div class="status-message"></div>
            </div>
            <button class="delete-fallback-btn" title="삭제">×</button>
        `;
        item.querySelector('.validate-fallback-btn').addEventListener('click', () => handleValidateKey('fallback', index));
        item.querySelector('.delete-fallback-btn').addEventListener('click', () => handleDeleteFallbackKey(index));
        elements.fallbackKeysList.appendChild(item);
    });
}

function handleAddFallbackKey() {
    // 토스트 알림 표시
    import('../../../components/Toast.js').then(({ show }) => {
        show('⚠️ 대체 API 키 기능은 현재 불안정한 상태입니다. 나중에 수정될 예정입니다.', 'warning');
    });
    
    if (!appState.settings.fallbackApiKeys) appState.settings.fallbackApiKeys = [];
    appState.settings.fallbackApiKeys.push('');
    saveData(appState);
    renderFallbackKeysList();
}

function handleDeleteFallbackKey(index) {
    appState.settings.fallbackApiKeys.splice(index, 1);
    saveData(appState);
    renderFallbackKeysList();
}

async function handleValidateKey(keyType, index = -1) {
    let inputEl, statusEl;
    if (keyType === 'primary') {
        inputEl = elements.apiKeyInput;
        statusEl = elements.validationStatus;
    } else {
        const item = elements.fallbackKeysList.children[index];
        if (!item) return;
        inputEl = item.querySelector('.fallback-key-input');
        statusEl = item.querySelector('.status-message');
    }
    const apiKey = inputEl.value.trim();
    if (!apiKey) { statusEl.textContent = 'API 키를 입력해주세요.'; statusEl.className = 'status-message status-error'; return; }
    statusEl.textContent = '검증 중...'; statusEl.className = 'status-message';
    try {
        const response = await fetch('/api/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) });
        const data = await response.json();
        if (response.ok && data.valid) {
            statusEl.textContent = '성공! API 키가 유효합니다.'; statusEl.className = 'status-message status-success';
            if (keyType === 'primary') { allAvailableModels = []; await render(); }
        } else { throw new Error(data.message); }
    } catch (error) { statusEl.textContent = `검증 실패: ${error.message}`.substring(0, 100); statusEl.className = 'status-message status-error'; }
}

function handleAddModel(modelId) {
    if (!appState.settings.managedModels.includes(modelId)) {
        appState.settings.managedModels.push(modelId);
        
        // 추가된 모델을 전체 앱 상태의 availableModels에도 반영 (중복 제거 포함)
        const addedModel = allAvailableModels.find(m => m.id === modelId);
        if (addedModel) {
            // setAvailableModels 함수를 사용해서 중복 제거 로직 적용
            import('../../state/ModelManager.js').then(({ setAvailableModels }) => {
                const updatedModels = [...appState.availableModels, addedModel];
                setAvailableModels(appState, updatedModels);
                
                // 전체 앱 렌더링을 트리거해서 모델 드롭다운도 업데이트
                document.dispatchEvent(new CustomEvent('model-list-updated'));
            });
        }
        
        saveData(appState);
        render();
        Modal.closeModal();
    }
}

function handleRemoveModel(modelId) {
    if (confirm(`'${modelId}' 모델을 대시보드에서 제거하시겠습니까? 관련 설정이 모두 초기화됩니다.`)) {
        appState.settings.managedModels = appState.settings.managedModels.filter(id => id !== modelId);
        delete appState.settings.dailyLimits[modelId];
        delete appState.settings.modelCosts[modelId];
        appState.settings.favoriteModels = appState.settings.favoriteModels.filter(id => id !== modelId);
        saveData(appState);
        render();
    }
}

function showAddModelModal() {
    const modelsToAdd = allAvailableModels.filter(m => !appState.settings.managedModels.includes(m.id));
    const modalContent = createDOMElement('div', { class: 'add-model-modal-content' });
    modalContent.innerHTML = '<h1>사용 가능한 모델</h1><p>대시보드에 추가할 모델을 선택하세요.</p><input type="search" id="add-model-search" placeholder="모델 이름 또는 ID로 검색...">';
    if (modelsToAdd.length === 0) {
        modalContent.innerHTML += '<p>추가할 수 있는 모델이 없습니다. 모든 모델이 이미 대시보드에 있습니다.</p>';
    } else {
        const list = createDOMElement('ul', { id: 'add-model-modal-list' });
        // 모델 이름을 깔끔하게 표시하는 함수
        const getCleanModelName = (model) => {
            let name = model.name || model.id;
            name = name.replace(/\s*\([^)]*\)$/, '');
            if (name.trim().length < 3) {
                name = model.name || model.id;
            }
            return name.trim();
        };

        modelsToAdd.forEach(model => {
            const cleanName = getCleanModelName(model);
            const item = createDOMElement('li', { 'data-model-id': model.id, 'data-search-term': `${cleanName.toLowerCase()} ${model.id.toLowerCase()}` });
            item.innerHTML = `<span>${cleanName}</span><button class="add-model-btn modal-add-btn">+ 추가</button>`;
            list.appendChild(item);
        });
        modalContent.appendChild(list);
    }
    Modal.openModalWithContent(modalContent);
}

export const ApiSettings = {
    init(_appState, _elements, _controller) {
        appState = _appState;
        elements = _elements;
        controller = _controller;
        elements.validateKeyBtn.addEventListener('click', () => handleValidateKey('primary'));
        elements.addFallbackKeyBtn.addEventListener('click', handleAddFallbackKey);
        document.getElementById('add-model-btn')?.addEventListener('click', showAddModelModal);
        elements.apiKeyInput.addEventListener('input', e => { appState.settings.apiKey = e.target.value.trim(); saveData(appState); });
        elements.fallbackKeysList.addEventListener('input', e => {
            if (e.target.classList.contains('fallback-key-input')) {
                const inputs = Array.from(elements.fallbackKeysList.querySelectorAll('.fallback-key-input'));
                appState.settings.fallbackApiKeys = inputs.map(input => input.value.trim());
                saveData(appState);
            }
        });
        const dashboardContainer = document.getElementById('model-dashboard-container');
        if(dashboardContainer) {
            dashboardContainer.addEventListener('click', e => {
                if(e.target.closest('#empty-add-model-btn')) showAddModelModal();
                const favButton = e.target.closest('.favorite-btn');
                if(favButton) handleToggleFavorite(favButton.dataset.modelId);
                const removeButton = e.target.closest('.remove-model-btn');
                if(removeButton) handleRemoveModel(removeButton.dataset.modelId);
            });
            dashboardContainer.addEventListener('input', e => {
                const input = e.target;
                if (input.matches('input[type="number"]')) {
                    const modelId = input.dataset.modelId;
                    const settingType = input.dataset.settingType;
                    const value = input.dataset.valueType === 'float' ? parseFloat(input.value) : parseInt(input.value, 10) || 0;
                    if (!modelId || !settingType) return;
                    if (settingType === 'dailyLimit') {
                         if (!appState.settings.dailyLimits) appState.settings.dailyLimits = {};
                         appState.settings.dailyLimits[modelId] = value;
                    } else if (settingType === 'modelCost') {
                        const costType = input.dataset.costType;
                        if (!appState.settings.modelCosts[modelId]) appState.settings.modelCosts[modelId] = { input: 0, output: 0 };
                        appState.settings.modelCosts[modelId][costType] = value;
                    }
                    saveData(appState);
                    const card = input.closest('.model-card');
                    if(card && settingType === 'dailyLimit') {
                       const usageText = card.querySelector('.usage-text');
                       const usage = parseInt(usageText.textContent.split(':')[1].split('/')[0].trim());
                       usageText.textContent = `오늘 사용량: ${usage} / ${value === 0 ? '∞' : value}`;
                    }
                }
            });
        }
        document.getElementById('modal-content').addEventListener('click', e => {
            const addBtn = e.target.closest('.modal-add-btn');
            if(addBtn) {
                const modelId = addBtn.closest('li').dataset.modelId;
                if(modelId) handleAddModel(modelId);
            }
        });
        document.getElementById('modal-content').addEventListener('input', e => {
            if (e.target.id === 'add-model-search') {
                const searchTerm = e.target.value.toLowerCase();
                const listItems = document.querySelectorAll('#add-model-modal-list li');
                listItems.forEach(item => {
                    const itemTerm = item.dataset.searchTerm || '';
                    item.classList.toggle('hidden', !itemTerm.includes(searchTerm));
                });
            }
        });
    },
    render() {
        elements.apiKeyInput.value = appState.settings?.apiKey || '';
        renderFallbackKeysList();
        render();
    }
};