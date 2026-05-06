FROM node:18-slim AS builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm install
COPY client/ ./
RUN npm run build

FROM node:18-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
COPY --from=builder /app/dist ./dist

CMD ["node", "index.js"]
