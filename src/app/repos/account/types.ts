// User Repository Types
export interface UserBase {
    id: bigint;
    uuid: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    isActive: boolean;
    isVerified: boolean;
    isSuspended: boolean;
    createdAt: Date;
}

export interface UserAuth {
    id: bigint;
    uuid: string;
    email: string;
    passwordHash: string;
    isActive: boolean;
    isVerified: boolean;
    isSuspended: boolean;
    loginAttempts: number;
    lockoutUntil: Date | null;
    twoFactorEnabled: boolean;
    twoFactorSecret: string | null;
}

export interface UserProfile {
    uuid: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    profileImage: string | null;
    timezone: string | null;
    locale: string | null;
    isVerified: boolean;
    createdAt: Date;
}

export interface UserCreateData {
    email: string;
    passwordHash: string;
    firstName?: string;
    lastName?: string;
    username?: string;
    phoneNumber?: string;
    createdBy?: bigint;
}

export interface UserUpdateData {
    firstName?: string;
    lastName?: string;
    username?: string;
    phoneNumber?: string;
    profileImage?: string;
    timezone?: string;
    locale?: string;
    isActive?: boolean;
    isVerified?: boolean;
    isSuspended?: boolean;
    updatedBy?: bigint;
}

export interface UserProfileUpdateData {
    firstName?: string;
    lastName?: string;
    profileImage?: string;
    timezone?: string;
    locale?: string;
}

export interface UserFilters {
    isActive?: boolean;
    isVerified?: boolean;
}

export interface BulkUpdateData {
    isActive?: boolean;
    isVerified?: boolean;
}