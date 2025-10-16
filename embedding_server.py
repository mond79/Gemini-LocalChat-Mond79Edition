# --- 1. 필요한 라이브러리 불러오기 ---
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
import uvicorn
import torch
from typing import List

# --- 2. 설정 및 모델 로드 ---

# 사용할 모델 이름 (가볍고 성능이 좋음)
MODEL_NAME = 'all-MiniLM-L6-v2'

# FastAPI 앱 생성
app = FastAPI(
    title="Local Embedding Server",
    description="A simple server to generate sentence embeddings using a local model.",
    version="1.0.0"
)

# GPU 사용 가능 여부 확인
device = 'cuda' if torch.cuda.is_available() else 'cpu'
print(f"INFO: 사용하는 장치: {device}")

# 임베딩 모델 로드 (서버 시작 시 한 번만 실행됨)
try:
    print(f"INFO: '{MODEL_NAME}' 모델을 로드하는 중... (처음 실행 시 몇 분 정도 걸릴 수 있습니다)")
    model = SentenceTransformer(MODEL_NAME, device=device)
    print("INFO: 모델 로드가 완료되었습니다. 서버가 준비되었습니다.")
except Exception as e:
    print(f"ERROR: 모델 로드 중 오류 발생: {e}")
    model = None

# --- 3. API가 받을 데이터 형식 정의 ---
class EmbeddingRequest(BaseModel):
    # Field의 description은 API 문서에 표시됨
    text: str = Field(..., description="임베딩을 생성할 텍스트 문장입니다.")

class EmbeddingResponse(BaseModel):
    embedding: List[float] = Field(..., description="생성된 임베딩 벡터입니다.")

# --- 4. API 엔드포인트 생성 ---

# '/embedding' 주소로 POST 요청을 받았을 때 이 함수가 실행됨
@app.post("/embedding", response_model=EmbeddingResponse)
async def create_embedding(request: EmbeddingRequest):
    """
    입력된 텍스트에 대한 임베딩 벡터를 생성합니다.
    """
    if model is None:
        raise HTTPException(status_code=503, detail="모델이 로드되지 않아 서비스를 사용할 수 없습니다.")
    
    if not request.text or not request.text.strip():
        raise HTTPException(status_code=400, detail="입력 텍스트는 비어 있을 수 없습니다.")

    try:
        # 모델을 사용하여 임베딩 생성 (핵심 로직)
        # model.encode()는 numpy 배열을 반환하므로, tolist()로 파이썬 리스트로 변환
        embedding = model.encode(request.text, convert_to_tensor=False).tolist()
        
        return {"embedding": embedding}
    except Exception as e:
        print(f"ERROR: 임베딩 생성 중 오류: {e}")
        raise HTTPException(status_code=500, detail=f"임베딩을 생성하는 중에 오류가 발생했습니다: {str(e)}")

# 서버 상태를 확인하기 위한 간단한 루트 엔드포인트
@app.get("/")
def read_root():
    return {"status": "Local Embedding Server is running", "model": MODEL_NAME if model else "Not loaded"}

# --- 5. 서버 실행 ---

# 이 파일이 직접 실행될 때만 uvicorn 서버를 시작
if __name__ == "__main__":
    # host="0.0.0.0" 으로 설정하여 외부(server.js)에서도 접근 가능하도록 함
    uvicorn.run(app, host="0.0.0.0", port=8001)