# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# Copy only manifests first so this layer is cached unless deps change
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (campaign/ is excluded via .dockerignore)
COPY . .

# Mount point for external campaign data (SSD volume)
VOLUME ["/data/campaign"]

ENV NODE_ENV=production
ENV SIT_CAMPAIGN_DIR=/data/campaign
ENV SIT_HOST=0.0.0.0
ENV SIT_PORT=3000

EXPOSE 3000

# Use non-root user for security
RUN addgroup -S sit && adduser -S sit -G sit \
    && chown -R sit:sit /app
USER sit

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
