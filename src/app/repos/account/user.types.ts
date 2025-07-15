// User Repository Types
export interface UserBase {
    id: bigint;
    uuid: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    username: string;
    isActive: boolean;
    isVerified: boolean;
    isSuspended: boolean;
    createdAt: Date;
    passwordHash: string;
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
    username: string;
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
    username: string;
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

// Rate Limit 관련 타입들
export interface RateLimitInfo {
    adminUuid?: string;
    ipAddress: string;
    endpoint: string;
    method: string;
    windowStart: Date;
    requestCount?: number;
    isBlocked?: boolean;
    blockUntil?: Date;
}

export interface RateLimitCreateUpdateData {
    adminUuid?: string;
    ipAddress: string;
    endpoint: string;
    method: string;
    windowStart: Date;
    windowEnd: Date;
    requestCount: number;
    isBlocked?: boolean;
    blockUntil?: Date;
}

export interface RateLimitResult {
    requestCount: number;
    isBlocked: boolean;
}

// User Audit Log 관련 타입들
export interface UserAuditLogData {
    userUuid?: string;
    action: string; // AuditAction enum value
    resource?: string;
    resourceId?: string;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
    userAgent?: string;
    metadata?: any;
}

export interface UserAuditLogBase {
    id: bigint;
    uuid: string;
    userUuid: string | null;
    action: string;
    resource: string | null;
    resourceId: string | null;
    oldValues: any;
    newValues: any;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: any;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
}

export interface UserAuditLogFilters {
    userUuid?: string;
    action?: string;
    resource?: string;
    ipAddress?: string;
    dateFrom?: Date;
    dateTo?: Date;
}

export interface UserAuditLogWithUser extends UserAuditLogBase {
    user?: {
        uuid: string;
        email: string;
        firstName: string | null;
        lastName: string | null;
        username: string;
    } | null;
}