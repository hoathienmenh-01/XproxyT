# Luna-Proxy Production Dockerfile
# Multi-stage build for smaller image size

# Stage 1: Build
FROM node:24-slim AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* bun.lock* ./

# Install dependencies
RUN npm ci --production=false 2>/dev/null || npm install

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY frontend/ ./frontend/

# Stage 2: Production
FROM node:24-slim

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --production 2>/dev/null || npm install --production

# Copy built application
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/frontend ./frontend
COPY --from=builder /app/tsconfig.json ./

# Create data directory
RUN mkdir -p /app/data/wire-logs /app/data/overflow /app/data/logs

# Environment variables
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Expose port
EXPOSE 8080

# Volume for persistent data
VOLUME ["/app/data"]

# Start application
CMD ["node", "--import", "ts-node/esm", "src/dev.ts"]