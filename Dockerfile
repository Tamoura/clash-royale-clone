# Multiplayer relay image (any TLS container host: Fly.io, Render, Railway,
# a VPS). The game itself is static and ships to GitHub Pages separately.
# See docs/deploy-multiplayer.md.

# ---- build: bundle server/relay.ts (+ the pure src/net rules) into one file
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json ./
COPY server ./server
COPY src ./src
RUN npm run build:relay

# ---- runtime: just Node, ws and the bundle
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
RUN npm install --no-save --no-audit --no-fund ws@8 && npm cache clean --force
COPY --from=build /app/dist-server/relay.mjs ./relay.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "relay.mjs"]
