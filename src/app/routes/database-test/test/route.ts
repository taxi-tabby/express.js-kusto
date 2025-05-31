import { ExpressRouter } from '@core/lib/expressRouter'
import { Request, Response } from 'express';
import { prismaManager } from '../../../../core/lib/prismaManager';

/**
 * Database connection test routes
 */
const router = new ExpressRouter();

/**
 * GET /database/test/:dbName - Test connection to a specific database
 */
router.GET_SLUG(['dbName'], async (req: Request, res: Response) => {
    const { dbName } = req.params;
    
    try {
        if (!prismaManager.isConnected(dbName)) {
            return res.status(404).json({
                success: false,
                error: `Database '${dbName}' is not connected`,
                availableDatabases: prismaManager.getAvailableDatabases()
            });
        }

        const client = prismaManager.getClient(dbName);
        
        // Test the connection with a simple query
        const startTime = Date.now();
        await client.$queryRaw`SELECT 1 as test`;
        const responseTime = Date.now() - startTime;
        
        res.json({
            success: true,
            message: `Database '${dbName}' connection is healthy`,
            database: dbName,
            responseTime: `${responseTime}ms`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: `Failed to test database '${dbName}' connection`,
            details: error instanceof Error ? error.message : 'Unknown error',
            database: dbName,
            timestamp: new Date().toISOString()
        });
    }
});

export default router.build();
