import { ExpressRouter } from '@core/lib/expressRouter'
import { Request, Response } from 'express';
import { prismaManager } from '@core/lib/prismaManager';

/**
 * Individual user routes
 */
const router = new ExpressRouter();

/**
 * GET /users/detail/:id - Get a specific user by ID from testdb1
 */
router.GET_SLUG(['id'], async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const userId = parseInt(id);
    



        if (isNaN(userId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user ID - must be a number',
                provided: id
            });
        }

        if (!prismaManager.isConnected('testdb1')) {
            return res.status(503).json({
                success: false,
                error: 'Database testdb1 is not connected'
            });
        }


        const db1 = prismaManager.getClient('testdb1');
        
        const user = await db1.user.findUnique({
            where: { id: userId },
            include: {
                posts: {
                    orderBy: {
                        createdAt: 'desc'
                    }
                }
            }
        });
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                userId: userId
            });
        }
        
        res.json({
            success: true,
            data: user,
            database: 'testdb1',
            message: 'User retrieved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get user',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router.build();
