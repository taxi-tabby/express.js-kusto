import { isLocalRequest } from '@core/lib/devtools/monitor/monitorSetup';

/**
 * 보안 회귀: /__kusto/metrics 의 루프백 게이트는 req.ip(프록시 헤더 파생)가 아니라
 * 실제 TCP 피어 주소(req.socket.remoteAddress)만 봐야 한다.
 * trust proxy 가 켜지면 req.ip 는 X-Forwarded-For 로 위조될 수 있기 때문이다.
 */
const fakeReq = (socketIp: string, spoofedReqIp?: string) =>
    ({ ip: spoofedReqIp, socket: { remoteAddress: socketIp } } as any);

describe('monitor isLocalRequest — 루프백 게이트(XFF 우회 방어)', () => {
    it('루프백 소켓은 허용', () => {
        expect(isLocalRequest(fakeReq('127.0.0.1'))).toBe(true);
        expect(isLocalRequest(fakeReq('::1'))).toBe(true);
        expect(isLocalRequest(fakeReq('::ffff:127.0.0.1'))).toBe(true);
    });

    it('원격 소켓은 req.ip 가 127.0.0.1 로 위조돼도 거부한다(XFF 우회 차단)', () => {
        expect(isLocalRequest(fakeReq('10.0.0.5', '127.0.0.1'))).toBe(false);
        expect(isLocalRequest(fakeReq('203.0.113.9', '127.0.0.1'))).toBe(false);
    });

    it('substring 통과를 막는다(정확 비교)', () => {
        expect(isLocalRequest(fakeReq('evil127.0.0.1'))).toBe(false);
        expect(isLocalRequest(fakeReq('0:0:0:0:0:ffff:127.0.0.1'))).toBe(false);
    });

    it('소켓 주소가 없으면 거부', () => {
        expect(isLocalRequest({ socket: {} } as any)).toBe(false);
    });
});
