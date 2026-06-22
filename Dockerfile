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

# .kusto 는 프레임워크 내부 생성 출력 디렉터리(Next 의 .next 와 동일 성격)다. 확장/생성 산출물이
# 없으면 만들어지지 않을 수 있으므로, 다음 스테이지로의 COPY 가 실패하지 않도록 빈 디렉터리라도 보장한다.
RUN mkdir -p /app/.kusto

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
# .kusto: 프레임워크 내부 생성 출력 디렉터리(Next 의 .next 와 동일 성격) — 풀스택 의존이 아니라
# 빌드 타임 산출물을 담는 공용 디렉터리다. 있으면 런타임 정적 서빙에 쓰고, 없으면(확장/생성 산출물
# 부재) 비어 있어도 무방하다(빌더에서 mkdir 로 존재만 보장 → COPY 안전). 예: 풀스택 React 확장 사용
# 시 클라이언트 번들이 .kusto/react 에 생성되어 /__kusto_react/client.{js,css} 로 서빙된다(미사용 시
# 해당 라우트 자체가 없으므로 비어 있어도 문제 없음).
COPY --from=builder /app/.kusto ./.kusto

# node 이미지에 기본 포함된 비루트 사용자로 구동.
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]
