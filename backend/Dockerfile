FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (Docker layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/

# Expose port
EXPOSE 8000

# Run with uvicorn — use shell form so ${PORT} gets expanded by Railway
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
