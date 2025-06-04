import { log } from '@core/external/winston';
import { BaseRepository } from '@core/lib/baseRepository';
import {
    User,
    UserSession,
    UserRole,
    UserCreateInput,
    UserUpdateInput,
    UserWhereInput,
    UserWhereUniqueInput,
    UserInclude,
} from './types';

/**
 * User repository for handling user-related database operations
 */
export class UserRepository extends BaseRepository {
    
    /**
     * Get user database client
     */
    private getUserDb() {
        return this.db.getWrap('user');
    }

    /**
     * Create a new user
     */
    async createUser(userData: UserCreateInput): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.create({
                data: userData,
                include: {
                    roles: {
                        include: {
                            role: true
                        }
                    }
                }
            });
            
            log.Info('User created successfully', { userId: user.id, email: user.email });
            return user;
        } catch (error) {
            log.Error('Failed to create user', { error, userData: { email: userData.email } });
            throw new Error(`Failed to create user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find user by ID
     */
    async findById(id: bigint | number, include?: UserInclude): Promise<User | null> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.findUnique({
                where: { id: typeof id === 'bigint' ? id : BigInt(id) },
                include: include || {
                    roles: {
                        include: {
                            role: true
                        }
                    },
                    sessions: true,
                    permissions: {
                        include: {
                            permission: true
                        }
                    }
                }
            });
            
            return user;
        } catch (error) {
            log.Error('Failed to find user by ID', { error, id });
            throw new Error(`Failed to find user by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find user by UUID
     */
    async findByUuid(uuid: string, include?: UserInclude): Promise<User | null> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.findUnique({
                where: { uuid },
                include: include || {
                    roles: {
                        include: {
                            role: true
                        }
                    },
                    sessions: true,
                    permissions: {
                        include: {
                            permission: true
                        }
                    }
                }
            });
            
            return user;
        } catch (error) {
            log.Error('Failed to find user by UUID', { error, uuid });
            throw new Error(`Failed to find user by UUID: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find user by email
     */
    async findByEmail(email: string, include?: UserInclude): Promise<User | null> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.findUnique({
                where: { email },
                include: include || {
                    roles: {
                        include: {
                            role: true
                        }
                    },
                    sessions: true,
                    permissions: {
                        include: {
                            permission: true
                        }
                    }
                }
            });
            
            return user;
        } catch (error) {
            log.Error('Failed to find user by email', { error, email });
            throw new Error(`Failed to find user by email: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find user by username
     */
    async findByUsername(username: string, include?: UserInclude): Promise<User | null> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.findUnique({
                where: { username },
                include: include || {
                    roles: {
                        include: {
                            role: true
                        }
                    },
                    sessions: true,
                    permissions: {
                        include: {
                            permission: true
                        }
                    }
                }
            });
            
            return user;
        } catch (error) {
            log.Error('Failed to find user by username', { error, username });
            throw new Error(`Failed to find user by username: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update user
     */
    async updateUser(where: UserWhereUniqueInput, data: UserUpdateInput): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where,
                data,
                include: {
                    roles: {
                        include: {
                            role: true
                        }
                    },
                    sessions: true,
                    permissions: {
                        include: {
                            permission: true
                        }
                    }
                }
            });
            
            log.Info('User updated successfully', { userId: user.id, email: user.email });
            return user;
        } catch (error) {
            log.Error('Failed to update user', { error, where });
            throw new Error(`Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Delete user (soft delete)
     */
    async deleteUser(where: UserWhereUniqueInput, deletedBy?: bigint | number): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where,
                data: {
                    deletedAt: new Date(),
                    deletedBy: deletedBy ? (typeof deletedBy === 'bigint' ? deletedBy : BigInt(deletedBy)) : null
                }
            });
            
            log.Info('User soft deleted successfully', { userId: user.id, email: user.email });
            return user;
        } catch (error) {
            log.Error('Failed to delete user', { error, where });
            throw new Error(`Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Permanently delete user (hard delete)
     */
    async permanentlyDeleteUser(where: UserWhereUniqueInput): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.delete({
                where
            });
            
            log.Info('User permanently deleted', { userId: user.id, email: user.email });
            return user;
        } catch (error) {
            log.Error('Failed to permanently delete user', { error, where });
            throw new Error(`Failed to permanently delete user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find users with pagination and filtering
     */
    async findUsers(params: {
        where?: UserWhereInput;
        include?: UserInclude;
        skip?: number;
        take?: number;
        orderBy?: any;
    } = {}): Promise<User[]> {
        try {
            const userDb = this.getUserDb();
            const users = await userDb.user.findMany({
                where: params.where,
                include: params.include || {
                    roles: {
                        include: {
                            role: true
                        }
                    }
                },
                skip: params.skip,
                take: params.take,
                orderBy: params.orderBy || { createdAt: 'desc' }
            });
            
            return users;
        } catch (error) {
            log.Error('Failed to find users', { error, params });
            throw new Error(`Failed to find users: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Count users with optional filtering
     */
    async countUsers(where?: UserWhereInput): Promise<number> {
        try {
            const userDb = this.getUserDb();
            const count = await userDb.user.count({
                where
            });
            
            return count;
        } catch (error) {
            log.Error('Failed to count users', { error, where });
            throw new Error(`Failed to count users: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }








    
    // ========== Authentication Related Methods ==========

    /**
     * Update user's last login information
     */
    async updateLastLogin(userId: bigint | number, ipAddress?: string): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    lastLoginAt: new Date(),
                    lastLoginIp: ipAddress,
                    loginAttempts: 0, // Reset login attempts on successful login
                    lockoutUntil: null // Remove any lockout
                }
            });
            
            log.Info('User last login updated', { userId: user.id, ipAddress });
            return user;
        } catch (error) {
            log.Error('Failed to update last login', { error, userId, ipAddress });
            throw new Error(`Failed to update last login: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Increment failed login attempts
     */
    async incrementLoginAttempts(userId: bigint | number, maxAttempts: number = 5, lockoutDuration: number = 30): Promise<User> {
        try {
            const userDb = this.getUserDb();
            
            // First get current user to check attempts
            const currentUser = await userDb.user.findUnique({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) }
            });
            
            if (!currentUser) {
                throw new Error('User not found');
            }
            
            const newAttempts = (currentUser.loginAttempts || 0) + 1;
            const shouldLockout = newAttempts >= maxAttempts;
            
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    loginAttempts: newAttempts,
                    lockoutUntil: shouldLockout 
                        ? new Date(Date.now() + lockoutDuration * 60 * 1000) // lockout for specified minutes
                        : currentUser.lockoutUntil
                }
            });
            
            log.Info('Login attempts incremented', { 
                userId: user.id, 
                attempts: newAttempts, 
                locked: shouldLockout 
            });
            return user;
        } catch (error) {
            log.Error('Failed to increment login attempts', { error, userId });
            throw new Error(`Failed to increment login attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check if user is locked out
     */
    async isUserLockedOut(userId: bigint | number): Promise<boolean> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.findUnique({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                select: { lockoutUntil: true }
            });
            
            if (!user || !user.lockoutUntil) {
                return false;
            }
            
            return new Date() < user.lockoutUntil;
        } catch (error) {
            log.Error('Failed to check user lockout status', { error, userId });
            throw new Error(`Failed to check user lockout status: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update user password hash
     */
    async updatePassword(userId: bigint | number, passwordHash: string): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    passwordHash,
                    passwordResetToken: null,
                    passwordResetExpires: null
                }
            });
            
            log.Info('User password updated', { userId: user.id });
            return user;
        } catch (error) {
            log.Error('Failed to update password', { error, userId });
            throw new Error(`Failed to update password: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Set password reset token
     */
    async setPasswordResetToken(userId: bigint | number, token: string, expiresIn: number = 3600): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    passwordResetToken: token,
                    passwordResetExpires: new Date(Date.now() + expiresIn * 1000) // expiresIn seconds
                }
            });
            
            log.Info('Password reset token set', { userId: user.id });
            return user;
        } catch (error) {
            log.Error('Failed to set password reset token', { error, userId });
            throw new Error(`Failed to set password reset token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find user by password reset token
     */
    async findByPasswordResetToken(token: string): Promise<User | null> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.findFirst({
                where: {
                    passwordResetToken: token,
                    passwordResetExpires: {
                        gt: new Date() // Token must not be expired
                    }
                }
            });
            
            return user;
        } catch (error) {
            log.Error('Failed to find user by password reset token', { error });
            throw new Error(`Failed to find user by password reset token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }








    // ========== Email Verification Methods ==========

    /**
     * Set email verification token
     */
    async setEmailVerificationToken(userId: bigint | number, token: string, expiresIn: number = 86400): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    emailVerificationToken: token,
                    emailVerificationExpires: new Date(Date.now() + expiresIn * 1000) // expiresIn seconds
                }
            });
            
            log.Info('Email verification token set', { userId: user.id });
            return user;
        } catch (error) {
            log.Error('Failed to set email verification token', { error, userId });
            throw new Error(`Failed to set email verification token: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Verify user email
     */
    async verifyEmail(token: string): Promise<User | null> {
        try {
            const userDb = this.getUserDb();
            
            // Find user with valid verification token
            const user = await userDb.user.findFirst({
                where: {
                    emailVerificationToken: token,
                    emailVerificationExpires: {
                        gt: new Date()
                    }
                }
            });
            
            if (!user) {
                return null;
            }
            
            // Update user to verified status
            const verifiedUser = await userDb.user.update({
                where: { id: user.id },
                data: {
                    isVerified: true,
                    emailVerificationToken: null,
                    emailVerificationExpires: null
                }
            });
            
            log.Info('User email verified', { userId: verifiedUser.id });
            return verifiedUser;
        } catch (error) {
            log.Error('Failed to verify email', { error, token });
            throw new Error(`Failed to verify email: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }











    // ========== Session Management Methods ==========

    /**
     * Create user session
     */
    async createSession(sessionData: {
        userId: bigint | number;
        tokenHash: string;
        deviceInfo?: string;
        ipAddress?: string;
        location?: string;
        expiresAt: Date;
    }): Promise<UserSession> {
        try {
            const userDb = this.getUserDb();
            const session = await userDb.userSession.create({
                data: {
                    userId: typeof sessionData.userId === 'bigint' ? sessionData.userId : BigInt(sessionData.userId),
                    tokenHash: sessionData.tokenHash,
                    deviceInfo: sessionData.deviceInfo,
                    ipAddress: sessionData.ipAddress,
                    location: sessionData.location,
                    expiresAt: sessionData.expiresAt,
                    lastUsedAt: new Date()
                }
            });
            
            log.Info('User session created', { sessionId: session.id, userId: session.userId });
            return session;
        } catch (error) {
            log.Error('Failed to create session', { error, sessionData });
            throw new Error(`Failed to create session: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Find active session by token hash
     */
    async findActiveSession(tokenHash: string): Promise<UserSession | null> {
        try {
            const userDb = this.getUserDb();
            const session = await userDb.userSession.findFirst({
                where: {
                    tokenHash,
                    isActive: true,
                    expiresAt: {
                        gt: new Date()
                    }
                },
                include: {
                    user: true
                }
            });
            
            return session;
        } catch (error) {
            log.Error('Failed to find active session', { error, tokenHash });
            throw new Error(`Failed to find active session: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Update session last used
     */
    async updateSessionLastUsed(sessionId: bigint | number): Promise<UserSession> {
        try {
            const userDb = this.getUserDb();
            const session = await userDb.userSession.update({
                where: { id: typeof sessionId === 'bigint' ? sessionId : BigInt(sessionId) },
                data: {
                    lastUsedAt: new Date()
                }
            });
            
            return session;
        } catch (error) {
            log.Error('Failed to update session last used', { error, sessionId });
            throw new Error(`Failed to update session last used: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Invalidate session
     */
    async invalidateSession(sessionId: bigint | number): Promise<UserSession> {
        try {
            const userDb = this.getUserDb();
            const session = await userDb.userSession.update({
                where: { id: typeof sessionId === 'bigint' ? sessionId : BigInt(sessionId) },
                data: {
                    isActive: false,
                    deletedAt: new Date()
                }
            });
            
            log.Info('Session invalidated', { sessionId: session.id });
            return session;
        } catch (error) {
            log.Error('Failed to invalidate session', { error, sessionId });
            throw new Error(`Failed to invalidate session: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Invalidate all user sessions
     */
    async invalidateAllUserSessions(userId: bigint | number): Promise<void> {
        try {
            const userDb = this.getUserDb();
            await userDb.userSession.updateMany({
                where: {
                    userId: typeof userId === 'bigint' ? userId : BigInt(userId),
                    isActive: true
                },
                data: {
                    isActive: false,
                    deletedAt: new Date()
                }
            });
            
            log.Info('All user sessions invalidated', { userId });
        } catch (error) {
            log.Error('Failed to invalidate all user sessions', { error, userId });
            throw new Error(`Failed to invalidate all user sessions: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }








    // ========== Role Management Methods ==========

    /**
     * Assign role to user
     */
    async assignRole(userId: bigint | number, roleId: bigint | number, assignedBy?: bigint | number, expiresAt?: Date): Promise<UserRole> {
        try {
            const userDb = this.getUserDb();
            const userRole = await userDb.userRole.create({
                data: {
                    userId: typeof userId === 'bigint' ? userId : BigInt(userId),
                    roleId: typeof roleId === 'bigint' ? roleId : BigInt(roleId),
                    assignedBy: assignedBy ? (typeof assignedBy === 'bigint' ? assignedBy : BigInt(assignedBy)) : null,
                    expiresAt
                },
                include: {
                    role: true,
                    user: true
                }
            });
            
            log.Info('Role assigned to user', { userId, roleId, userRoleId: userRole.id });
            return userRole;
        } catch (error) {
            log.Error('Failed to assign role to user', { error, userId, roleId });
            throw new Error(`Failed to assign role to user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Remove role from user
     */
    async removeRole(userId: bigint | number, roleId: bigint | number): Promise<void> {
        try {
            const userDb = this.getUserDb();
            await userDb.userRole.updateMany({
                where: {
                    userId: typeof userId === 'bigint' ? userId : BigInt(userId),
                    roleId: typeof roleId === 'bigint' ? roleId : BigInt(roleId),
                    deletedAt: null
                },
                data: {
                    deletedAt: new Date()
                }
            });
            
            log.Info('Role removed from user', { userId, roleId });
        } catch (error) {
            log.Error('Failed to remove role from user', { error, userId, roleId });
            throw new Error(`Failed to remove role from user: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Get user roles
     */
    async getUserRoles(userId: bigint | number): Promise<UserRole[]> {
        try {
            const userDb = this.getUserDb();
            const userRoles = await userDb.userRole.findMany({
                where: {
                    userId: typeof userId === 'bigint' ? userId : BigInt(userId),
                    deletedAt: null,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } }
                    ]
                },
                include: {
                    role: true
                }
            });
            
            return userRoles;
        } catch (error) {
            log.Error('Failed to get user roles', { error, userId });
            throw new Error(`Failed to get user roles: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Check if user has role
     */
    async hasRole(userId: bigint | number, roleName: string): Promise<boolean> {
        try {
            const userDb = this.getUserDb();
            const userRole = await userDb.userRole.findFirst({
                where: {
                    userId: typeof userId === 'bigint' ? userId : BigInt(userId),
                    deletedAt: null,
                    OR: [
                        { expiresAt: null },
                        { expiresAt: { gt: new Date() } }
                    ],
                    role: {
                        name: roleName,
                        isActive: true,
                        deletedAt: null
                    }
                }
            });
            
            return !!userRole;
        } catch (error) {
            log.Error('Failed to check user role', { error, userId, roleName });
            throw new Error(`Failed to check user role: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }












    // ========== Account Status Methods ==========

    /**
     * Activate user account
     */
    async activateUser(userId: bigint | number): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    isActive: true,
                    isSuspended: false
                }
            });
            
            log.Info('User account activated', { userId: user.id });
            return user;
        } catch (error) {
            log.Error('Failed to activate user account', { error, userId });
            throw new Error(`Failed to activate user account: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Suspend user account
     */
    async suspendUser(userId: bigint | number, suspendedBy?: bigint | number): Promise<User> {
        try {
            const userDb = this.getUserDb();
            
            // Suspend user and invalidate all sessions
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    isSuspended: true,
                    updatedBy: suspendedBy ? (typeof suspendedBy === 'bigint' ? suspendedBy : BigInt(suspendedBy)) : null
                }
            });
            
            // Invalidate all user sessions
            await this.invalidateAllUserSessions(userId);
            
            log.Info('User account suspended', { userId: user.id, suspendedBy });
            return user;
        } catch (error) {
            log.Error('Failed to suspend user account', { error, userId });
            throw new Error(`Failed to suspend user account: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Enable two-factor authentication
     */
    async enableTwoFactor(userId: bigint | number, secret: string): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    twoFactorEnabled: true,
                    twoFactorSecret: secret
                }
            });
            
            log.Info('Two-factor authentication enabled', { userId: user.id });
            return user;
        } catch (error) {
            log.Error('Failed to enable two-factor authentication', { error, userId });
            throw new Error(`Failed to enable two-factor authentication: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Disable two-factor authentication
     */
    async disableTwoFactor(userId: bigint | number): Promise<User> {
        try {
            const userDb = this.getUserDb();
            const user = await userDb.user.update({
                where: { id: typeof userId === 'bigint' ? userId : BigInt(userId) },
                data: {
                    twoFactorEnabled: false,
                    twoFactorSecret: null
                }
            });
            
            log.Info('Two-factor authentication disabled', { userId: user.id });
            return user;
        } catch (error) {
            log.Error('Failed to disable two-factor authentication', { error, userId });
            throw new Error(`Failed to disable two-factor authentication: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}

export default UserRepository;
