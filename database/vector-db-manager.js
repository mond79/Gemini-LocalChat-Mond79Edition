const lancedb = require('lancedb');
const path = require('path');
const axios = require('axios'); // axios를 사용합니다.

// 우리의 로컬 임베딩 서버 주소
const EMBEDDING_SERVER_URL = 'http://localhost:8001/embedding';

const dbPath = path.join(__dirname, '..', 'lancedb');
let db;
let table;

// Google API 대신, 우리의 로컬 서버에 요청을 보내는 함수로 교체!
async function getEmbedding(text) {
    try {
        const response = await axios.post(EMBEDDING_SERVER_URL, { text: text });
        return response.data.embedding;
    } catch (error) {
        console.error("로컬 임베딩 서버 호출 중 오류 발생:", error.message);
        // 오류 발생 시, 적절한 차원의 빈 벡터나 null을 반환하여 시스템 중단을 방지
        // all-MiniLM-L6-v2 모델의 차원(dimension)은 384입니다.
        return new Array(384).fill(0);
    }
}

async function initializeVectorDB() {
    db = await lancedb.connect(dbPath);
    try {
        table = await db.openTable('memories');
        console.log('[VectorDB] "memories" 테이블을 성공적으로 열었습니다.');
    } catch (e) {
        // 테이블이 없을 경우, 초기 데이터를 사용하여 생성
        const initialVector = await getEmbedding("시스템 초기화");
        if (initialVector) {
            table = await db.createTable('memories', [{
                id: 1, // SQLite의 long_term_memory id와 연결
                text: "시스템 초기화",
                vector: initialVector
            }]);
            console.log('[VectorDB] "memories" 테이블이 없어 새로 생성했습니다.');
        } else {
             console.error('[VectorDB] 초기화 실패: 임베딩 서버에서 초기 벡터를 생성할 수 없습니다.');
        }
    }
}

async function addMemory(id, text) {
    const vector = await getEmbedding(text);
    if (vector) {
        await table.add([{ id, text, vector }]);
        console.log(`[VectorDB] 기억 ID ${id}를 벡터 DB에 추가했습니다.`);
    }
}

async function searchMemories(queryText, limit = 5) {
    const queryVector = await getEmbedding(queryText);
    if (queryVector) {
        const results = await table.search(queryVector).limit(limit).execute();
        return results.map(r => r.text); // 관련된 텍스트만 반환
    }
    return []; // 벡터 생성 실패 시 빈 배열 반환
}

module.exports = {
    initializeVectorDB,
    addMemory,
    searchMemories
};