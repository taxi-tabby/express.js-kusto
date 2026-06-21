import { RequestHandler as CustomRequestHandler } from '@lib/http/validation/requestHandler';
import { DependencyInjector } from '@lib/data/di/dependencyInjector';

beforeAll(() => {
    // 핸들러 실행 시 getInjectedModules() 가 throw 하지 않도록 DI 선초기화
    const di = DependencyInjector.getInstance() as any;
    di.initialized = true;
    di.modules = {};
});

function mockRes() {
    return {
        headersSent: false,
        statusCode: 200,
        status(c: number) {
            this.statusCode = c;
            return this;
        },
        json(b: any) {
            (this as any).body = b;
            this.headersSent = true;
            return this;
        },
        body: undefined as any,
    };
}

describe('createHandler serialize 배선', () => {
    it('config.serialize 가 sendSuccess 이전에 적용되어 envelope.data 가 정제된다', async () => {
        const config = { serialize: { omit: ['secret'] } } as any; // response 없음 → 필터/strict 미적용
        const handler = async () => ({ id: 1, secret: 'x', name: 'a' });
        const mws = CustomRequestHandler.createHandler(config, handler);
        const last = mws[mws.length - 1];
        const res = mockRes();
        await last({} as any, res as any, (() => {}) as any);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toEqual({ id: 1, name: 'a' });
        expect(res.body.data.secret).toBeUndefined();
    });

    it('config.serialize 가 없으면 결과를 그대로 envelope 에 담는다 (회귀)', async () => {
        const config = {} as any;
        const handler = async () => ({ id: 1, secret: 'x' });
        const mws = CustomRequestHandler.createHandler(config, handler);
        const last = mws[mws.length - 1];
        const res = mockRes();
        await last({} as any, res as any, (() => {}) as any);
        expect(res.body.data).toEqual({ id: 1, secret: 'x' });
    });
});
