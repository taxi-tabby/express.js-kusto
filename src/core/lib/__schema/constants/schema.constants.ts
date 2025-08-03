export const SCHEMA_CONSTANTS = {
  METADATA_KEYS: {
    CRUD_OPTIONS: '__crud_options__',
    CRUD: '__crud__',
    CRUD_ALT: 'crud_options',
    CRUD_UPPER: 'CRUD_OPTIONS',
    CONTROLLER_PATH: 'path',
    CONTROLLER_PATH_ALT: '__controller_path__',
  },

  DEFAULT_CRUD_METHODS: ['index', 'show', 'create', 'update', 'destroy'],

  JS_TYPE_MAPPING: {
    varchar: 'string',
    text: 'string',
    char: 'string',
    int: 'number',
    integer: 'number',
    bigint: 'number',
    decimal: 'number',
    float: 'number',
    double: 'number',
    boolean: 'boolean',
    date: 'Date',
    datetime: 'Date',
    timestamp: 'Date',
    json: 'object',
    enum: 'enum',
  },

  ENDPOINT_TEMPLATES: {
    INDEX: 'GET /{basePath}',
    SHOW: 'GET /{basePath}/:id',
    CREATE: 'POST /{basePath}',
    UPDATE: 'PUT /{basePath}/:id',
    DESTROY: 'DELETE /{basePath}/:id',
    UPSERT: 'POST /{basePath}/upsert',
    RECOVER: 'POST /{basePath}/:id/recover',
  },
} as const;

export const SECURITY_CONSTANTS = {
  ALLOWED_IPS: ['127.0.0.1', '::1', 'localhost'],

  DEVELOPMENT_ENVIRONMENTS: ['development', 'dev'],

  ERROR_MESSAGES: {
    SCHEMA_API_DISABLED: '이 API는 개발 환경에서만 사용할 수 있습니다.',
    IP_ACCESS_DENIED: '스키마 API는 로컬호스트에서만 접근 가능합니다.',
    NO_CRUD_CONTROLLER: 'No CRUD controller found for entity',
  },

  ERROR_CODES: {
    SCHEMA_API_DISABLED: 'Schema API Disabled',
    IP_ACCESS_DENIED: 'IP Access Denied',
  },

  HINTS: {
    ENABLE_API: 'ENABLE_SCHEMA_API=true 환경변수를 설정하거나 NODE_ENV=development로 설정하세요.',
    USE_LOCALHOST: 'localhost에서 접근하거나 ENABLE_SCHEMA_API=true로 설정하세요.',
  },
} as const; 