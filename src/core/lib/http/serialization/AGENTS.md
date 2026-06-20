# serialization/ - Response Serialization

The sub-tier that safely converts non-serializable types (BigInt · Date · Prisma `@db.Date`), applies the router response serializer (`pick`/`omit`/functional), and overrides `res.json` to automatically serialize every JSON response.

## Structure

```
serialization/
├── serializer.ts             # safe serialization utils + response serializer (pick/omit/functional)
└── serializationMiddleware.ts # res.json override middleware + global BigInt setup
```

## Files

### serializer.ts
Provides safe serialization functions that recursively convert BigInt → string, Date → ISO string, and Prisma `@db.Date` (an empty object that holds an internal date) → `YYYY-MM-DD`, together with a response serializer that applies declarative/functional refinement to the router response.

- **Main exports**:
  - Serialization functions: `serializeBigInt(obj)`, `serializeDate(obj)`, `serialize(obj)` (unified — handles BigInt/Date/Prisma-Date all together), `serializePrismaDate(obj)`, `jsonReplacer(key, value)` (JSON.stringify replacer), `safeJsonResponse(data)`
  - Response serializer: type `ResponseSerializer<T>` (a function `(data, req) => shaped`, or `{ pick: [...] }` / `{ omit: [...] }`), `SerializedResult<T, Sz>` (type inference after refinement), `applyResponseSerializer(data, sz, req)` (applies per-element when an array, as-is when a single object; passes through null/primitive values; the functional form allows async)
- **Dependencies**: `@ext/winston` (Debug trace when Prisma-Date `valueOf()` fails), `express` (`Request` type). A leaf module that does not depend on other http sub-tiers.

### serializationMiddleware.ts
An Express middleware that intercepts `res.json` and automatically serializes the body via `serialize()`. On serialization failure it falls back to the original. Additionally provides the global `BigInt.prototype.toJSON` setup.

- **Main exports**:
  - `serializationMiddleware(req, res, next)` — `res.json` override middleware
  - `setupGlobalBigIntSerialization()` — registers `BigInt.prototype.toJSON` once (call at app startup)
  - Global declaration: `BigInt.toJSON()` augmentation
- **Dependencies**: `@ext/winston` (serialization error logging), `@lib/http/serialization/serializer` (`serialize`).

## Import conventions

- Canonical import path: `@lib/http/serialization/<file>` (e.g. `@lib/http/serialization/serializer`).
- **Outbound**: serializationMiddleware → `@lib/http/serialization/serializer` (same tier). serializer itself depends on nothing beyond `@ext/winston` among the core tiers (the innermost leaf).
- **Inbound**: `@lib/http/validation/requestHandler` consumes `ResponseSerializer`/`applyResponseSerializer`, and `@lib/http/routing/expressRouter` consumes `serialize`/`serializeBigInt`/`ResponseSerializer`/`applyResponseSerializer`. `serializationMiddleware` is an opt-in middleware that is not included in the default global policy stack (`defaultGlobalMiddleware()`); when needed, the app registers it directly in `src/app/routes/middleware.ts` or similar.
