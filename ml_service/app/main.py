from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any

app = FastAPI(
    title="BrandGuard Preflight ML Service",
    description="ML service providing claim extraction, matching, rewriting, pre-mortem, and entity analysis",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check() -> Dict[str, Any]:
    return {"status": "healthy", "service": "brandguard-ml"}

@app.get("/")
def root() -> Dict[str, Any]:
    return {"name": "BrandGuard Preflight ML API", "version": "1.0.0"}

@app.post("/extract-claims")
def extract_claims(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "claims": [],
        "message": "Stub response for extract-claims"
    }

@app.post("/match")
def match_passages(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "matches": [],
        "message": "Stub response for match"
    }

@app.post("/rewrite")
def rewrite_claim(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "suggestedFix": "",
        "message": "Stub response for rewrite"
    }

@app.post("/premortem")
def premortem_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "risks": [],
        "message": "Stub response for premortem"
    }

@app.post("/image-check")
def image_check(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "results": [],
        "message": "Stub response for image-check"
    }

@app.post("/detect-entities")
def detect_entities(payload: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "entities": [],
        "message": "Stub response for detect-entities"
    }
