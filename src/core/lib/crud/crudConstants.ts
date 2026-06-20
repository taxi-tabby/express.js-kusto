/**
 * CRUD 엔진 기본값/액션 어휘 단일 출처 (SSOT).
 *
 * 과거 'id'(기본키) / 'deletedAt'(소프트삭제 필드) / 10(기본 페이지 크기) 기본값과
 * CRUD 액션 목록이 crudRouteBuilder / crudHelpers / crudSchemaTypes / crudSchemaRegistry 에
 * 흩어져 하드코딩돼 있었다. 프레임워크 기본값을 한 곳에서 바꿀 수 있도록 모은다.
 */

/** CRUD :id 파라미터의 기본 기본키 이름 */
export const DEFAULT_PRIMARY_KEY = 'id';

/** 소프트 삭제 타임스탬프 컬럼의 기본 필드명 */
export const DEFAULT_SOFT_DELETE_FIELD = 'deletedAt';

/** index 페이지네이션 기본 페이지 크기 */
export const DEFAULT_PAGE_SIZE = 10;

/** 기본 CRUD 액션 (recover 제외) */
export const CRUD_ACTIONS: readonly string[] = ['index', 'show', 'create', 'update', 'destroy'];

/** recover 포함 전체 CRUD 액션 (soft-delete 활성 시 라우트 생성 대상) */
export const CRUD_ACTIONS_WITH_RECOVER: readonly string[] = [...CRUD_ACTIONS, 'recover'];
