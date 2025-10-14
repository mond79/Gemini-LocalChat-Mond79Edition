// [CoreDNA] This module exclusively manages model-related state.
export function setAvailableModels(state, models) {
    // 중복 제거: ID를 기준으로 중복된 모델 제거
    const uniqueModels = [];
    const seenIds = new Set();
    
    models.forEach(model => {
        if (!seenIds.has(model.id)) {
            seenIds.add(model.id);
            uniqueModels.push(model);
        }
    });
    
    state.availableModels = uniqueModels;
    
    // If no default model is set, pick the first one.
    if (!state.settings.defaultModel && uniqueModels.length > 0) {
        state.settings.defaultModel = uniqueModels[0].id;
    }
}

export function getApplicableModels(state) {
    // [BUGFIX] Removed filtering logic. Always return all available models.
    // The user should have the freedom to choose any model, regardless of attachment.
    return state.availableModels;
}

// [NEW] Categorizes models into favorites and others.
export function getCategorizedModels(state) {
    const favorites = state.settings.favoriteModels || [];
    const favoriteModels = [];
    const otherModels = [];

    state.availableModels.forEach(model => {
        if (favorites.includes(model.id)) {
            favoriteModels.push(model);
        } else {
            otherModels.push(model);
        }
    });

    // Sort both lists alphabetically by name
    const sortByName = (a, b) => a.name.localeCompare(b.name);
    favoriteModels.sort(sortByName);
    otherModels.sort(sortByName);

    return { favoriteModels, otherModels };
}