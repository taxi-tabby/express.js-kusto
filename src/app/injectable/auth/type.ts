export interface TokenPayload {
    userId: string;
    email: string;
    role?: string;
    iat?: number;
    exp?: number;
}

export interface SignInCredentials {
    email: string;
    password: string;
}

export interface SignInResult {
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

export type AuthSuccessCallback = (user: TokenPayload) => void | Promise<void>;
export type AuthFailureCallback = (error: string) => void | Promise<void>;

export interface AuthMiddlewareOptions {
    onSuccess?: AuthSuccessCallback;
    onFailure?: AuthFailureCallback;
    extractToken?: (req: any) => string | null;
}

export interface UserDbRecord {
    id: string;
    email: string;
    hashedPassword: string;
    role?: string;
    isActive?: boolean;
    [key: string]: any;
}

export type UserLookupCallback = (email: string) => Promise<UserDbRecord | null>;
export type UserCreateCallback = (userData: {
    email: string;
    hashedPassword: string;
    role?: string;
    [key: string]: any;
}) => Promise<UserDbRecord>;

export type UserUpdateCallback = (userId: string, updates: Partial<UserDbRecord>) => Promise<UserDbRecord | null>;
