// User repository type definitions
// Mix of Prisma dependencies and custom business logic types

// ========== Import Prisma Types ==========
// Use Prisma generated types for database operations
import { Prisma, User, UserSession } from '@app/db/user/client';

// Re-export commonly used Prisma model types
export type {
    User,
    UserSession,
    UserRefreshToken,
    UserRole,
    Role,
    Permission,
    UserPermission,
    RolePermission
} from '@app/db/user/client';

// Re-export Prisma input types for CRUD operations
export type UserCreateInput = Prisma.UserCreateInput;
export type UserUpdateInput = Prisma.UserUpdateInput;
export type UserWhereInput = Prisma.UserWhereInput;
export type UserWhereUniqueInput = Prisma.UserWhereUniqueInput;
export type UserInclude = Prisma.UserInclude;

// ========== Custom Business Logic Types ==========
// Types for API inputs, business operations, and complex queries

/**
 * Session creation parameters for repository methods
 */
export interface SessionCreateInput {
    userId: bigint | number;
    tokenHash: string;
    deviceInfo?: string;
    ipAddress?: string;
    location?: string;
    expiresAt: Date;
}

/**
 * Parameters for finding users with pagination and filtering
 */
export interface FindUsersParams {
    where?: UserWhereInput;
    include?: UserInclude;
    skip?: number;
    take?: number;
    orderBy?: Prisma.UserOrderByWithRelationInput | Prisma.UserOrderByWithRelationInput[];
}

/**
 * Parameters for assigning roles to users
 */
export interface UserRoleAssignInput {
    userId: bigint | number;
    roleId: bigint | number;
    assignedBy?: bigint | number;
    expiresAt?: Date;
}

/**
 * Parameters for granting permissions to users
 */
export interface UserPermissionGrantInput {
    userId: bigint | number;
    permissionId: bigint | number;
    grantedBy?: bigint | number;
    expiresAt?: Date;
}

/**
 * User registration input from API
 */
export interface UserRegistrationInput {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
}

/**
 * User login input from API
 */
export interface UserLoginInput {
    identifier: string; // username or email
    password: string;
    deviceInfo?: string;
    ipAddress?: string;
    location?: string;
}

/**
 * Password change input
 */
export interface PasswordChangeInput {
    currentPassword: string;
    newPassword: string;
}

/**
 * Password reset input
 */
export interface PasswordResetInput {
    token: string;
    newPassword: string;
}

/**
 * Email verification input
 */
export interface EmailVerificationInput {
    token: string;
}

/**
 * User profile update input (different from UserUpdateInput)
 */
export interface UserProfileUpdateInput {
    firstName?: string;
    lastName?: string;
    username?: string;
    email?: string;
}

/**
 * Session filter options
 */
export interface SessionFilterOptions {
    userId?: bigint | number;
    isActive?: boolean;
    deviceInfo?: string;
    ipAddress?: string;
    expiresAfter?: Date;
    expiresBefore?: Date;
}

/**
 * Authentication result
 */
export interface AuthenticationResult {
    success: boolean;
    user?: User;
    session?: UserSession;
    error?: string;
    requiresTwoFactor?: boolean;
    isLocked?: boolean;
    lockoutUntil?: Date;
}

/**
 * User search filters
 */
export interface UserSearchFilters {
    query?: string; // search in name, username, email
    isActive?: boolean;
    isVerified?: boolean;
    roleIds?: bigint[];
    createdAfter?: Date;
    createdBefore?: Date;
    lastLoginAfter?: Date;
    lastLoginBefore?: Date;
}

/**
 * Pagination result wrapper
 */
export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}

/**
 * User with computed fields for API responses
 */
export interface UserWithComputedFields extends User {
    fullName?: string;
    roleNames?: string[];
    permissionNames?: string[];
    isSessionActive?: boolean;
    daysSinceLastLogin?: number;
}
