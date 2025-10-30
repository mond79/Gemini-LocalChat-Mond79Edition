import os
import sqlite3
from datetime import datetime

# ==================================================
# 📁 1. 데이터베이스 폴더 생성
# ==================================================
BASE_DIR = os.path.join(os.getcwd(), "database")
os.makedirs(BASE_DIR, exist_ok=True)

# DB 파일 경로
DB_PATHS = {
    "memories": os.path.join(BASE_DIR, "memories.db"),
    "files": os.path.join(BASE_DIR, "files.db"),
    "reports": os.path.join(BASE_DIR, "reports.db"),
    "tasks": os.path.join(BASE_DIR, "tasks.db"),
}

# ==================================================
# 🧠 2. 각 DB 스키마 정의
# ==================================================

SCHEMAS = {
    "memories": """
    CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        user_message TEXT,
        luna_response TEXT,
        emotion_tag TEXT,
        sentiment_score REAL,
        related_task_id INTEGER,
        related_report_id INTEGER,
        related_file_id INTEGER
    );
    """,

    "files": """
    CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT,
        extension TEXT,
        file_path TEXT,
        file_size_kb REAL,
        summary TEXT,
        keywords TEXT,
        related_report_id INTEGER,
        uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """,

    "reports": """
    CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        type TEXT,
        content_md TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        linked_memory_id INTEGER,
        linked_file_id INTEGER
    );
    """,

    "tasks": """
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        category TEXT,
        title TEXT,
        status TEXT DEFAULT 'todo',
        duration_minutes INTEGER,
        related_memory_id INTEGER,
        focus_level INTEGER,
        emotion_snapshot TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """,
}

# ==================================================
# ⚙️ 3. DB 초기화 함수
# ==================================================
def initialize_databases():
    for name, path in DB_PATHS.items():
        try:
            conn = sqlite3.connect(path)
            cursor = conn.cursor()
            cursor.executescript(SCHEMAS[name])
            conn.commit()
            conn.close()
            print(f"[DB Init] ✅ '{name}.db' 초기화 성공 → {path}")
        except Exception as e:
            print(f"[DB Init] ❌ '{name}.db' 초기화 실패: {e}")

# ==================================================
# 🚀 4. 실행부
# ==================================================
if __name__ == "__main__":
    print("🧭 루나의 새로운 '뇌 구조' 생성을 시작합니다...")
    initialize_databases()
    print("✅ 모든 데이터베이스 파일이 성공적으로 생성되었습니다.")
    print("📂 'database' 폴더를 확인해보세요.")
