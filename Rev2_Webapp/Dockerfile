# ─── Stage 1: deps ────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
# Copy only manifests first so this layer is cached unless deps change
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# su-exec is a lightweight gosu alternative for Alpine (drops root → sit)
RUN apk add --no-cache su-exec

# Create app user with a FIXED UID/GID so host-side permissions are predictable
RUN addgroup -g 1000 -S sit && adduser -u 1000 -S sit -G sit

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source (campaign/ is excluded via .dockerignore)
COPY . .

# Copy and mark entrypoint executable
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Own the app directory
RUN chown -R sit:sit /app

# Mount point for external campaign data (SSD volume)
# Ownership is fixed at runtime by the entrypoint
VOLUME ["/data/campaign"]

ENV NODE_ENV=production
ENV SIT_CAMPAIGN_DIR=/data/campaign
ENV SIT_HOST=0.0.0.0
ENV SIT_PORT=3000

EXPOSE 3000

# Start as root — entrypoint fixes volume permissions then drops to 'sit'
ENTRYPOINT ["entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
