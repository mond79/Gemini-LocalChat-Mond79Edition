const path = require('path');
const axios = require('axios');

// 우리의 로컬 Python 서버 주소들
const PYTHON_SERVER_URL = 'http://localhost:8001';

// 이제 이 파일은 lancedb 라이브러리를 직접 사용하지 않습니다.
// 모든 작업은 Python 서버에 요청을 보내 처리합니다.

/**
 * 새로운 기억(텍스트와 ID)을 Python 서버로 보내 벡터로 변환 후 DB에 저장하도록 요청합니다.
 * @param {number} id - SQLite에 저장된 기억의 고유 ID
 * @param {string} text - 요약된 기억 텍스트
 */
async function addMemory(id, text) {
    try {
        await axios.post(`${PYTHON_SERVER_URL}/add`, { id: id, text: text });
        console.log(`[VectorDB] 기억 ID ${id}를 Python 서버를 통해 성공적으로 저장했습니다.`);
    } catch (error) {
        console.error(`[VectorDB] 기억 추가 중 오류 (Python 서버 통신):`, error.message);
    }
}

/**
 * 검색할 텍스트를 Python 서버로 보내, 의미적으로 가장 유사한 기억들을 찾아오도록 요청합니다.
 * @param {string} queryText - 검색할 문장
 * @param {number} limit - 가져올 결과의 개수
 * @returns {Promise<string[]>} - 유사한 기억 텍스트들의 배열
 */
async function searchMemories(queryText, limit = 5) {
    try {
        const response = await axios.post(`${PYTHON_SERVER_URL}/search`, { text: queryText, limit: limit });
        return response.data.results || [];
    } catch (error) {
        console.error(`[VectorDB] 기억 검색 중 오류 (Python 서버 통신):`, error.message);
        return [];
    }
}

/**
 * 클러스터링을 위해 Python 서버에 모든 벡터를 요청합니다.
 * @returns {Promise<number[][]>} - 모든 벡터들의 배열
 */
async function getAllVectors() {
    try {
        const response = await axios.get(`${PYTHON_SERVER_URL}/get_all_vectors`);
        return response.data.vectors || [];
    } catch (error) {
        console.error('[VectorDB] 모든 벡터 조회 중 오류 (Python 서버 통신):', error.message);
        return [];
    }
}
// 이 함수들은 이제 Python 서버가 담당하므로, 여기서는 더 이상 필요 없습니다.
// async function initializeVectorDB() { ... }

/**
 * 모든 텍스트 기억 데이터를 Python 서버로 보내 VectorDB 전체를 재구축하도록 요청합니다.
 * @param {Array<Object>} allMemories - [{id, text}, {id, text}, ...] 형식의 배열
 */
async function rebuildVectorDB(allMemories) {
    try {
        console.log(`[VectorDB] ${allMemories.length}개의 기억으로 VectorDB 재구축을 요청합니다...`);
        const response = await axios.post(`${PYTHON_SERVER_URL}/rebuild_db`, {
            data: allMemories
        });
        console.log('[VectorDB] Python 서버로부터 재구축 완료 응답을 받았습니다.');
        return response.data;
    } catch (error) {
        console.error(`[VectorDB] 재구축 요청 중 오류 (Python 서버 통신):`, error.message);
        throw error; // 오류를 다시 던져서 호출한 쪽(server.js)에서 알 수 있도록 함
    }
}

module.exports = {
    addMemory,
    searchMemories,
    getAllVectors,
    rebuildVectorDB
};