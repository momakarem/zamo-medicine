# ===========================================================================
# Zamo Medical Platform — Production Dockerfile
# Multi-stage build for minimal image size
# ===========================================================================

# --- Stage 1: Install production dependencies ---
FROM node:22-alpine AS deps

WORKDIR /app

# Copy package files
COPY package.json package-lock.json .npmrc ./

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# --- Stage 2: Production image ---
FROM node:22-alpine AS production

# Security: run as non-root user
RUN addgroup -g 1001 -S zamo && \
    adduser -S zamo -u 1001 -G zamo

WORKDIR /app

# Copy production dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (TypeScript — run with --experimental-strip-types)
COPY package.json .npmrc ./
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/migrate-cli.ts ./scripts/migrate-cli.ts

# Create uploads directory (for future file upload support)
RUN mkdir -p /app/uploads && chown -R zamo:zamo /app

# Switch to non-root user
USER zamo

# Expose the application port
EXPOSE 3000

# Health check — use curl-based simple check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start the application using Node.js with TypeScript stripping
CMD ["node", "--experimental-strip-types", "src/api/server.ts"]

