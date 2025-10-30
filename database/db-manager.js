const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const dbDir = path.join(__dirname, '..', 'database');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbConnections = {
    main: new Database(path.join(__dirname, '..', 'assistant.db')), // 기존 assistant.db
    memories: new Database(path.join(dbDir, 'memories.db')),
    files: new Database(path.join(dbDir, 'files.db')),
    reports: new Database(path.join(dbDir, 'reports.db')),
    tasks: new Database(path.join(dbDir, 'tasks.db')),
};
console.log("[DB Manager v2.0] Notion-Style 데이터베이스 멀티-커넥션 완료.");
const db = dbConnections.main; // <<< 기존 코드와의 호환성을 위해 'db' 변수는 main을 가리키도록 유지

// --- 헬퍼 함수 ---
// 테이블에 특정 컬럼이 없으면 추가하는 범용 함수
function addColumnIfNotExists(tableName, columnName, columnType) {
    try {
        const columns = db.pragma(`table_info(${tableName})`);
        const columnExists = columns.some(col => col.name === columnName);
        if (!columnExists) {
            db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
            console.log(`[DB Manager] "${tableName}" 테이블에 "${columnName}" 컬럼을 추가했습니다.`);
        }
    } catch (error) {
        // 테이블이 아직 없거나 다른 오류가 발생해도, 앱이 멈추지 않도록 처리
        if (!error.message.includes("duplicate column name")) {
            console.error(`[DB Manager] ${tableName} 테이블에 ${columnName} 컬럼 추가 중 오류:`, error.message);
        }
    }
}

// --- 테이블 초기화 함수 ---
function initializeDatabase() {
    console.log('[DB Manager] 데이터베이스 테이블 초기화를 시작합니다...');

    addClusterIdToMemoriesTable();

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
    
    // 'insight_text' 컬럼이 없으면 추가
    try {
        // 테이블 정보를 읽어와서 'insight_text' 컬럼이 있는지 확인
        const columns = db.pragma('table_info(ai_reflections)');
        const hasInsightColumn = columns.some(col => col.name === 'insight_text');
        
        if (!hasInsightColumn) {
            db.exec('ALTER TABLE ai_reflections ADD COLUMN insight_text TEXT');
            console.log('[DB Manager] "ai_reflections" 테이블에 "insight_text" 컬럼을 추가했습니다.');
        }
    } catch (error) {
        // 테이블이 아직 존재하지 않는 경우 등 오류는 무시
    }

    // 기억 압축: 'is_archived' 컬럼이 없으면 추가
    try {
        const columns = db.pragma('table_info(long_term_memory)');
        const hasArchivedColumn = columns.some(col => col.name === 'is_archived');
        if (!hasArchivedColumn) {
            db.exec('ALTER TABLE long_term_memory ADD COLUMN is_archived INTEGER DEFAULT 0');
            console.log('[DB Manager] "long_term_memory" 테이블에 "is_archived" 컬럼을 추가했습니다.');
        }
    } catch (error) { /* 오류 무시 */ }

    // 기억 압축: 압축된 기억을 저장할 새 테이블 생성
    db.exec(`
        CREATE TABLE IF NOT EXISTS compressed_memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_id INTEGER,
            summary_text TEXT NOT NULL,
            source_memory_ids TEXT NOT NULL, -- JSON 배열 형태 [1, 2, 3]
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (cluster_id) REFERENCES memory_clusters(id)
        );
    `);

    addColumnIfNotExists('ai_reflections', 'emotional_weight', 'TEXT');

    // '하루 요약 서사'를 저장할 새 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_summaries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_date TEXT NOT NULL UNIQUE,
            dominant_emotion TEXT,
            emotion_counts TEXT,
            narrative TEXT,
            highlights TEXT
        );
    `);

    // 메타 성찰 : '주간 메타 성찰' 기록을 저장할 새 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS weekly_meta_insights (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            week_start TEXT NOT NULL UNIQUE,
            days_range INTEGER NOT NULL,
            dominant_emotion TEXT,
            peak_day TEXT,
            low_day TEXT,
            summary_json TEXT,
            narrative TEXT,
            goal_title TEXT,      
            goal_desc TEXT,  
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);

    // (자율 루프) : 사용자 설정을 저장할 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );
    `);

    // (자율 루프) : 모든 종류의 활동을 기록할 '범용 활동 기록부'
    db.exec(`
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            activity_type TEXT NOT NULL, -- 예: 'study', 'fitness', 'music'
            started_at TEXT NOT NULL,
            ended_at TEXT,
            duration_minutes INTEGER,
            notes TEXT,
            meta_data TEXT -- JSON 형태의 추가 정보 (예: 공부 과목, 운동 종류)
        );
    `);

    // ✨ (자율 루프) : 일일 활동을 요약하는 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_activity_summary (
            date TEXT PRIMARY KEY,
            total_sessions INTEGER,
            total_minutes INTEGER,
            narrative TEXT,
            activity_counts TEXT -- JSON 형태 (예: {"study": 3, "fitness": 1})
        );
    `);

    // 감정 로그 테이블
     db.exec(`
        CREATE TABLE IF NOT EXISTS luna_emotion_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            video_id TEXT,
            timestamp_seconds REAL NOT NULL,
            emotion TEXT NOT NULL,
            comment TEXT,
            source_text TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // 집중 세션 기록 테이블
    db.exec(`
        CREATE TABLE IF NOT EXISTS focus_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            duration_minutes INTEGER,
            emotion_summary_json TEXT,
            narrative_summary TEXT
        )
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

// AI의 자기 성찰 결과를 DB에 저장하는 함수
function saveAiReflection(entryDate, learned, improvements, insight_text, emotional_weight) { 
    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO ai_reflections (entry_date, learned, improvements, insight_text, emotional_weight) 
            VALUES (?, ?, ?, ?, ?)
        `); 
        stmt.run(entryDate, learned, improvements, insight_text, emotional_weight); 
        console.log(`[DB Manager] ${entryDate} 날짜의 AI 성찰 및 감정 기록을 저장했습니다.`);
        return true;
    } catch (error) {
        console.error('[DB Manager] AI 성찰 기록 저장 중 오류:', error.message);
        return false;
    }
}

// 기억의 메타데이터(키워드, 감정)를 업데이트하는 함수
function updateMemoryMetadata(memoryId, keywords, sentiment) {
    try {
        const stmt = db.prepare(`
            UPDATE long_term_memory 
            SET keywords = ?, sentiment = ? 
            WHERE id = ?
        `);
        const result = stmt.run(JSON.stringify(keywords || []), sentiment, memoryId);
        
        // result.changes > 0 이면 업데이트 성공
        return result.changes > 0;
    } catch (error) {
        console.error('[DB Manager] 기억 메타데이터 업데이트 중 오류:', error.message);
        return false;
    }
}

// 클러스터 정보를 저장/업데이트하는 함수
function saveMemoryCluster(clusterId, clusterName, keywords) {
    try {
        // 클러스터 ID(0, 1, 2...)를 기반으로 정보를 삽입하거나 교체합니다.
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO memory_clusters (id, cluster_name, keywords, last_updated) 
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run(clusterId, clusterName, JSON.stringify(keywords || []));
        return true;
    } catch (error) {
        console.error('[DB Manager] 메모리 클러스터 저장 중 오류:', error.message);
        return false;
    }
}

// 클러스터링: long_term_memory 테이블에 cluster_id를 추가하기 위한 준비
// (테이블 구조를 변경하는 함수. 앱 시작 시 한 번만 실행됨)
function addClusterIdToMemoriesTable() {
    try {
        // long_term_memory 테이블의 구조를 확인
        const columns = db.pragma('table_info(long_term_memory)');
        const hasClusterId = columns.some(col => col.name === 'cluster_id');

        // 'cluster_id' 컬럼이 없다면 추가
        if (!hasClusterId) {
            db.exec('ALTER TABLE long_term_memory ADD COLUMN cluster_id INTEGER');
            console.log('[DB Manager] "long_term_memory" 테이블에 "cluster_id" 컬럼을 추가했습니다.');
        }
    } catch (error) {
        // 이미 컬럼이 존재하는 경우 등 오류는 무시
        if (!error.message.includes("duplicate column name")) {
             console.error('[DB Manager] 컬럼 추가 중 오류:', error.message);
        }
    }
}

// 클러스터링: 여러 기억의 클러스터 ID를 한 번에 업데이트하는 함수
function batchUpdateMemoryClusterIds(memoryUpdates) {
    if (!memoryUpdates || memoryUpdates.length === 0) return;

    const stmt = db.prepare('UPDATE long_term_memory SET cluster_id = ? WHERE id = ?');
    const updateMany = db.transaction((updates) => {
        for (const update of updates) {
            stmt.run(update.cluster_id, update.id);
        }
    });

    try {
        updateMany(memoryUpdates);
        console.log(`[DB Manager] ${memoryUpdates.length}개 기억의 클러스터 ID를 성공적으로 업데이트했습니다.`);
    } catch (error) {
        console.error('[DB Manager] 클러스터 ID 일괄 업데이트 중 오류:', error.message);
    }
}

// (시각화): 클러스터별 기억 통계를 계산하는 함수
function getMemoryClusterStats() {
    try {
        // memory_clusters 테이블(이름)과 long_term_memory 테이블(개수)을 조인(JOIN)하여 통계를 냅니다.
        const stmt = db.prepare(`
            SELECT 
                mc.cluster_name, 
                COUNT(ltm.id) as memory_count
            FROM 
                memory_clusters mc
            LEFT JOIN 
                long_term_memory ltm ON mc.id = ltm.cluster_id
            GROUP BY 
                mc.id, mc.cluster_name
            ORDER BY 
                memory_count DESC
        `);
        const stats = stmt.all();
        return stats; // 예: [{ cluster_name: '기술', memory_count: 50 }, ...]
    } catch (error) {
        console.error('[DB Manager] 기억 클러스터 통계 계산 중 오류:', error.message);
        return [];
    }
}

// 기억 압축 : 모든 클러스터 정보를 가져오는 함수
function getAllClusters() {
    try {
        const stmt = db.prepare('SELECT id, cluster_name FROM memory_clusters');
        return stmt.all();
    } catch (error) {
        console.error('[DB Manager] 모든 클러스터 조회 중 오류:', error.message);
        return [];
    }
}

// 기억 압축 : 특정 클러스터의 보관되지 않은 기억들을 가져오는 함수
function getUnarchivedMemoriesByCluster(clusterId) {
    try {
        const stmt = db.prepare(`
            SELECT id, summary FROM long_term_memory 
            WHERE cluster_id = ? AND (is_archived = 0 OR is_archived IS NULL)
        `);
        return stmt.all(clusterId);
    } catch (error) {
        console.error(`[DB Manager] 클러스터별 기억 조회 중 오류 (ID: ${clusterId}):`, error.message);
        return [];
    }
}

// 기억 압축 : 압축된 새 기억을 저장하는 함수
function saveCompressedMemory(clusterId, summaryText, sourceMemoryIds) {
    try {
        const stmt = db.prepare(`
            INSERT INTO compressed_memories (cluster_id, summary_text, source_memory_ids) 
            VALUES (?, ?, ?)
        `);
        stmt.run(clusterId, summaryText, JSON.stringify(sourceMemoryIds));
        return true;
    } catch (error) {
        console.error('[DB Manager] 압축된 기억 저장 중 오류:', error.message);
        return false;
    }
}

// 기억 압축 : 주어진 ID의 기억들을 '보관 처리'하는 함수
function archiveMemories(memoryIds) {
    if (!memoryIds || memoryIds.length === 0) return;

    const stmt = db.prepare('UPDATE long_term_memory SET is_archived = 1 WHERE id = ?');
    const archiveMany = db.transaction((ids) => {
        for (const id of ids) {
            stmt.run(id);
        }
    });

    try {
        archiveMany(memoryIds);
        console.log(`[DB Manager] ${memoryIds.length}개의 기억을 성공적으로 보관 처리했습니다.`);
    } catch (error) {
        console.error('[DB Manager] 기억 보관 처리 중 오류:', error.message);
    }
}

// 기억 브라우저를 위한 데이터 조회 함수
function getMemoriesForBrowser(filters = {}) {
    // 향후 필터링 기능 확장을 위해 filters 객체를 인자로 받도록 설계합니다.
    // 예: filters = { clusterId: 1, isArchived: false }
    try {
        // SQL 쿼리문을 동적으로 만들기 위해 준비합니다.
        let baseQuery = `
            SELECT 
                ltm.id, 
                ltm.summary, 
                ltm.timestamp, 
                ltm.is_archived,
                mc.cluster_name 
            FROM 
                long_term_memory ltm
            LEFT JOIN 
                memory_clusters mc ON ltm.cluster_id = mc.id
        `;
        
        let whereClauses = [];
        let params = [];

        // (향후 여기에 필터링 로직을 추가할 수 있습니다)
        // if (filters.isArchived !== undefined) {
        //     whereClauses.push('ltm.is_archived = ?');
        //     params.push(filters.isArchived ? 1 : 0);
        // }

        if (whereClauses.length > 0) {
            baseQuery += ' WHERE ' + whereClauses.join(' AND ');
        }

        baseQuery += ' ORDER BY ltm.timestamp DESC'; // 항상 최신순으로 정렬

        const stmt = db.prepare(baseQuery);
        return stmt.all(...params);

    } catch (error) {
        console.error('[DB Manager] 기억 브라우저 데이터 조회 중 오류:', error.message);
        return [];
    }
}

// 감정 히트맵 : 특정 기간의 감정 통계를 계산하는 함수
function getEmotionStats(days = 7) { // 기본값으로 최근 7일을 설정
    try {
        // 'days' 변수를 사용하여 동적으로 기간을 설정합니다.
        // '?' 플레이스홀더를 사용하여 SQL Injection 공격을 방지합니다.
        const stmt = db.prepare(`
            SELECT 
                emotional_weight, 
                COUNT(*) as count
            FROM 
                ai_reflections
            WHERE 
                entry_date >= date('now', '-' || ? || ' days')
            GROUP BY 
                emotional_weight
            ORDER BY 
                count DESC
        `);
        const stats = stmt.all(days);
        return stats; // 예: [{ emotional_weight: '긍정', count: 5 }, ...]
    } catch (error) {
        console.error('[DB Manager] 감정 통계 계산 중 오류:', error.message);
        return [];
    }
}

// 성찰 로그 뷰어를 위한 데이터 조회 함수
function getReflectionsForBrowser(filters = {}) {
    try {
        // 나중에 날짜 범위 필터링 등을 위해 확장 가능하도록 설계
        const stmt = db.prepare(`
            SELECT 
                entry_date,
                learned,
                improvements,
                insight_text
            FROM 
                ai_reflections
            ORDER BY 
                entry_date DESC
        `);
        return stmt.all(); // 예: [{ entry_date: '2025-10-18', learned: '...', ...}, ...]
    } catch (error) {
        console.error('[DB Manager] 성찰 로그 데이터 조회 중 오류:', error.message);
        return [];
    }
}

// 특정 날짜의 기억들을 가져오는 함수
function getMemoriesByDate(dateStr) { // dateStr = 'YYYY-MM-DD'
    try {
        const stmt = db.prepare(`
            SELECT summary, cluster_name FROM long_term_memory 
            WHERE date(timestamp) = ? 
            ORDER BY timestamp DESC
        `);
        return stmt.all(dateStr);
    } catch (e) { return []; }
}

// 특정 날짜의 성찰 기록을 가져오는 함수
function getReflectionByDate(dateStr) {
    try {
        const stmt = db.prepare('SELECT * FROM ai_reflections WHERE entry_date = ?');
        return stmt.get(dateStr);
    } catch (e) { return null; }
}

// '하루 요약'을 저장/업데이트(upsert)하는 함수
function saveDailyNarrative(summary) {
    try {
        const stmt = db.prepare(`
            INSERT INTO daily_summaries (entry_date, dominant_emotion, emotion_counts, narrative, highlights)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(entry_date) DO UPDATE SET
                dominant_emotion = excluded.dominant_emotion,
                emotion_counts = excluded.emotion_counts,
                narrative = excluded.narrative,
                highlights = excluded.highlights
        `);
        stmt.run(
            summary.date, 
            summary.dominantEmotion, 
            JSON.stringify(summary.emotionCounts),
            summary.narrative,
            JSON.stringify(summary.highlights)
        );
    } catch (error) {
        console.error('[DB Manager] 하루 요약 저장 중 오류:', error.message);
    }
}

function getDailySummaries() {
    try {
        const stmt = db.prepare('SELECT * FROM daily_summaries ORDER BY entry_date DESC');
        return stmt.all();
    } catch (e) { return []; }
}

// (메타 성찰) : '주간 메타 성찰'을 저장/업데이트하는 함수
function saveWeeklyMetaInsight(insight) {
    try {
        const stmt = db.prepare(`
            INSERT INTO weekly_meta_insights (week_start, days_range, dominant_emotion, peak_day, low_day, summary_json, narrative, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(week_start) DO UPDATE SET
                days_range = excluded.days_range,
                dominant_emotion = excluded.dominant_emotion,
                peak_day = excluded.peak_day,
                low_day = excluded.low_day,
                summary_json = excluded.summary_json,
                narrative = excluded.narrative,
                updated_at = CURRENT_TIMESTAMP
        `);
        stmt.run(
            insight.week_start, insight.days, insight.dominant,
            insight.peak_day, insight.low_day,
            JSON.stringify(insight.summary_json), insight.narrative
        );
    } catch (error) {
        console.error('[DB Manager] 주간 메타 성찰 저장 중 오류:', error.message);
    }
}

// ✨ ----- 13차 진화 (자율 루프) 함수들 ----- ✨

// -- 사용자 설정 (user_settings) 관련 --
function getUserSetting(key, defaultValue = null) {
    try {
        const stmt = db.prepare('SELECT value FROM user_settings WHERE key = ?');
        const row = stmt.get(key);
        return row ? row.value : defaultValue;
    } catch (e) { return defaultValue; }
}

function saveUserSetting(key, value) {
    try {
        const stmt = db.prepare(`
            INSERT INTO user_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `);
        stmt.run(key, String(value));
    } catch (error) {
        console.error(`[DB Manager] 설정 저장 중 오류 (key: ${key}):`, error.message);
    }
}

// -- 활동 기록 (activity_log) 관련 --
function startActivityLog(activityType, notes = '', metaData = {}) {
    try {
        const startTime = new Date().toISOString();
        const stmt = db.prepare(`
            INSERT INTO activity_log (activity_type, started_at, notes, meta_data) 
            VALUES (?, ?, ?, ?)
        `);
        const result = stmt.run(activityType, startTime, notes, JSON.stringify(metaData));
        return result.lastInsertRowid; // 생성된 활동 로그의 고유 ID 반환
    } catch (error) {
        console.error(`[DB Manager] 활동 시작 기록 중 오류 (type: ${activityType}):`, error.message);
        return null;
    }
}

function finishActivityLog(logId) {
    try {
        const endTime = new Date();
        const stmtSelect = db.prepare('SELECT started_at FROM activity_log WHERE id = ?');
        const row = stmtSelect.get(logId);
        if (!row) return null;

        const startTime = new Date(row.started_at);
        const durationMinutes = Math.round((endTime - startTime) / (1000 * 60));

        const stmtUpdate = db.prepare('UPDATE activity_log SET ended_at = ?, duration_minutes = ? WHERE id = ?');
        stmtUpdate.run(endTime.toISOString(), durationMinutes, logId);
        
        return { duration_minutes: durationMinutes };
    } catch (error) {
        console.error(`[DB Manager] 활동 종료 기록 중 오류 (ID: ${logId}):`, error.message);
        return null;
    }
}

// -- 일일 활동 요약 (daily_activity_summary) 관련 --
// (이 함수들은 '기억의 정원사'가 자정에 사용할 것입니다)
function getActivitiesByDate(dateStr) {
    try {
        const stmt = db.prepare(`
            SELECT activity_type, duration_minutes, notes FROM activity_log
            WHERE date(started_at) = ? AND duration_minutes IS NOT NULL
        `);
        return stmt.all(dateStr);
    } catch (e) { return []; }
}

function saveDailyActivitySummary(summary) {
    try {
        const stmt = db.prepare(`
            INSERT INTO daily_activity_summary (date, total_sessions, total_minutes, narrative, activity_counts)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(date) DO UPDATE SET
                total_sessions = excluded.total_sessions,
                total_minutes = excluded.total_minutes,
                narrative = excluded.narrative,
                activity_counts = excluded.activity_counts
        `);
        stmt.run(
            summary.date, 
            summary.totalSessions, 
            summary.totalMinutes, 
            summary.narrative,
            JSON.stringify(summary.activityCounts)
        );
    } catch (error) {
        console.error('[DB Manager] 일일 활동 요약 저장 중 오류:', error.message);
    }
}

function getLatestWeeklyGoal() {
    try {
        // '주간 목표' 테이블에서 가장 최신 목표를 하나 가져옵니다.
        const stmt = db.prepare('SELECT * FROM weekly_goals ORDER BY week_start DESC LIMIT 1');
        return stmt.get();
    } catch (e) { return null; }
}

// 루나 감정 로그 저장 함수
function logLunaEmotion(logData) {
    try {
        const stmt = db.prepare(`
            INSERT INTO luna_emotion_log (video_id, timestamp_seconds, emotion, comment, source_text)
            VALUES (@videoId, @timestamp, @emotion, @comment, @sourceText)
        `);
        stmt.run({
            videoId: logData.videoId || null,
            timestamp: logData.timestamp,
            emotion: logData.emotion,
            comment: logData.comment,
            sourceText: logData.sourceText
        });
        console.log(`[DB Manager] 루나 감정 로그 저장 완료: ${logData.emotion}`);
        return true;
    } catch (error) {
        console.error('[DB Manager] 루나 감정 로그 저장 실패:', error);
        return false;
    }
}

// 집중 세션 기록 함수
function startFocusSession() {
    try {
        const stmt = db.prepare('INSERT INTO focus_sessions (start_time) VALUES (?)');
        const info = stmt.run(new Date().toISOString());
        console.log(`[DB Manager] 새로운 집중 세션 시작. ID: ${info.lastInsertRowid}`);
        return info.lastInsertRowid; // 방금 생성된 세션의 고유 ID를 반환
    } catch (error) {
        console.error('[DB Manager] 집중 세션 시작 실패:', error);
        return null;
    }
}

function endFocusSession(sessionId, duration, emotionSummary, narrativeSummary) {
    try {
        const stmt = db.prepare(`
            UPDATE focus_sessions
            SET end_time = ?, duration_minutes = ?, emotion_summary_json = ?, narrative_summary = ?
            WHERE id = ?
        `);
        stmt.run(
            new Date().toISOString(),
            duration,
            JSON.stringify(emotionSummary),
            narrativeSummary,
            sessionId
        );
        console.log(`[DB Manager] 집중 세션 ID ${sessionId} 종료 및 분석 결과 저장 완료.`);
        return true;
    } catch (error) {
        console.error(`[DB Manager] 집중 세션 ID ${sessionId} 종료 실패:`, error);
        return false;
    }
}

function getEmotionsForSession(focusSessionId) {
    try {
        // 1. focus_sessions 테이블에서 해당 세션의 시작 시간을 가져옵니다.
        const session = db.prepare('SELECT start_time FROM focus_sessions WHERE id = ?').get(focusSessionId);
        if (!session) return [];

        // 2. luna_emotion_log 테이블에서, 해당 시작 시간 이후에 기록된 모든 감정 로그를 가져옵니다.
        // (주의: 이 방식은 세션이 겹치지 않는다는 가정 하에 작동합니다)
        const stmt = db.prepare('SELECT emotion, comment, timestamp_seconds FROM luna_emotion_log WHERE created_at >= ?');
        const emotions = stmt.all(session.start_time);
        return emotions;
    } catch (error) {
        console.error(`[DB Manager] 세션 ID ${focusSessionId}의 감정 로그 조회 실패:`, error);
        return [];
    }
}

// --- Weekly Emotion Report Functions ---

// ISO 날짜 문자열을 받아 해당 주의 시작(월요일)과 끝(다음 주 월요일)을 반환하는 헬퍼 함수
function getWeekRange(dateString) {
    const d = new Date(dateString);
    const day = d.getDay(); // 0 (일요일) - 6 (토요일)
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // 월요일을 주의 시작으로 설정
    
    const monday = new Date(d.setDate(diff));
    monday.setHours(0, 0, 0, 0);

    const nextMonday = new Date(monday);
    nextMonday.setDate(monday.getDate() + 7);

    return {
        startISO: monday.toISOString(),
        endISO: nextMonday.toISOString()
    };
}

// 감정 데이터의 분포(distribution)와 변동성(volatility)을 계산하는 헬퍼 함수
function analyzeEmotionData(logs) {
    const tally = {};
    let totalWeight = 0;
    const intensities = [];

    for (const log of logs) {
        const emotion = (log.emotion || "neutral").trim();
        // 감정 강도가 없다면 0.5로 간주, 0~1 사이로 제한
        const intensity = typeof log.intensity === 'number' ? Math.max(0, Math.min(1, log.intensity)) : 0.5;
        
        tally[emotion] = (tally[emotion] || 0) + (0.5 + intensity);
        totalWeight += (0.5 + intensity);
        intensities.push(intensity);
    }

    const distribution = Object.entries(tally)
        .map(([emotion, value]) => ({ emotion, value, percentage: totalWeight ? (value / totalWeight) * 100 : 0 }))
        .sort((a, b) => b.value - a.value);

    let volatility = 0;
    if (intensities.length > 1) {
        const mean = intensities.reduce((a, b) => a + b, 0) / intensities.length;
        const variance = intensities.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (intensities.length - 1);
        volatility = Math.sqrt(variance); // 표준편차
    }

    return {
        distribution,
        volatility: Number(volatility.toFixed(2))
    };
}

// 특정 주의 모든 데이터를 가져와 분석하는 메인 함수
function getWeeklyReportData(dateString = new Date().toISOString()) {
    try {
        const { startISO, endISO } = getWeekRange(dateString);

        // 1. 해당 주간의 '집중 세션' 데이터를 가져옵니다.
        const sessions = db.prepare(`
            SELECT start_time, duration_minutes FROM focus_sessions 
            WHERE start_time >= ? AND start_time < ? AND duration_minutes IS NOT NULL
        `).all(startISO, endISO);

        // 2. 해당 주간의 모든 '감정 로그'를 가져옵니다.
        const allLogs = db.prepare(`
            SELECT emotion, intensity, source, created_at FROM luna_emotion_log
            WHERE created_at >= ? AND created_at < ?
        `).all(startISO, endISO);

        // 3. 통계를 계산합니다.
        const totalDuration = sessions.reduce((sum, s) => sum + s.duration_minutes, 0);
        const avgDuration = sessions.length > 0 ? Math.round(totalDuration / sessions.length) : 0;
        
        const hourCounts = {};
        sessions.forEach(s => {
            const hour = new Date(s.start_time).getHours();
            hourCounts[hour] = (hourCounts[hour] || 0) + 1;
        });
        const peakHour = Object.keys(hourCounts).length > 0 ? 
            Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0][0] : null;

        const focusLogs = allLogs.filter(log => log.source === 'focus' || !log.source); // source가 없는 경우 focus로 간주
        const youtubeLogs = allLogs.filter(log => log.source === 'youtube');

        const focusAnalysis = analyzeEmotionData(focusLogs);
        const youtubeAnalysis = analyzeEmotionData(youtubeLogs);
        const overallAnalysis = analyzeEmotionData(allLogs);

        // 4. 최종 보고서 객체를 구성하여 반환합니다.
        return {
            range: { startISO, endISO },
            sessionStats: {
                count: sessions.length,
                avgMinutes: avgDuration,
                peakHour: peakHour ? Number(peakHour) : null
            },
            emotionStats: {
                overall: overallAnalysis,
                focus: focusAnalysis,
                youtube: youtubeAnalysis
            }
        };

    } catch (error) {
        console.error('[DB Manager] 주간 보고서 데이터 생성 실패:', error);
        return null;
    }
}

function getLatestWeeklyReport() {
    try {
        // [핵심] 몬드님의 테이블 이름 'weekly_meta_insights'를 사용합니다.
        const stmt = db.prepare(`
            SELECT week_start, days_range, summary_json, narrative 
            FROM weekly_meta_insights 
            ORDER BY created_at DESC 
            LIMIT 1
        `);
        const row = stmt.get();
        if (!row) return null;

        // [핵심] 몬드님의 컬럼 이름('week_start')을 사용하여 range 객체를 만듭니다.
        const startDate = new Date(row.week_start);
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + row.days_range);
        
        return {
            range: { startISO: startDate.toISOString(), endISO: endDate.toISOString() },
            stats: JSON.parse(row.summary_json),
            narrative: row.narrative
        };
    } catch (error) {
        console.error("[DB Manager] 최신 주간 보고서 조회 실패:", error);
        return null;
    }
}

// --- Notion-Style DB Functions ---

function saveNewMemory(memoryData) {
    const db = dbConnections.memories;
    const stmt = db.prepare('INSERT INTO memories (user_message, luna_response, emotion_tag) VALUES (@user_message, @luna_response, @emotion_tag)');
    return stmt.run(memoryData).lastInsertRowid;
}

function saveNewFile(fileData) {
    const db = dbConnections.files;
    const stmt = db.prepare('INSERT INTO files (filename, extension, file_path, summary, keywords) VALUES (@filename, @extension, @file_path, @summary, @keywords)');
    return stmt.run(fileData).lastInsertRowid;
}

// ... (saveNewReport, saveNewTask 함수도 유사하게 추가) ...

/**
 * @description 루나가 생성한 리포트를 reports.db에 저장합니다.
 * @param {object} reportData - { title, type, content_md, linked_file_id }
 * @returns {number} 새로 생성된 리포트의 ID
 */
function saveNewReport(reportData) {
    const db = dbConnections.reports;
    const stmt = db.prepare(`
        INSERT INTO reports (title, type, content_md, linked_file_id) 
        VALUES (@title, @type, @content_md, @linked_file_id)
    `);
    const info = stmt.run(reportData);
    console.log(`[DB Manager v2.0] 새로운 리포트 저장 완료 (ID: ${info.lastInsertRowid}) -> reports.db`);
    return info.lastInsertRowid;
}

/**
 * @description 새로운 작업을 tasks.db에 추가합니다.
 * @param {object} taskData - { category, title, duration_minutes, status }
 * @returns {number} 새로 생성된 작업의 ID
 */
function saveNewTask(taskData) {
    const db = dbConnections.tasks;
    const stmt = db.prepare(`
        INSERT INTO tasks (category, title, duration_minutes, status, date)
        VALUES (@category, @title, @duration_minutes, @status, date('now'))
    `);
    const info = stmt.run(taskData);
    console.log(`[DB Manager v2.0] 새로운 작업 저장 완료 (ID: ${info.lastInsertRowid}) -> tasks.db`);
    return info.lastInsertRowid;
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
    saveAiReflection,
    updateMemoryMetadata,
    saveMemoryCluster,      
    addClusterIdToMemoriesTable,
    batchUpdateMemoryClusterIds,
    getMemoryClusterStats,
    getAllClusters,              
    getUnarchivedMemoriesByCluster, 
    saveCompressedMemory,        
    archiveMemories,
    getMemoriesForBrowser,
    getReflectionsForBrowser,
    getEmotionStats,
    getMemoriesByDate,
    getReflectionByDate,
    saveDailyNarrative,
    getDailySummaries,
    saveWeeklyMetaInsight,     
    getUserSetting,
    saveUserSetting,
    startActivityLog,
    finishActivityLog,
    getActivitiesByDate,
    saveDailyActivitySummary,
    getLatestWeeklyGoal,
    logLunaEmotion,
    startFocusSession,
    endFocusSession,
    getEmotionsForSession,
    getWeeklyReportData,
    getWeekRange,
    getLatestWeeklyReport,
    saveNewMemory,
    saveNewFile,
    saveNewReport,
    saveNewTask,   
};