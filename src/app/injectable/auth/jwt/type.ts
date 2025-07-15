
// === Core Interfaces ===

export interface JWTConfig {
    accessTokenSecret: string;
    refreshTokenSecret: string;
    accessTokenExpiry: string;
    refreshTokenExpiry: string;
    saltRounds: number;
}

export interface TokenPayload {
    uuid: string;
    email: string;
    role?: string[];
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

export interface UserBase {
    uuid: string;
    email: string;
    username: string | null;
    passwordHash: string;
    isActive: boolean;
    isVerified: boolean;
    isSuspended: boolean;
    createdAt: Date;
}


export interface AdminBase {
    uuid: string;
    email: string;
    username: string | null;
    passwordHash: string;
    isActive: boolean;
    isSuspended: boolean;
    createdAt: Date;
}


// export interface RepositoryAction {
//     findByEmail: (username: string) => Promise<any | null>;
//     findWithRoles: (uuid: string) => Promise<any | null>;
// }