import { ERROR_CODES, getHttpStatusForErrorCode } from '@lib/errorCodes';

describe('getHttpStatusForErrorCode — 게이트웨이 코드', () => {
  it('BAD_GATEWAY → 502', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.BAD_GATEWAY)).toBe(502);
  });
  it('GATEWAY_TIMEOUT → 504', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.GATEWAY_TIMEOUT)).toBe(504);
  });
  it('SERVICE_UNAVAILABLE → 503', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.SERVICE_UNAVAILABLE)).toBe(503);
  });
  it('CONNECTION_TIMEOUT → 504', () => {
    expect(getHttpStatusForErrorCode(ERROR_CODES.CONNECTION_TIMEOUT)).toBe(504);
  });
});
