# db/ - Database Schema Management

Multi-database support via folder-based organization. Each subfolder represents an independent database.

## Structure

```
db/
├── default/          # "default" database
│   ├── schema.prisma # Prisma schema definition
│   └── client/       # Auto-generated Prisma client (gitignored)
├── another_db/       # Additional database (example)
│   ├── schema.prisma
│   └── client/
└── ...
```

## Conventions

- **One folder = One database**: 폴더명이 곧 데이터베이스 식별자 (`prismaManager.getWrap('default')`)
- **`schema.prisma` 필수**: 각 폴더에 Prisma schema 파일이 있어야 인식됨
- **`client/` 자동 생성**: `npm run db -- generate --all` 실행 시 각 폴더에 타입 안전한 Prisma client가 생성됨
- **환경변수로 연결**: schema의 `env("VAR_NAME")` 또는 `{FOLDER_NAME}__KUSTO_RDB_URL` 규칙으로 DB URL 결정
- **Provider 자동 감지**: `schema.prisma`의 `datasource.provider` 값에 따라 적절한 드라이버 어댑터가 동적 로드됨 (postgresql, mysql, sqlite)

## Type Generation

`npm run generate` 실행 시 `src/core/lib/types/generated-db-types.ts`에 모든 데이터베이스의 타입이 통합 생성되어 IDE 자동완성 지원.
