# syntax=docker/dockerfile:1.7
# Multi-stage build for setra cloud (server + board static)
# Build:  docker build -t setra:latest .
# Run:    docker run -p 3141:3141 -p 5173:5173 -v $HOME/.setra:/root/.setra setra:latest

FROM node:20-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/board/package.json ./apps/board/
COPY packages ./packages
RUN find packages -maxdepth 3 -name "package.json" | xargs -I{} dirname {} | xargs -I{} sh -c 'cp -r {} /tmp/{} 2>/dev/null || true'
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @setra/server... build && pnpm --filter @setra/board build

FROM base AS runtime
ENV NODE_ENV=production
ENV SETRA_PORT=3141
ENV BOARD_PORT=5173
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/board/dist ./apps/board/dist
COPY --from=build /app/apps/board/package.json ./apps/board/
COPY package.json pnpm-workspace.yaml ./

EXPOSE 3141 5173
VOLUME ["/root/.setra"]

# Serve API + static board (board served via `vite preview`)
CMD ["sh", "-c", "node apps/server/dist/index.js & pnpm --filter @setra/board exec vite preview --host 0.0.0.0 --port 5173 & wait -n"]
