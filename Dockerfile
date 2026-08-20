# syntax=docker/dockerfile:1

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app

# Manifests are copied before sources so dependency installation is cached and
# only re-runs when a package.json or the lockfile actually changes.
COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/

RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY server ./server
COPY web ./web

RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/web/dist

COPY package.json package-lock.json* ./
COPY server/package.json ./server/
COPY web/package.json ./web/

# The frontend is already compiled to static files, so only the server's
# runtime dependencies are needed in the final image.
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --workspace @app/server --include-workspace-root; \
    else \
      npm install --omit=dev --workspace @app/server --include-workspace-root; \
    fi \
    && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

# Drop root; the node image ships an unprivileged `node` user for this.
USER node

EXPOSE 8080

# Container Apps probes this before routing traffic to a cold-started replica.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
