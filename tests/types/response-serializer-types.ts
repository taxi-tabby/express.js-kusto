import { ExpressRouter } from '@lib/http/routing/expressRouter';
import type { SerializedResult } from '@lib/http/serialization/serializer';

// 타입 동등성 헬퍼
type Equal<X, Y> =
    (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// SerializedResult: omit/pick/함수/배열
type _Omit = Expect<
    Equal<SerializedResult<{ id: number; p: string }, { omit: ['p'] }>, { id: number }>
>;
type _Pick = Expect<
    Equal<SerializedResult<{ id: number; p: string }, { pick: ['id'] }>, { id: number }>
>;
type _Fn = Expect<
    Equal<SerializedResult<{ id: number }, (d: { id: number }) => { x: 1 }>, { x: 1 }>
>;
type _ArrOmit = Expect<
    Equal<SerializedResult<{ id: number; p: string }[], { omit: ['p'] }>, { id: number }[]>
>;

// 호출부 추론 (런타임 실행 안 함 — 타입 검증 전용)
function _callSiteTypeChecks() {
    const r = new ExpressRouter();

    // 함수형: data 가 핸들러 반환 타입으로 좁혀진다
    r.GET(async () => ({ id: 1, password: 'x' }), {
        serialize: (u) => {
            type _ = Expect<Equal<typeof u, { id: number; password: string }>>;
            return { id: u.id };
        },
    });

    // pick/omit 키는 반환 타입의 키로 제한 — 잘못된 키는 컴파일 에러
    // @ts-expect-error 'nope' 는 반환 타입의 키가 아니다
    r.GET(async () => ({ id: 1 }), { serialize: { pick: ['nope'] } });

    // VALIDATED 도 동일하게 추론
    r.GET_VALIDATED({}, { 200: {} }, async () => ({ id: 1, secret: 's' }), {
        serialize: (u) => {
            type _ = Expect<Equal<typeof u, { id: number; secret: string }>>;
            return { id: u.id };
        },
    });

    // VALIDATED 메서드도 잘못된 키를 컴파일 에러로 잡는다
    // @ts-expect-error 'nope' 는 반환 타입의 키가 아니다 (VALIDATED 도 키 제약)
    r.POST_VALIDATED({}, { 200: {} }, async () => ({ id: 1 }), { serialize: { omit: ['nope'] } });

    // 회귀: serialize 없이 기존 시그니처(직접 res.json) 그대로 컴파일된다
    r.GET((req, res) => {
        res.json({ ok: true });
    });
}

void _callSiteTypeChecks;
