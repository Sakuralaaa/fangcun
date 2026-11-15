# syntax=docker/dockerfile:1
# 构建阶段在构建机原生架构上运行（产物是纯 JS），运行阶段可为 linux/amd64 与 linux/arm64 生成镜像：
#   docker buildx build --platform linux/amd64,linux/arm64 -t fangcun .
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json vitest.config.ts ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/cli/package.json apps/cli/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    FANGCUN_DATA_DIR=/data \
    FANGCUN_WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /src/apps/server/dist/server.js /app/server.js
COPY --from=build /src/apps/cli/dist/fangcun.js /app/fangcun.js
COPY --from=build /src/apps/web/dist /app/web
RUN mkdir -p /data && chown node:node /data \
 && printf '#!/bin/sh\nexec node /app/fangcun.js "$@"\n' > /usr/local/bin/fangcun && chmod +x /usr/local/bin/fangcun
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "/app/server.js"]
