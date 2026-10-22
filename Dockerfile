# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json vite.config.ts ./
COPY scripts/render-policy.mjs ./scripts/render-policy.mjs
COPY docs/privacy.md ./docs/privacy.md
COPY server ./server
COPY shared ./shared
COPY web ./web
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5057 BOOKSEERR_DATA_DIR=/data
WORKDIR /app
LABEL org.opencontainers.image.title="Bookseerr" \
      org.opencontainers.image.description="Shared book discovery and requests for Docker and NAS deployments" \
      org.opencontainers.image.source="https://github.com/TeamCogs/bookseerr" \
      org.opencontainers.image.licenses="MIT"
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 5057
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:5057/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "dist/server/index.js"]
