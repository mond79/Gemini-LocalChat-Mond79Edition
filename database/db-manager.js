const path = require('path');
const Database = require('better-sqlite3');

// --- 데이터베이스 연결 ---
const dbPath = path.join(__dirname, '..', 'assistant.db');
const db = new Database(dbPath);
console.log('[DB Manager] assistant.db에 성공적으로 연결되었습니다.');

// --- 테이블 초기화 함수 ---
function initializeDatabase() {
    console.log('[DB Manager] 데이터베이스 테이블 초기화를 시작합니다...');

    db.exec(`
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            parts TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS user_profile (
            id INTEGER PRIMARY KEY DEFAULT 1,
            profile_data TEXT NOT NULL
        );
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS todos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task TEXT NOT NULL UNIQUE
        );
    `);

    // long_term_memory.json 구조에 맞춰 keywords와 sentiment 컬럼을 추가했습니다.
    db.exec(`
        CREATE TABLE IF NOT EXISTS long_term_memory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            summary TEXT NOT NULL,
            chat_id TEXT,
            timestamp TEXT NOT NULL,
            keywords TEXT,
            sentiment TEXT
        );
    `);
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS job_tracker (
            job_name TEXT PRIMARY KEY,
            last_run TEXT NOT NULL
        );
    `);

    // 클러스터링된 기억 그룹 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS memory_clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_name TEXT NOT NULL UNIQUE,
            keywords TEXT,
            last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // AI의 자기 성찰 일기 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS ai_reflections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date TEXT NOT NULL UNIQUE,
            learned TEXT,
            improvements TEXT
        );
    `);

    console.log('[DB Manager] 테이블 초기화가 완료되었습니다.');
}

// --- server.js에서 사용할 함수들 ---

// == 채팅 기록 ==
function getChatHistory(chatId) {
    const stmt = db.prepare('SELECT role, parts FROM chat_history WHERE chat_id = ? ORDER BY timestamp ASC');
    const rows = stmt.all(chatId);
    return rows.map(row => ({
        role: row.role,
        parts: JSON.parse(row.parts)
    }));
}

function saveChatMessage(chatId, role, parts) {
    const stmt = db.prepare('INSERT INTO chat_history (chat_id, role, parts) VALUES (?, ?, ?)');
    stmt.run(chatId, role, JSON.stringify(parts));
}

// == 사용자 프로필 ==
function getUserProfile() {
    const stmt = db.prepare('SELECT profile_data FROM user_profile WHERE id = 1');
    const row = stmt.get();
    if (row) {
        return JSON.parse(row.profile_data);
    }
    // DB에 프로필이 없을 경우, 초기 프로필 구조를 생성하고 반환합니다.
    const initialProfile = { 
        identity: { name: null, role: null }, // <-- 바로 이 부분! name과 role을 미리 만들어줍니다.
        preferences: { likes: [], dislikes: [] }, 
        goals: { current_tasks: [], long_term: [] }, 
        interests: [] 
    };
    saveUserProfile(initialProfile);
    return initialProfile;
}

function saveUserProfile(profileObject) {
    const stmt = db.prepare('INSERT OR REPLACE INTO user_profile (id, profile_data) VALUES (1, ?)');
    stmt.run(JSON.stringify(profileObject));
}

// == 할 일 목록 ==
function getTodos() {
    const stmt = db.prepare('SELECT task FROM todos');
    return stmt.all().map(row => row.task);
}

function addTodo(task) {
    try {
        const stmt = db.prepare('INSERT INTO todos (task) VALUES (?)');
        stmt.run(task);
        return true;
    } catch (error) {
        console.error('[DB] 할 일 추가 실패:', error.message);
        return false;
    }
}

function completeTodo(task) {
    const stmt = db.prepare("DELETE FROM todos WHERE task LIKE ?");
    const result = stmt.run(`%${task}%`);
    return result.changes > 0;
}

// == 장기 기억 ==
function getAllMemories() {
    const stmt = db.prepare('SELECT * FROM long_term_memory ORDER BY timestamp ASC');
    const rows = stmt.all();
    return rows.map(row => ({
        ...row,
        keywords: row.keywords ? JSON.parse(row.keywords) : [] // keywords가 있을 경우에만 JSON 파싱
    }));
}

// long_term_memory.json 구조에 맞춰 keywords와 sentiment도 함께 저장합니다.
function saveLongTermMemory(memoryObject) {
    const { summary, chatId, timestamp, keywords, sentiment } = memoryObject;
    const stmt = db.prepare(`
        INSERT INTO long_term_memory (summary, chat_id, timestamp, keywords, sentiment) 
        VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        summary, 
        chatId, 
        timestamp, 
        JSON.stringify(keywords || []), // keywords가 없으면 빈 배열로 저장
        sentiment
    );
    return result.lastInsertRowid;
}

// == 작업 추적 ==
function getLastRunTime(jobName) {
    const stmt = db.prepare('SELECT last_run FROM job_tracker WHERE job_name = ?');
    const row = stmt.get(jobName);
    return row ? new Date(row.last_run) : null;
}

function recordRunTime(jobName) {
    const stmt = db.prepare('INSERT OR REPLACE INTO job_tracker (job_name, last_run) VALUES (?, ?)');
    stmt.run(jobName, new Date().toISOString());
}

module.exports = {
    initializeDatabase,
    getChatHistory,
    saveChatMessage,
    getUserProfile,
    saveUserProfile,
    getTodos,
    addTodo,
    completeTodo,
    getAllMemories,
    saveLongTermMemory,
    getLastRunTime,
    recordRunTime,
    saveAiReflection
};

// AI의 자기 성찰 결과를 DB에 저장하는 함수
function saveAiReflection(entryDate, learned, improvements) {
    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO ai_reflections (entry_date, learned, improvements) 
            VALUES (?, ?, ?)
        `);
        stmt.run(entryDate, learned, improvements);
        console.log(`[DB Manager] ${entryDate} 날짜의 AI 성찰 기록을 저장했습니다.`);
        return true;
    } catch (error) {
        console.error('[DB Manager] AI 성찰 기록 저장 중 오류:', error.message);
        return false;
    }
}