import { ExpressRouter } from '@core/lib/expressRouter'
import { Request, Response } from 'express';
import { prismaManager } from '../../../../../core/lib/prismaManager';

/**
 * User comparison routes
 */
const router = new ExpressRouter();

/**
 * GET /users/compare - Compare users between testdb1 and testdb2
 */
router.GET(async (req: Request, res: Response) => {
    try {
        const results: any = {};
        
        // testdb1 사용자 가져오기
        try {
            if (prismaManager.isConnected('testdb1')) {
                const db1 = prismaManager.getClient('testdb1');
                const users1 = await db1.user.findMany();
                results.testdb1 = {
                    success: true,
                    count: users1.length,
                    users: users1
                };
            } else {
                results.testdb1 = {
                    success: false,
                    error: 'Database testdb1 is not connected'
                };
            }
        } catch (error) {
            results.testdb1 = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
        
        // testdb2 사용자 가져오기
        try {
            if (prismaManager.isConnected('testdb2')) {
                const db2 = prismaManager.getClient('testdb2');
                const users2 = await db2.user.findMany();
                results.testdb2 = {
                    success: true,
                    count: users2.length,
                    users: users2
                };
            } else {
                results.testdb2 = {
                    success: false,
                    error: 'Database testdb2 is not connected'
                };
            }
        } catch (error) {
            results.testdb2 = {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
        
        res.json({
            success: true,
            data: results,
            message: 'User comparison completed',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to compare users',
            details: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

export default router.build();
