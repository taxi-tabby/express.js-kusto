import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';


interface TokenPayload {
    userId: string;
    email: string;
    role?: string;
    iat?: number;
    exp?: number;
}

interface SignInCredentials {
    email: string;
    password: string;
}

interface SignInResult {
    success: boolean;
    user?: {
        id: string;
        email: string;
        role?: string;
    };
    accessToken?: string;
    refreshToken?: string;
    message?: string;
}

interface RefreshResult {
    success: boolean;
    accessToken?: string;
    message?: string;
}

class JWTService {
    private readonly accessTokenSecret: string;
    private readonly refreshTokenSecret: string;
    private readonly accessTokenExpiry: string;
    private readonly refreshTokenExpiry: string;
    private readonly saltRounds: number;

    constructor() {
        // 환경변수에서 설정을 가져오거나 기본값 사용
        this.accessTokenSecret = process.env.JWT_ACCESS_SECRET || 'your-access-token-secret';
        this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET || 'your-refresh-token-secret';
        this.accessTokenExpiry = process.env.JWT_ACCESS_EXPIRY || '15m';
        this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRY || '7d';
        this.saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS || '10');
    }

    /**
     * 비밀번호를 해시화합니다
     */
    async hashPassword(password: string): Promise<string> {
        try {
            return await bcrypt.hash(password, this.saltRounds);
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
            return jwt.sign(payload, this.accessTokenSecret, {
                expiresIn: this.accessTokenExpiry,
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
            return jwt.sign(payload, this.refreshTokenSecret, {
                expiresIn: this.refreshTokenExpiry,
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
    verifyAccessToken(token: string): TokenPayload | null {
        try {
            const decoded = jwt.verify(token, this.accessTokenSecret, {
                issuer: 'kusto-server',
                audience: 'kusto-client'
            } as jwt.VerifyOptions) as TokenPayload;
            return decoded;
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
    verifyRefreshToken(token: string): TokenPayload | null {
        try {
            const decoded = jwt.verify(token, this.refreshTokenSecret, {
                issuer: 'kusto-server',
                audience: 'kusto-client'
            } as jwt.VerifyOptions) as TokenPayload;
            return decoded;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new Error('Refresh Token이 만료되었습니다');
            } else if (error instanceof jwt.JsonWebTokenError) {
                throw new Error('유효하지 않은 Refresh Token입니다');
            }
            throw new Error('Refresh Token 검증 중 오류가 발생했습니다');
        }
    }

    /**
     * 로그인 처리 (실제 사용 시 데이터베이스 연동 필요)
     */
    async signIn(credentials: SignInCredentials): Promise<SignInResult> {
        try {
            const { email, password } = credentials;

            // TODO: 실제 구현에서는 데이터베이스에서 사용자 정보를 조회해야 합니다
            // 예시용 더미 데이터
            const mockUser = {
                id: 'user-123',
                email: email,
                hashedPassword: await this.hashPassword('password123'), // 예시용
                role: 'user'
            };

            // 비밀번호 검증
            const isValidPassword = await this.verifyPassword(password, mockUser.hashedPassword);
            if (!isValidPassword) {
                return {
                    success: false,
                    message: '이메일 또는 비밀번호가 올바르지 않습니다'
                };
            }

            // 토큰 생성
            const tokenPayload = {
                userId: mockUser.id,
                email: mockUser.email,
                role: mockUser.role
            };

            const accessToken = this.generateAccessToken(tokenPayload);
            const refreshToken = this.generateRefreshToken(tokenPayload);

            return {
                success: true,
                user: {
                    id: mockUser.id,
                    email: mockUser.email,
                    role: mockUser.role
                },
                accessToken,
                refreshToken
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : '로그인 중 오류가 발생했습니다'
            };
        }
    }

    /**
     * 토큰 갱신 처리
     */
    async refresh(refreshToken: string): Promise<RefreshResult> {
        try {
            // Refresh Token 검증
            const decoded = this.verifyRefreshToken(refreshToken);
            if (!decoded) {
                return {
                    success: false,
                    message: '유효하지 않은 Refresh Token입니다'
                };
            }

            // 새로운 Access Token 생성
            const newTokenPayload = {
                userId: decoded.userId,
                email: decoded.email,
                role: decoded.role
            };

            const newAccessToken = this.generateAccessToken(newTokenPayload);

            return {
                success: true,
                accessToken: newAccessToken
            };
        } catch (error) {
            return {
                success: false,
                message: error instanceof Error ? error.message : '토큰 갱신 중 오류가 발생했습니다'
            };
        }
    }

    /**
     * Authorization 헤더에서 토큰을 추출합니다
     */
    extractTokenFromHeader(authHeader: string | undefined): string | null {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }
        return authHeader.substring(7); // 'Bearer ' 제거
    }

    /**
     * 토큰의 만료 시간을 확인합니다
     */
    getTokenExpiration(token: string): Date | null {
        try {
            const decoded = jwt.decode(token) as any;
            if (decoded && decoded.exp) {
                return new Date(decoded.exp * 1000);
            }
            return null;
        } catch (error) {
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
    }
}

export default {
    JWTService,
};

export type {
    TokenPayload,
    SignInCredentials,
    SignInResult,
    RefreshResult
}