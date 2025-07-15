import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';
import { TokenPayload, SignInCredentials, SignInResult, UserDbRecord, UserLookupCallback } from './type';

interface JWTConfig {
    accessTokenSecret: string;
    refreshTokenSecret: string;
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
    saltRounds: number;
}

export default class JWTService {
    private readonly config: JWTConfig;

    constructor() {
        this.config = {
            accessTokenSecret: process.env.JWT_ACCESS_SECRET || 'your-access-token-secret',
            refreshTokenSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-token-secret',
            accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
            refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
            saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '10')
        };
    }

    // === Core Password & Token Management ===

    /**
     * 비밀번호를 해시화합니다
     */
    async hashPassword(password: string): Promise<string> {
        try {
            return await bcrypt.hash(password, this.config.saltRounds);
        } catch (error) {
            throw new Error('비밀번호 해시 생성 중 오류가 발생했습니다');
        }
    }

    /**
     * 비밀번호를 검증합니다
     */
    async verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
        try {
            return await bcrypt.compare(password, hashedPassword);
        } catch (error) {
            throw new Error('비밀번호 검증 중 오류가 발생했습니다');
        }
    }    
    
    
    /**
     * Access Token을 생성합니다
     */
    generateAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
        try {
            return jwt.sign(payload, this.config.accessTokenSecret, {
                expiresIn: this.config.accessTokenExpiry,
                issuer: 'kusto-server',
                audience: 'kusto-client'
            } as jwt.SignOptions);
        } catch (error) {
            throw new Error('Access Token 생성 중 오류가 발생했습니다');
        }
    }

    /**
     * Refresh Token을 생성합니다
     */
    generateRefreshToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
        try {
            return jwt.sign(payload, this.config.refreshTokenSecret, {
                expiresIn: this.config.refreshTokenExpiry,
                issuer: 'kusto-server',
                audience: 'kusto-client'
            } as jwt.SignOptions);
        } catch (error) {
            throw new Error('Refresh Token 생성 중 오류가 발생했습니다');
        }
    }    
    
    /**
     * Access Token을 검증합니다
     */
    verifyAccessToken(token: string): TokenPayload {
        try {
            return jwt.verify(token, this.config.accessTokenSecret, {
                issuer: 'kusto-server',
                audience: 'kusto-client'
            } as jwt.VerifyOptions) as TokenPayload;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new Error('Access Token이 만료되었습니다');
            } else if (error instanceof jwt.JsonWebTokenError) {
                throw new Error('유효하지 않은 Access Token입니다');
            }
            throw new Error('Access Token 검증 중 오류가 발생했습니다');
        }
    }

    /**
     * Refresh Token을 검증합니다
     */
    verifyRefreshToken(token: string): TokenPayload {
        try {
            return jwt.verify(token, this.config.refreshTokenSecret, {
                issuer: 'kusto-server',
                audience: 'kusto-client'
            } as jwt.VerifyOptions) as TokenPayload;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new Error('Refresh Token이 만료되었습니다');
            } else if (error instanceof jwt.JsonWebTokenError) {
                throw new Error('유효하지 않은 Refresh Token입니다');
            }
            throw new Error('Refresh Token 검증 중 오류가 발생했습니다');
        }
    }

    // === Utility Methods ===

    /**
     * Authorization 헤더에서 토큰을 추출합니다
     */
    extractTokenFromHeader(authHeader: string | undefined): string | null {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.substring(7);
    }

    /**
     * 토큰의 만료 시간을 확인합니다
     */
    getTokenExpiration(token: string): Date | null {
        try {
            const decoded = jwt.decode(token) as any;
            if (decoded?.exp) {
                return new Date(decoded.exp * 1000);
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * 토큰이 곧 만료되는지 확인합니다 (기본: 5분 전)
     */
    isTokenExpiringSoon(token: string, minutesBefore: number = 5): boolean {
        const expiration = this.getTokenExpiration(token);
        if (!expiration) return true;

        const now = new Date();
        const timeUntilExpiry = expiration.getTime() - now.getTime();
        const millisecondsBeforeExpiry = minutesBefore * 60 * 1000;

        return timeUntilExpiry <= millisecondsBeforeExpiry;
    }    // === Authentication Business Logic ===

    /**
     * 토큰 갱신 처리
     */
    async refreshToken(refreshToken: string): Promise<string> {
        const decoded = this.verifyRefreshToken(refreshToken);
        
        const newTokenPayload = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role
        };

        return this.generateAccessToken(newTokenPayload);
    }
}


