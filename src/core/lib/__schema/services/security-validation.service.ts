import { Injectable } from '@nestjs/common';
import { SECURITY_CONSTANTS } from '../constants/schema.constants';
import { SecurityValidationResult } from '../types/schema.types';

@Injectable()
export class SecurityValidationService {

  /**
   * 스키마 API 접근 권한을 종합적으로 검증합니다.
   */
  validateSchemaAccess(clientIP: string): SecurityValidationResult {
    const environmentCheck = this.checkEnvironment();
    if (!environmentCheck.isAllowed) {
      return environmentCheck;
    }

    const ipCheck = this.checkIPAccess(clientIP);
    if (!ipCheck.isAllowed) {
      return { ...ipCheck, clientIP };
    }

    return { isAllowed: true };
  }

  /**
   * 환경 변수를 확인하여 접근 허용 여부를 판단합니다.
   */
  private checkEnvironment(): SecurityValidationResult {
    const isSchemaEnabled = this.isSchemaAPIEnabled();
    const isDevelopment = this.isDevelopmentEnvironment();

    if (!isSchemaEnabled && !isDevelopment) {
      return {
        isAllowed: false,
        errorMessage: SECURITY_CONSTANTS.ERROR_MESSAGES.SCHEMA_API_DISABLED,
        errorCode: SECURITY_CONSTANTS.ERROR_CODES.SCHEMA_API_DISABLED,
        hint: SECURITY_CONSTANTS.HINTS.ENABLE_API,
      };
    }

    return { isAllowed: true };
  }

  /**
   * IP 주소를 확인하여 접근 허용 여부를 판단합니다.
   */
  private checkIPAccess(clientIP: string): SecurityValidationResult {
    const isDevelopment = this.isDevelopmentEnvironment();
    const isSchemaEnabled = this.isSchemaAPIEnabled();
    const isLocalhost = this.isLocalhostIP(clientIP);

    // 개발 환경에서 로컬호스트가 아니고, 스키마 API가 명시적으로 활성화되지 않은 경우
    if (isDevelopment && !isLocalhost && !isSchemaEnabled) {
      return {
        isAllowed: false,
        errorMessage: SECURITY_CONSTANTS.ERROR_MESSAGES.IP_ACCESS_DENIED,
        errorCode: SECURITY_CONSTANTS.ERROR_CODES.IP_ACCESS_DENIED,
        hint: SECURITY_CONSTANTS.HINTS.USE_LOCALHOST,
      };
    }

    return { isAllowed: true };
  }

  /**
   * 스키마 API가 명시적으로 활성화되었는지 확인합니다.
   */
  private isSchemaAPIEnabled(): boolean {
    return process.env.ENABLE_SCHEMA_API === 'true';
  }

  /**
   * 현재 환경이 개발 환경인지 확인합니다.
   */
  private isDevelopmentEnvironment(): boolean {
    const nodeEnv = process.env.NODE_ENV;
    return (
      (SECURITY_CONSTANTS.DEVELOPMENT_ENVIRONMENTS as readonly string[]).includes(nodeEnv || '') ||
      !nodeEnv
    );
  }

  /**
   * 주어진 IP가 로컬호스트인지 확인합니다.
   */
  private isLocalhostIP(clientIP: string): boolean {
    if (!clientIP) return false;

    return SECURITY_CONSTANTS.ALLOWED_IPS.some(ip =>
      clientIP.includes(ip)
    );
  }

  /**
   * 현재 환경 정보를 반환합니다. (디버깅용)
   */
  getEnvironmentInfo() {
    return {
      nodeEnv: process.env.NODE_ENV,
      schemaAPIEnabled: this.isSchemaAPIEnabled(),
      isDevelopment: this.isDevelopmentEnvironment(),
      allowedIPs: SECURITY_CONSTANTS.ALLOWED_IPS,
    };
  }
} 