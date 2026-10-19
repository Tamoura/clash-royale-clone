# One container that serves the game AND the multiplayer relay on one port
# (Fly.io, Render's Docker runtime, Railway, a VPS). The page talks to the
# relay on its own address, so nothing else needs configuring. The GitHub
# Pages copy of the game can still use this relay (ALLOWED_ORIGINS).
# See docs/deploy-multiplayer.md.

# ---- build: the game (dist/) and the relay bundle (dist-server/relay.mjs)
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY scripts/build-all.mjs ./scripts/build-all.mjs
COPY server ./server
COPY src ./src
RUN npm run build:all

# ---- runtime: just Node, ws, the relay bundle and the built game
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
RUN npm install --no-save --no-audit --no-fund ws@8 && npm cache clean --force
# The relay serves the dist/ folder next to its own: /app/dist.
COPY --from=build /app/dist-server/relay.mjs ./dist-server/relay.mjs
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "dist-server/relay.mjs"]
