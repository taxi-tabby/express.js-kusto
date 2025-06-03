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

type AuthSuccessCallback = (user: TokenPayload) => void | Promise<void>;
type AuthFailureCallback = (error: string) => void | Promise<void>;

interface AuthMiddlewareOptions {
    onSuccess?: AuthSuccessCallback;
    onFailure?: AuthFailureCallback;
    extractToken?: (req: any) => string | null;
}

interface UserDbRecord {
    id: string;
    email: string;
    hashedPassword: string;
    role?: string;
    isActive?: boolean;
    [key: string]: any;
}

type UserLookupCallback = (email: string) => Promise<UserDbRecord | null>;
type UserCreateCallback = (userData: {
    email: string;
    hashedPassword: string;
    role?: string;
    [key: string]: any;
}) => Promise<UserDbRecord>;
type UserUpdateCallback = (userId: string, updates: Partial<UserDbRecord>) => Promise<UserDbRecord | null>;

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

    /**
     * 현재 사용자 정보 조회 헬퍼
     */
    getCurrentUser(req: any): TokenPayload | null {
        return req.user || null;
    }

    // === 데이터베이스 콜백 기반 메서드들 ===

    /**
     * 데이터베이스를 통한 로그인 처리 - 콜백 기반
     */
    async handleSignIn(
        credentials: SignInCredentials,
        userLookup: UserLookupCallback,
        onSuccess: (result: SignInResult) =>  Promise<SignInResult>,
        onFailure: (error: string) => Promise<null>
    ): Promise<SignInResult | null> {
        try {
            const { email, password } = credentials;

            // 데이터베이스에서 사용자 조회
            const user = await userLookup(email);
            if (!user) {
                await onFailure('이메일 또는 비밀번호가 올바르지 않습니다');
                return null;
            }

            // 계정 활성화 상태 확인
            if (user.isActive === false) {
                await onFailure('비활성화된 계정입니다');
                return null;
            }

            // 비밀번호 검증
            const isValidPassword = await this.verifyPassword(password, user.hashedPassword);
            if (!isValidPassword) {
                await onFailure('이메일 또는 비밀번호가 올바르지 않습니다');
                return null;
            }

            // 토큰 생성
            const tokenPayload = {
                userId: user.id,
                email: user.email,
                role: user.role
            };

            const accessToken = this.generateAccessToken(tokenPayload);
            const refreshToken = this.generateRefreshToken(tokenPayload);

            const result: SignInResult = {
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    role: user.role
                },
                accessToken,
                refreshToken
            };

            return await onSuccess(result);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '로그인 처리 중 오류가 발생했습니다';
            return await onFailure(errorMessage);
        }
    }

    /**
     * 사용자 등록 처리 - 콜백 기반
     */
    async handleSignUp(
        userData: {
            email: string;
            password: string;
            role?: string;
            [key: string]: any;
        },
        userCreate: UserCreateCallback,
        userLookup: UserLookupCallback,
        onSuccess: (result: { user: UserDbRecord; accessToken: string; refreshToken: string }) => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ): Promise<void> {
        try {
            const { email, password, role, ...additionalData } = userData;

            // 이미 존재하는 사용자인지 확인
            const existingUser = await userLookup(email);
            if (existingUser) {
                await onFailure('이미 등록된 이메일 주소입니다');
                return;
            }

            // 비밀번호 해시화
            const hashedPassword = await this.hashPassword(password);

            // 사용자 생성
            const newUser = await userCreate({
                email,
                hashedPassword,
                role: role || 'user',
                ...additionalData
            });

            // 토큰 생성
            const tokenPayload = {
                userId: newUser.id,
                email: newUser.email,
                role: newUser.role
            };

            const accessToken = this.generateAccessToken(tokenPayload);
            const refreshToken = this.generateRefreshToken(tokenPayload);

            await onSuccess({
                user: newUser,
                accessToken,
                refreshToken
            });

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '사용자 등록 중 오류가 발생했습니다';
            await onFailure(errorMessage);
        }
    }

    /**
     * 토큰 갱신 처리 - 콜백 기반
     */
    async handleRefresh(
        refreshToken: string,
        onSuccess: (accessToken: string) => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ): Promise<void> {
        try {
            // Refresh Token 검증
            const decoded = this.verifyRefreshToken(refreshToken);
            if (!decoded) {
                await onFailure('유효하지 않은 Refresh Token입니다');
                return;
            }

            // 새로운 Access Token 생성
            const newTokenPayload = {
                userId: decoded.userId,
                email: decoded.email,
                role: decoded.role
            };

            const newAccessToken = this.generateAccessToken(newTokenPayload);
            await onSuccess(newAccessToken);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '토큰 갱신 중 오류가 발생했습니다';
            await onFailure(errorMessage);
        }
    }

    /**
     * 비밀번호 변경 처리 - 콜백 기반
     */
    async handleChangePassword(
        userId: string,
        currentPassword: string,
        newPassword: string,
        userLookup: (userId: string) => Promise<UserDbRecord | null>,
        userUpdate: UserUpdateCallback,
        onSuccess: () => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ): Promise<void> {
        try {
            // 사용자 조회
            const user = await userLookup(userId);
            if (!user) {
                await onFailure('사용자를 찾을 수 없습니다');
                return;
            }

            // 현재 비밀번호 검증
            const isValidPassword = await this.verifyPassword(currentPassword, user.hashedPassword);
            if (!isValidPassword) {
                await onFailure('현재 비밀번호가 올바르지 않습니다');
                return;
            }

            // 새 비밀번호 해시화
            const newHashedPassword = await this.hashPassword(newPassword);

            // 비밀번호 업데이트
            await userUpdate(userId, { hashedPassword: newHashedPassword });

            await onSuccess();

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '비밀번호 변경 중 오류가 발생했습니다';
            await onFailure(errorMessage);
        }
    }

    /**
     * 사용자 프로필 업데이트 - 콜백 기반
     */
    async handleUpdateProfile(
        userId: string,
        updates: Partial<Omit<UserDbRecord, 'id' | 'hashedPassword'>>,
        userUpdate: UserUpdateCallback,
        onSuccess: (updatedUser: UserDbRecord) => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ): Promise<void> {
        try {
            const updatedUser = await userUpdate(userId, updates);
            if (!updatedUser) {
                await onFailure('사용자를 찾을 수 없습니다');
                return;
            }

            await onSuccess(updatedUser);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '프로필 업데이트 중 오류가 발생했습니다';
            await onFailure(errorMessage);
        }
    }

    /**
     * 사용자 정보 조회 - 콜백 기반
     */
    async handleGetUser(
        userId: string,
        userLookup: (userId: string) => Promise<UserDbRecord | null>,
        onSuccess: (user: Omit<UserDbRecord, 'hashedPassword'>) => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ): Promise<void> {
        try {
            const user = await userLookup(userId);
            if (!user) {
                await onFailure('사용자를 찾을 수 없습니다');
                return;
            }

            // 비밀번호 해시는 제외하고 반환
            const { hashedPassword, ...userWithoutPassword } = user;
            await onSuccess(userWithoutPassword);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '사용자 정보 조회 중 오류가 발생했습니다';
            await onFailure(errorMessage);
        }
    }

    /**
     * 로그아웃 처리 - 콜백 기반
     */
    async handleLogout(
        token: string,
        onSuccess: () => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ): Promise<void> {
        try {
            // 토큰 검증 (유효한 토큰인지 확인)
            this.verifyAccessToken(token);
            
            // TODO: 실제 구현에서는 토큰을 블랙리스트에 추가하거나
            // 데이터베이스에서 세션을 무효화할 수 있습니다
            
            await onSuccess();
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : '로그아웃 처리 중 오류가 발생했습니다';
            await onFailure(errorMessage);
        }
    }

    // === 미들웨어 메서드들 ===

    /**
     * 인증 미들웨어 - 콜백 기반
     */
    authenticate(options: AuthMiddlewareOptions = {}) {
        return async (req: any, res: any, next: any) => {
            try {
                // 토큰 추출 로직 (사용자 정의 가능)
                const token = options.extractToken 
                    ? options.extractToken(req)
                    : this.extractTokenFromHeader(req.headers.authorization);

                if (!token) {
                    const error = '인증 토큰이 필요합니다';
                    if (options.onFailure) {
                        await options.onFailure(error);
                    }
                    return res.status(401).json({ message: error });
                }

                // 토큰 검증
                const user = this.verifyAccessToken(token);
                if (!user) {
                    const error = '유효하지 않은 토큰입니다';
                    if (options.onFailure) {
                        await options.onFailure(error);
                    }
                    return res.status(403).json({ message: error });
                }

                // 성공 콜백 실행
                if (options.onSuccess) {
                    await options.onSuccess(user);
                }

                // req에 사용자 정보 첨부
                req.user = user;
                next();

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : '인증 오류가 발생했습니다';
                if (options.onFailure) {
                    await options.onFailure(errorMessage);
                }
                return res.status(403).json({ message: errorMessage });
            }
        };
    }

    /**
     * 사용자 권한 검증 헬퍼 - 콜백 기반
     */
    checkRole(
        requiredRole: string | string[],
        onSuccess: (user: TokenPayload) => void | Promise<void>,
        onFailure: (error: string) => void | Promise<void>
    ) {
        return async (req: any, res: any, next: any) => {
            try {
                const user = req.user as TokenPayload;
                
                if (!user) {
                    const error = '인증이 필요합니다';
                    await onFailure(error);
                    return res.status(401).json({ message: error });
                }

                const userRole = user.role;
                const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
                
                if (!userRole || !roles.includes(userRole)) {
                    const error = '권한이 부족합니다';
                    await onFailure(error);
                    return res.status(403).json({ message: error });
                }

                await onSuccess(user);
                next();

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : '권한 검증 오류가 발생했습니다';
                await onFailure(errorMessage);
                return res.status(500).json({ message: errorMessage });
            }
        };
    }

    /**
     * 토큰 자동 갱신 미들웨어
     */
    autoRefresh(options: { minutesBefore?: number; onRefresh?: (newToken: string) => void | Promise<void> } = {}) {
        const { minutesBefore = 5, onRefresh } = options;
        
        return async (req: any, res: any, next: any) => {
            try {
                const token = this.extractTokenFromHeader(req.headers.authorization);
                
                if (token && this.isTokenExpiringSoon(token, minutesBefore)) {
                    // 토큰이 곧 만료되는 경우
                    const user = this.verifyAccessToken(token);
                    if (user) {
                        const newToken = this.generateAccessToken({
                            userId: user.userId,
                            email: user.email,
                            role: user.role
                        });
                        
                        // 새 토큰을 응답 헤더에 추가
                        res.setHeader('X-New-Token', newToken);
                        
                        if (onRefresh) {
                            await onRefresh(newToken);
                        }
                    }
                }
                
                next();
            } catch (error) {
                // 토큰 갱신 실패해도 요청은 계속 진행
                next();
            }
        };
    }
}

export default JWTService;
