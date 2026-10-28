FROM python:3.11-slim

WORKDIR /app

ARG INSTALL_ML_MODELS=false

# Tesseract powers OCR on scanned PDFs and text-bearing images.
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Heavy model packages and the spaCy English pipeline are opt-in. Set
# INSTALL_ML_MODELS=true at build time to enable FAISS/SentenceTransformers and NER.
COPY requirements-models.txt ./
RUN if [ "$INSTALL_ML_MODELS" = "true" ]; then \
      pip install --no-cache-dir -r requirements-models.txt && \
      python -m spacy download en_core_web_sm; \
    fi

COPY . .

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
