# views/ - Server-Side Templates

Folder for server-side rendered view files using the EJS template engine.

## Template Engine

**EJS** (Embedded JavaScript) — `.ejs` extension

## Usage in Routes

```typescript
// EJS rendering in route.ts
res.render('index', {
    FRAMEWORK_URL: 'https://example.com',
    NODE_ENV: process.env.NODE_ENV
});
```

## Conventions

- Primarily used for the development-mode dashboard, landing pages, and similar
- In production, JSON API responses are the norm
- Passing variables: `<%= variableName %>`, conditionals: `<% if (...) { %>`
