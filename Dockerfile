FROM node:18-slim AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM python:3.12-slim

WORKDIR /app

COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY backend/ backend/
COPY web/ web/
COPY --from=client-builder /app/dist ./dist

WORKDIR /app/backend
ENV PYTHONPATH=/app/backend

# Le service "bot" (docker-compose) écrase cette commande avec `python -m bot.main`.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "3000"]
