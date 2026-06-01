# LeadFlow SaaS — Koyeb/Docker deployment
FROM node:20-alpine

# Install deps for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files first (better layer caching)
COPY server/package*.json ./

# Install production deps only
RUN npm ci --omit=dev

# Copy server source
COPY server/src ./src
COPY server/setup.js ./

# Copy frontend (served by Express)
COPY client ./client

# WhatsApp session storage
RUN mkdir -p /app/wa_sessions

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "src/index.js"]
