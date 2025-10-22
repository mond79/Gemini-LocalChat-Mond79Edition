# --- 1. 필요한 라이브러리 불러오기 ---
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
import uvicorn
import torch
from typing import List, Dict
import numpy as np
from sklearn.cluster import KMeans
import lancedb # LanceDB 라이브러리를 Python에서 사용
import os
import subprocess  
import tempfile    
import re          

# --- 2. 설정 및 모델/DB 로드 ---
MODEL_NAME = 'all-MiniLM-L6-v2'
app = FastAPI(title="Local Vector AI Server", version="4.0.0")

# --- LanceDB 설정 ---
db_path = "./lancedb" # 프로젝트 루트에 lancedb 폴더 생성
db = lancedb.connect(db_path)
table = None # 테이블 객체를 저장할 전역 변수

# 서버 시작 시 실행되는 이벤트 핸들러
@app.on_event("startup")
async def startup_event():
    global model, table
    
    # 모델 로드
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"INFO: 사용하는 장치: {device}")
    try:
        print(f"INFO: '{MODEL_NAME}' 모델을 로드하는 중...")
        model = SentenceTransformer(MODEL_NAME, device=device)
        print("INFO: 모델 로드가 완료되었습니다.")
    except Exception as e:
        print(f"ERROR: 모델 로드 중 오류 발생: {e}")
        model = None

    # LanceDB 테이블 열기 또는 생성
    table_name = "memories"
    try:
        # 1. 일단 테이블을 열려고 시도합니다.
        table = db.open_table(table_name)
        print(f"INFO: LanceDB 테이블 '{table_name}'을 성공적으로 열었습니다.")
    except Exception as e:
        # 2. 어떤 종류의 오류든 발생하면 (즉, 테이블이 없으면), 새로 생성합니다.
        print(f"INFO: LanceDB 테이블 '{table_name}'을 찾을 수 없어 새로 생성합니다. (오류: {e})")
        if model:
            try:
                # 테이블을 생성하기 위한 초기 데이터 (스키마 정의용)
                initial_vector = model.encode("init").tolist()
                schema_data = [{"vector": initial_vector, "id": 0, "text": "initial_record"}]
                
                # 기존에 같은 이름의 테이블이 남아있을 경우를 대비해, 덮어쓰기 모드(overwrite)로 안전하게 생성
                table = db.create_table(table_name, data=schema_data, mode="overwrite")
                print(f"INFO: LanceDB 테이블 '{table_name}' 생성을 완료했습니다.")
            except Exception as create_e:
                print(f"ERROR: LanceDB 테이블 생성 중 심각한 오류 발생: {create_e}")
        else:
            print("ERROR: 모델 로드 실패로 LanceDB 테이블을 생성할 수 없습니다.")


# --- 3. API 데이터 형식 정의 ---
class EmbeddingRequest(BaseModel):
    text: str
class EmbeddingResponse(BaseModel):
    embedding: List[float]

class AddMemoryRequest(BaseModel):
    id: int
    text: str
class AddMemoryResponse(BaseModel):
    message: str

class SearchMemoryRequest(BaseModel):
    text: str
    limit: int = 5
class SearchMemoryResponse(BaseModel):
    results: List[str]

class ClusteringRequest(BaseModel):
    vectors: List[List[float]]
    num_clusters: int = 5
class ClusteringResponse(BaseModel):
    labels: List[int]

class YouTubeTranscriptRequest(BaseModel):
    url: str

class YouTubeTranscriptResponse(BaseModel):
    transcript: str

# --- 4. API 엔드포인트 생성 ---
@app.post("/add", response_model=AddMemoryResponse)
async def add_memory(request: AddMemoryRequest):
    if model is None or table is None: raise HTTPException(status_code=503, detail="서버 준비 안됨")
    try:
        vector = model.encode(request.text).tolist()
        table.add([{"vector": vector, "id": request.id, "text": request.text}])
        return {"message": f"기억 ID {request.id}가 성공적으로 추가되었습니다."}
    except Exception as e:
        print(f"ERROR: 기억 추가 중 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/search", response_model=SearchMemoryResponse)
async def search_memory(request: SearchMemoryRequest):
    if model is None or table is None: raise HTTPException(status_code=503, detail="서버 준비 안됨")
    try:
        query_vector = model.encode(request.text)
        results = table.search(query_vector).limit(request.limit).to_df()
        # 결과 DataFrame에서 'text' 컬럼만 리스트로 변환하여 반환
        return {"results": results['text'].tolist()}
    except Exception as e:
        print(f"ERROR: 기억 검색 중 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/get_all_vectors")
async def get_all_vectors():
    if table is None: raise HTTPException(status_code=503, detail="서버 준비 안됨")
    try:
        # LanceDB의 모든 데이터를 가장 기본적인 딕셔너리 리스트 형태로 가져옵니다.
        all_records = table.search().to_list()
        
        # 각 딕셔너리에서 'vector' 값만 추출하여 새로운 리스트를 만듭니다.
        vectors_list = [record['vector'] for record in all_records]
        
        return {"vectors": vectors_list}
    except Exception as e:
        print(f"ERROR: 모든 벡터 조회 중 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# --- 4. API 엔드포인트 생성 ---
@app.post("/embedding", response_model=EmbeddingResponse)
async def create_embedding(request: EmbeddingRequest):
    if model is None: raise HTTPException(status_code=503, detail="모델 로드 실패")
    if not request.text or not request.text.strip(): raise HTTPException(status_code=400, detail="텍스트 필요")
    try:
        embedding = model.encode(request.text, convert_to_tensor=False).tolist()
        return {"embedding": embedding}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

# ✨ 의미 클러스터링을 위한 새로운 API 엔드포인트
@app.post("/cluster", response_model=ClusteringResponse)
async def run_clustering(request: ClusteringRequest):
    """
    입력된 벡터들을 K-Means 알고리즘을 사용하여 지정된 개수의 그룹으로 분류합니다.
    """
    if len(request.vectors) < request.num_clusters:
        raise HTTPException(status_code=400, detail="데이터(벡터)의 개수는 클러스터의 개수보다 많거나 같아야 합니다.")
    
    try:
        # K-Means 클러스터링 실행
        kmeans = KMeans(n_clusters=request.num_clusters, random_state=0, n_init='auto')
        kmeans.fit(np.array(request.vectors))
        
        # 각 데이터가 속한 그룹 라벨을 리스트로 변환하여 반환
        return {"labels": kmeans.labels_.tolist()}
    except Exception as e:
        print(f"ERROR: 클러스터링 중 오류: {e}")
        raise HTTPException(status_code=500, detail=f"클러스터링 중 오류 발생: {str(e)}")

@app.get("/")
def read_root():
    return {"status": "Local Embedding & Clustering Server is running", "model": MODEL_NAME if model else "Not loaded"}

# // 유튜브 자막 추출을 위한 API 엔드포인트를 추가합니다.
@app.post("/youtube-transcript", response_model=YouTubeTranscriptResponse)
def get_youtube_transcript(request: YouTubeTranscriptRequest):
    """
    yt-dlp를 사용하여 유튜브 영상의 자동 생성 자막(한국어 우선)을 추출합니다.
    """
    video_url = request.url
    print(f"INFO: (yt-dlp) 자막 추출 요청 수신: {video_url}")

    # 1. 임시 디렉토리를 생성하여 자막 파일을 저장할 공간을 만듭니다.
    with tempfile.TemporaryDirectory() as temp_dir:
        output_template = os.path.join(temp_dir, "%(id)s.%(ext)s")
        
        # 2. yt-dlp 명령어 실행
        command = [
            'yt-dlp',
            '--write-auto-subs',    # 자동 생성 자막 다운로드
            '--sub-lang', 'ko',     # 한국어 자막 우선
            '--skip-download',      # 영상 자체는 다운로드 안 함
            '-o', output_template,  # 출력 파일 경로 지정
            video_url
        ]
        
        try:
            print(f"INFO: (yt-dlp) 명령어 실행: {' '.join(command)}")
            subprocess.run(command, check=True, capture_output=True, text=True, encoding='utf-8')
            
            # 3. 다운로드된 자막 파일(.vtt)을 찾습니다.
            downloaded_files = os.listdir(temp_dir)
            vtt_file_path = None
            for file in downloaded_files:
                if file.endswith('.vtt'):
                    vtt_file_path = os.path.join(temp_dir, file)
                    break
            
            if not vtt_file_path:
                raise FileNotFoundError("yt-dlp가 자막 파일을 생성하지 않았습니다. (자막이 없는 영상일 수 있습니다)")

            # 4. vtt 파일을 읽고 파싱하여 순수 텍스트만 추출합니다.
            with open(vtt_file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            transcript_lines = []
            for line in lines:
                # 타임스탬프, WEBVTT 헤더, 빈 줄 등을 모두 제거합니다.
                if '-->' not in line and 'WEBVTT' not in line and line.strip():
                    # <...>, [...] 같은 태그를 제거하여 순수 텍스트만 남깁니다.
                    cleaned_line = re.sub(r'<[^>]+>|\[[^\]]+\]', '', line).strip()
                    if cleaned_line:
                        transcript_lines.append(cleaned_line)
            
            # 중복된 라인을 제거하고 합칩니다.
            unique_lines = []
            for line in transcript_lines:
                if not unique_lines or unique_lines[-1] != line:
                    unique_lines.append(line)

            full_transcript = " ".join(unique_lines)
            print(f"INFO: (yt-dlp) 자막 추출 및 파싱 성공! (길이: {len(full_transcript)})")
            
            return {"transcript": full_transcript}

        except subprocess.CalledProcessError as e:
            print(f"ERROR: (yt-dlp) 실행 중 오류 발생: {e.stderr}")
            raise HTTPException(status_code=500, detail=f"yt-dlp 실행 실패: {e.stderr}")
        except FileNotFoundError as e:
            print(f"ERROR: (yt-dlp) 자막 파일을 찾을 수 없음: {e}")
            raise HTTPException(status_code=404, detail="이 영상의 자동 생성 자막을 찾을 수 없습니다.")
        except Exception as e:
            print(f"ERROR: (yt-dlp) 알 수 없는 오류: {e}")
            raise HTTPException(status_code=500, detail=f"자막 처리 중 알 수 없는 오류 발생: {str(e)}")

# 강제 동기화를 위한 '데이터베이스 재건축' API
@app.post("/rebuild_db")
async def rebuild_db(request: dict):
    global table
    try:
        # server.js로부터 받은 모든 기억 데이터 (예: [{'id': 1, 'text': '...'}, ...])
        memories_to_add = request.get('data', [])
        if not memories_to_add:
            raise ValueError("재구축할 데이터가 없습니다.")
        
        # 1. 기존 테이블 삭제 (오류가 나도 무시)
        db.drop_table("memories", ignore_missing=True)
        print("INFO: (Rebuild) 기존 'memories' 테이블을 삭제했습니다.")
        
        # 2. 모든 기억 텍스트를 한 번에 벡터로 변환 (GPU를 활용하여 매우 빠름)
        print(f"INFO: (Rebuild) {len(memories_to_add)}개의 기억을 임베딩하는 중...")
        texts_to_embed = [item['text'] for item in memories_to_add]
        vectors = model.encode(texts_to_embed).tolist()
        
        # 3. LanceDB에 저장할 최종 데이터 형식으로 재조립
        data_for_lancedb = [
            {"vector": vec, "id": mem['id'], "text": mem['text']}
            for mem, vec in zip(memories_to_add, vectors)
        ]

        # 4. 새 테이블 생성
        table = db.create_table("memories", data=data_for_lancedb, mode="overwrite")
        print(f"INFO: (Rebuild) {len(data_for_lancedb)}개의 데이터로 'memories' 테이블을 새로 생성했습니다.")
        
        return {"message": "VectorDB 재구축 성공"}
    except Exception as e:
        print(f"ERROR: VectorDB 재구축 중 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- 5. 서버 실행 ---
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)