# syntax=docker/dockerfile:1

# ──────────────────────────────────────────────────────────────────────────
# Express.js-Kusto 컨테이너 빌드
#
# 클라우드 런타임의 Node 버전(예: 18)에 묶이지 않도록, 이미지 안에서
# Prisma 7.x 가 요구하는 Node(>=20.19 / 22.12 / 24)로 직접 빌드/구동한다.
#
# 멀티스테이지:
#   builder  - full node:22(빌드 도구 포함)로 npm ci + 빌드(네이티브 모듈 컴파일)
#   runner   - slim node:22 에 빌드 산출물 + node_modules 만 복사해 구동
#
# 주의: webpack 이 nodeExternals 를 쓰므로 dist/server.js 는 의존성을 번들하지
# 않는다 → 런타임에 node_modules 가 반드시 필요하다. 또한 @prisma/client /
# @prisma/adapter-* / better-sqlite3 가 devDependencies 로 선언되어 있어
# dev 의존성을 prune 하면 런타임이 깨진다. 따라서 node_modules 전체를 옮긴다.
# ──────────────────────────────────────────────────────────────────────────

ARG NODE_VERSION=22

# ── builder ────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm AS builder
WORKDIR /app

# 의존성 레이어 캐시: lock 파일이 안 바뀌면 npm ci 를 재사용한다.
COPY package.json package-lock.json ./
RUN npm ci

# 소스 복사 후 빌드 (db generate → type generate → typecheck → webpack → clean).
# prisma generate 는 DB 연결이 필요 없으므로 빌드 타임에 DB URL 이 없어도 된다.
COPY . .
RUN npm run build

# ── runner ───────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# 빌드 산출물 + 런타임 의존성.
# (dist 안에 views/public/prisma client/schema 가 이미 복사되어 있다.)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
# React 확장 클라이언트 번들. onInit 이 production 에서 빌드하지 않고 process.cwd()/.kusto/react
# 를 정적 서빙하므로(= /app/.kusto/react), 빌드 단계의 `kusto extensions build` 산출물을 옮긴다.
# 없으면 /__kusto_react/client.{js,css} 가 404 가 된다.
COPY --from=builder /app/.kusto ./.kusto

# node 이미지에 기본 포함된 비루트 사용자로 구동.
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
