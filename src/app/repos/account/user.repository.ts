import { BaseRepository } from '@core/lib/baseRepository';
import { 
    UserBase, 
    UserAuth, 
    UserProfile, 
    UserCreateData, 
    UserUpdateData, 
    UserProfileUpdateData,
    UserFilters,
    BulkUpdateData
} from './types';

/**
 * User repository for handling user-related database operations
 * Optimized for performance with minimal joins and efficient indexing
 */
export class UserRepository extends BaseRepository {
    
    private getUserDb() {
        return this.db.getWrap('user');
    }

    // Core find methods (minimal data, no joins)
    async findById(id: bigint): Promise<UserBase | null> {
        return this.getUserDb().user.findUnique({
            where: { id, deletedAt: null },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                isSuspended: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }

    async findByEmail(email: string): Promise<UserBase | null> {
        return this.getUserDb().user.findUnique({
            where: { email, deletedAt: null },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                isSuspended: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }

    async findByUuid(uuid: string): Promise<UserBase | null> {
        return this.getUserDb().user.findUnique({
            where: { uuid, deletedAt: null },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                isSuspended: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }

    async findByUsername(username: string): Promise<UserBase | null> {
        return this.getUserDb().user.findUnique({
            where: { username, deletedAt: null },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                isSuspended: true,
                createdAt: true,
                updatedAt: true
            }
        });
    }

    // Unified identifier method (accepts both bigint ID and string UUID)
    async findByIdentifier(identifier: bigint | string): Promise<UserBase | null> {
        if (typeof identifier === 'bigint') {
            return this.findById(identifier);
        }
        return this.findByUuid(identifier);
    }

    // Separate method for getting user with roles (use only when needed)
    async findWithRoles(uuid: string) {
        return this.getUserDb().user.findUnique({
            where: { uuid, deletedAt: null },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                roles: {
                    where: { deletedAt: null },
                    select: {
                        role: {
                            select: {
                                id: true,
                                uuid: true,
                                name: true,
                                isActive: true
                            }
                        }
                    }
                }
            }
        });
    }

    // Authentication optimized methods
    async findForAuth(email: string): Promise<UserAuth | null> {
        return this.getUserDb().user.findUnique({
            where: { email, deletedAt: null },
            select: {
                id: true,
                uuid: true,
                email: true,
                passwordHash: true,
                isActive: true,
                isVerified: true,
                isSuspended: true,
                loginAttempts: true,
                lockoutUntil: true,
                twoFactorEnabled: true,
                twoFactorSecret: true
            }
        });
    }

    async create(data: UserCreateData) {
        return this.getUserDb().user.create({
            data,
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                createdAt: true
            }
        });
    }

    // Update methods (optimized selects)
    async update(id: bigint, data: UserUpdateData) {
        return this.getUserDb().user.update({
            where: { id, deletedAt: null },
            data: { ...data, updatedAt: new Date() },
            select: {
                id: true,
                uuid: true,
                firstName: true,
                lastName: true,
                username: true,
                updatedAt: true
            }
        });
    }

    async updateByUuid(uuid: string, data: UserUpdateData) {
        return this.getUserDb().user.update({
            where: { uuid, deletedAt: null },
            data: { ...data, updatedAt: new Date() },
            select: {
                id: true,
                uuid: true,
                firstName: true,
                lastName: true,
                username: true,
                updatedAt: true
            }
        });
    }

    // Security methods
    async updatePassword(identifier: bigint | string, passwordHash: string, updatedBy?: bigint) {
        const where = typeof identifier === 'bigint' 
            ? { id: identifier, deletedAt: null }
            : { uuid: identifier, deletedAt: null };

        return this.getUserDb().user.update({
            where,
            data: { 
                passwordHash,
                updatedBy,
                updatedAt: new Date()
            },
            select: { id: true, uuid: true, updatedAt: true }
        });
    }

    async updateLoginInfo(identifier: bigint | string, ipAddress?: string) {
        const where = typeof identifier === 'bigint' 
            ? { id: identifier, deletedAt: null }
            : { uuid: identifier, deletedAt: null };

        return this.getUserDb().user.update({
            where,
            data: {
                lastLoginAt: new Date(),
                lastLoginIp: ipAddress,
                loginAttempts: 0,
                lockoutUntil: null
            },
            select: { id: true, uuid: true, lastLoginAt: true }
        });
    }

    async incrementLoginAttempts(identifier: bigint | string) {
        const where = typeof identifier === 'bigint' 
            ? { id: identifier, deletedAt: null }
            : { uuid: identifier, deletedAt: null };

        const user = await this.getUserDb().user.findUnique({
            where,
            select: { id: true, loginAttempts: true }
        });

        if (!user) return null;

        const newAttempts = user.loginAttempts + 1;
        const lockoutUntil = newAttempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;

        return this.getUserDb().user.update({
            where: { id: user.id },
            data: { loginAttempts: newAttempts, lockoutUntil },
            select: { id: true, loginAttempts: true, lockoutUntil: true }
        });
    }

    async softDelete(identifier: bigint | string, deletedBy?: bigint) {
        const where = typeof identifier === 'bigint' 
            ? { id: identifier, deletedAt: null }
            : { uuid: identifier, deletedAt: null };

        return this.getUserDb().user.update({
            where,
            data: {
                deletedAt: new Date(),
                deletedBy,
                isActive: false
            },
            select: { id: true, uuid: true, deletedAt: true }
        });
    }

    // List and count methods
    async findMany(filters?: UserFilters, page = 1, limit = 20) {
        const skip = (page - 1) * limit;
        
        return this.getUserDb().user.findMany({
            where: { 
                deletedAt: null,
                ...filters
            },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                createdAt: true,
                lastLoginAt: true
            },
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' }
        });
    }

    async findActive(page = 1, limit = 20) {
        return this.findMany({ isActive: true }, page, limit);
    }

    async count(filters?: UserFilters): Promise<number> {
        return this.getUserDb().user.count({
            where: {
                deletedAt: null,
                ...filters
            }
        });
    }

    // Utility methods
    async exists(email: string, excludeId?: bigint): Promise<{ id: bigint } | null> {
        return this.getUserDb().user.findFirst({
            where: {
                email,
                deletedAt: null,
                ...(excludeId && { id: { not: excludeId } })
            },
            select: { id: true }
        });
    }

    async isLockedOut(identifier: bigint | string): Promise<boolean> {
        const where = typeof identifier === 'bigint' 
            ? { id: identifier, deletedAt: null }
            : { uuid: identifier, deletedAt: null };

        const user = await this.getUserDb().user.findUnique({
            where,
            select: { lockoutUntil: true }
        });
        
        return user?.lockoutUntil ? new Date() < user.lockoutUntil : false;
    }

    // Bulk operations for performance
    async bulkUpdate(userIds: bigint[], data: BulkUpdateData) {
        return this.getUserDb().user.updateMany({
            where: {
                id: { in: userIds },
                deletedAt: null
            },
            data: { ...data, updatedAt: new Date() }
        });
    }

    async bulkActivate(userIds: bigint[]) {
        return this.bulkUpdate(userIds, { isActive: true });
    }

    async bulkDeactivate(userIds: bigint[]) {
        return this.bulkUpdate(userIds, { isActive: false });
    }

    // Profile specific methods
    async getProfile(uuid: string): Promise<UserProfile | null> {
        return this.getUserDb().user.findUnique({
            where: { uuid, deletedAt: null },
            select: {
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                profileImage: true,
                timezone: true,
                locale: true,
                isVerified: true,
                createdAt: true
            }
        });
    }

    async updateProfile(uuid: string, data: UserProfileUpdateData) {
        return this.getUserDb().user.update({
            where: { uuid, deletedAt: null },
            data: { ...data, updatedAt: new Date() },
            select: {
                uuid: true,
                firstName: true,
                lastName: true,
                profileImage: true,
                timezone: true,
                locale: true,
                updatedAt: true
            }
        });
    }

    // Email verification methods
    async setEmailVerificationToken(uuid: string, token: string) {
        return this.getUserDb().user.update({
            where: { uuid, deletedAt: null },
            data: { 
                emailVerificationToken: token,
                emailVerificationExpires: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
                updatedAt: new Date()
            },
            select: { id: true, uuid: true, emailVerificationToken: true }
        });
    }

    async findByEmailVerificationToken(token: string) {
        return this.getUserDb().user.findFirst({
            where: { 
                emailVerificationToken: token,
                emailVerificationExpires: { gt: new Date() },
                deletedAt: null
            },
            select: {
                id: true,
                uuid: true,
                email: true,
                isVerified: true
            }
        });
    }

    async verifyEmail(uuid: string) {
        return this.getUserDb().user.update({
            where: { uuid, deletedAt: null },
            data: { 
                isVerified: true,
                emailVerificationToken: null,
                emailVerificationExpires: null,
                updatedAt: new Date()
            },
            select: { id: true, uuid: true, isVerified: true }
        });
    }

    // Password reset methods
    async setPasswordResetToken(email: string, token: string) {
        return this.getUserDb().user.update({
            where: { email, deletedAt: null },
            data: { 
                passwordResetToken: token,
                passwordResetExpires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
                updatedAt: new Date()
            },
            select: { id: true, uuid: true, passwordResetToken: true }
        });
    }

    async findByPasswordResetToken(token: string) {
        return this.getUserDb().user.findFirst({
            where: { 
                passwordResetToken: token,
                passwordResetExpires: { gt: new Date() },
                deletedAt: null
            },
            select: {
                id: true,
                uuid: true,
                email: true
            }
        });
    }

    async clearPasswordResetToken(uuid: string) {
        return this.getUserDb().user.update({
            where: { uuid, deletedAt: null },
            data: { 
                passwordResetToken: null,
                passwordResetExpires: null,
                updatedAt: new Date()
            },
            select: { id: true, uuid: true }
        });
    }

    // Analytics and monitoring methods
    async getUserStats(dateFrom?: Date, dateTo?: Date) {
        const where: any = { deletedAt: null };
        
        if (dateFrom || dateTo) {
            where.createdAt = {};
            if (dateFrom) where.createdAt.gte = dateFrom;
            if (dateTo) where.createdAt.lte = dateTo;
        }

        const [total, active, verified, suspended] = await Promise.all([
            this.getUserDb().user.count({ where }),
            this.getUserDb().user.count({ where: { ...where, isActive: true } }),
            this.getUserDb().user.count({ where: { ...where, isVerified: true } }),
            this.getUserDb().user.count({ where: { ...where, isSuspended: true } })
        ]);

        return {
            total,
            active,
            verified,
            suspended,
            unverified: total - verified,
            inactive: total - active
        };
    }

    async getRecentlyActiveUsers(hours = 24, limit = 50) {
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        return this.getUserDb().user.findMany({
            where: {
                deletedAt: null,
                lastLoginAt: { gte: since }
            },
            select: {
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                lastLoginAt: true,
                lastLoginIp: true
            },
            orderBy: { lastLoginAt: 'desc' },
            take: limit
        });
    }

    async searchUsers(query: string, limit = 20) {
        return this.getUserDb().user.findMany({
            where: {
                deletedAt: null,
                OR: [
                    { firstName: { contains: query, mode: 'insensitive' } },
                    { lastName: { contains: query, mode: 'insensitive' } },
                    { email: { contains: query, mode: 'insensitive' } },
                    { username: { contains: query, mode: 'insensitive' } }
                ]
            },
            select: {
                id: true,
                uuid: true,
                email: true,
                firstName: true,
                lastName: true,
                username: true,
                isActive: true,
                isVerified: true,
                createdAt: true
            },
            take: limit,
            orderBy: { createdAt: 'desc' }
        });
    }

    // Cleanup methods for maintenance
    async cleanupExpiredTokens() {
        const now = new Date();
        
        const [emailTokens, passwordTokens] = await Promise.all([
            this.getUserDb().user.updateMany({
                where: {
                    emailVerificationExpires: { lt: now },
                    emailVerificationToken: { not: null }
                },
                data: {
                    emailVerificationToken: null,
                    emailVerificationExpires: null
                }
            }),
            this.getUserDb().user.updateMany({
                where: {
                    passwordResetExpires: { lt: now },
                    passwordResetToken: { not: null }
                },
                data: {
                    passwordResetToken: null,
                    passwordResetExpires: null
                }
            })
        ]);

        return {
            emailTokensCleared: emailTokens.count,
            passwordTokensCleared: passwordTokens.count
        };
    }

    async unlockExpiredAccounts() {
        const now = new Date();
        
        const result = await this.getUserDb().user.updateMany({
            where: {
                lockoutUntil: { lt: now },
                loginAttempts: { gt: 0 }
            },
            data: {
                loginAttempts: 0,
                lockoutUntil: null
            }
        });

        return { unlockedAccounts: result.count };
    }

    // Batch operations for administrative tasks
    async batchProcessUsers(
        userIds: bigint[], 
        operation: 'activate' | 'deactivate' | 'verify' | 'suspend' | 'unsuspend'
    ) {
        const data: any = { updatedAt: new Date() };
        
        switch (operation) {
            case 'activate':
                data.isActive = true;
                break;
            case 'deactivate':
                data.isActive = false;
                break;
            case 'verify':
                data.isVerified = true;
                data.emailVerificationToken = null;
                data.emailVerificationExpires = null;
                break;
            case 'suspend':
                data.isSuspended = true;
                break;
            case 'unsuspend':
                data.isSuspended = false;
                break;
        }

        return this.getUserDb().user.updateMany({
            where: {
                id: { in: userIds },
                deletedAt: null
            },
            data
        });
    }

    // Performance monitoring helpers
    async getSlowLoginUsers(threshold = 5) {
        return this.getUserDb().user.findMany({
            where: {
                deletedAt: null,
                loginAttempts: { gte: threshold },
                lockoutUntil: null
            },
            select: {
                uuid: true,
                email: true,
                loginAttempts: true,
                lastLoginAt: true,
                lastLoginIp: true
            },
            orderBy: { loginAttempts: 'desc' }
        });
    }

    // Export methods for data migration/backup
    async exportUserData(uuid: string) {
        const user = await this.getUserDb().user.findUnique({
            where: { uuid, deletedAt: null },
            include: {
                roles: {
                    where: { deletedAt: null },
                    include: {
                        role: {
                            select: {
                                name: true,
                                description: true
                            }
                        }
                    }
                },
                permissions: {
                    where: { deletedAt: null },
                    include: {
                        permission: {
                            select: {
                                name: true,
                                resource: true,
                                action: true
                            }
                        }
                    }
                }
            }
        });

        if (!user) return null;

        // Remove sensitive data before export
        const { passwordHash, twoFactorSecret, ...safeUserData } = user;
        return safeUserData;
    }

    // Validation helpers
    async validateUserIntegrity(uuid: string) {
        const issues: string[] = [];
        
        const user = await this.getUserDb().user.findUnique({
            where: { uuid },
            select: {
                id: true,
                uuid: true,
                email: true,
                username: true,
                isActive: true,
                isVerified: true,
                isSuspended: true,
                emailVerificationToken: true,
                emailVerificationExpires: true,
                passwordResetToken: true,
                passwordResetExpires: true,
                lockoutUntil: true,
                loginAttempts: true,
                deletedAt: true
            }
        });

        if (!user) {
            issues.push('User not found');
            return { isValid: false, issues };
        }

        // Check for logical inconsistencies
        if (user.deletedAt && user.isActive) {
            issues.push('Deleted user marked as active');
        }

        if (user.isVerified && user.emailVerificationToken) {
            issues.push('Verified user has pending verification token');
        }

        if (user.emailVerificationExpires && user.emailVerificationExpires < new Date() && user.emailVerificationToken) {
            issues.push('Expired email verification token not cleaned up');
        }

        if (user.passwordResetExpires && user.passwordResetExpires < new Date() && user.passwordResetToken) {
            issues.push('Expired password reset token not cleaned up');
        }

        if (user.lockoutUntil && user.lockoutUntil < new Date() && user.loginAttempts > 0) {
            issues.push('Expired lockout not cleared');
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    }
}

export default UserRepository;
