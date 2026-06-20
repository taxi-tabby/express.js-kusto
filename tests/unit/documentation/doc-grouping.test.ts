import { buildOpenApiDocument, deriveResourceTag, deriveOperationId } from '@lib/documentation';

const baseInput = (routes: any[], tagDescriptions?: Record<string, string>) => ({
  routes,
  schemas: {},
  env: { NODE_ENV: 'development' } as NodeJS.ProcessEnv,
  packageJson: { name: 'x', version: '1.0.0' },
  ...(tagDescriptions ? { tagDescriptions } : {}),
});

describe('deriveResourceTag — 경로 → 그룹 태그', () => {
  it.each([
    ['/users', 'Users'],
    ['/users/:id', 'Users'],
    ['/users/:id/posts', 'Posts'],
    ['/order-items', 'Order Items'],
    ['/', 'Default'],
    ['/api/schema', 'Schema'],
    // 정규식 파라미터 캡처그룹은 무시(세그먼트 오분할 방지)
    ['/api/:version([^/]+)/things', 'Things'],
    // 와일드카드 세그먼트는 동적 처리(태그에 '*' 누출 금지)
    ['/files/*', 'Files'],
    ['/items*', 'Default'],
  ])('%s → %s', (path, tag) => {
    expect(deriveResourceTag(path)).toBe(tag);
  });
});

describe('deriveOperationId — 메서드+경로 → operationId', () => {
  it.each([
    ['GET', '/users', 'getUsers'],
    ['GET', '/users/:id', 'getUsersById'],
    ['POST', '/users/:id/posts', 'postUsersByIdPosts'],
    ['GET', '/', 'getRoot'],
    // 정규식 파라미터: 캡처그룹 무시, 파라미터명만 사용
    ['GET', '/api/:version([^/]+)/things', 'getApiByVersionThings'],
  ])('%s %s → %s', (method, path, id) => {
    expect(deriveOperationId(method, path)).toBe(id);
  });

  it('operationId 가 깨진 정규식 토큰(]+) 등)을 포함하지 않음', () => {
    expect(deriveOperationId('GET', '/api/:version([^/]+)/things')).not.toMatch(/[()\][*]/);
  });
});

describe('buildOpenApiDocument — 자동 그룹화/operationId/응답설명/문서태그', () => {
  it('태그 미지정 시 경로에서 파생하고 문서 레벨 tags[] 를 수집', () => {
    const doc = buildOpenApiDocument(baseInput([
      { method: 'GET', path: '/users' },
      { method: 'POST', path: '/users' },
      { method: 'GET', path: '/users/:id/posts' },
    ]));
    expect(doc.paths['/users'].get!.tags).toEqual(['Users']);
    expect(doc.paths['/users'].post!.tags).toEqual(['Users']);
    expect(doc.paths['/users/{id}/posts'].get!.tags).toEqual(['Posts']);
    expect(doc.tags!.map((t) => t.name)).toEqual(['Posts', 'Users']);
  });

  it('operationId 를 자동 생성', () => {
    const doc = buildOpenApiDocument(baseInput([{ method: 'GET', path: '/users/:id' }]));
    expect(doc.paths['/users/{id}'].get!.operationId).toBe('getUsersById');
  });

  it('명시 태그 우선 + tagDescriptions 가 문서 tags 에 반영', () => {
    const doc = buildOpenApiDocument(baseInput(
      [{ method: 'GET', path: '/users', tags: ['Accounts'] }],
      { Accounts: 'User accounts' },
    ));
    expect(doc.paths['/users'].get!.tags).toEqual(['Accounts']);
    expect(doc.tags).toEqual([{ name: 'Accounts', description: 'User accounts' }]);
  });

  it('표준 응답 설명(reason phrase)', () => {
    const doc = buildOpenApiDocument(baseInput([
      { method: 'POST', path: '/users', responses: { 201: { type: 'object' }, 422: { type: 'object' } } },
    ]));
    const op = doc.paths['/users'].post!;
    expect(op.responses['201'].description).toBe('Created');
    expect(op.responses['422'].description).toBe('Unprocessable Entity');
  });

  it('deprecated 플래그 반영', () => {
    const doc = buildOpenApiDocument(baseInput([{ method: 'GET', path: '/old', deprecated: true }]));
    expect(doc.paths['/old'].get!.deprecated).toBe(true);
  });

  it('중복 operationId 를 _2 로 유일화 (OpenAPI 유일성)', () => {
    // '/a-b' 와 '/a/b' 는 서로 다른 경로지만 둘 다 'getAB' 로 파생 → 충돌
    const doc = buildOpenApiDocument(baseInput([
      { method: 'GET', path: '/a-b' },
      { method: 'GET', path: '/a/b' },
    ]));
    const ids = [doc.paths['/a-b'].get!.operationId, doc.paths['/a/b'].get!.operationId];
    expect(new Set(ids).size).toBe(2); // 유일
    expect(ids).toEqual(expect.arrayContaining(['getAB', 'getAB_2']));
  });
});
