import { ExpressRouter } from '@core/lib/expressRouter'
import { Request, Response } from 'express';
import { prismaManager } from '@core/lib/prismaManager';

/**
 * Database status and management routes
 */
const router = new ExpressRouter();

/**
 * GET /database - Get the status of all database connections
 */
router.GET((req: Request, res: Response) => {
    try {
        const status = prismaManager.getStatus();
        
        res.json({
            success: true,
            data: status,
            message: 'Database status retrieved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get database status',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /database - Get list of all available databases (using POST for complex data)
 */
router.POST((req: Request, res: Response) => {
    try {
        const availableDatabases = prismaManager.getAvailableDatabases();
        const allConfigs = prismaManager.getAllConfigs();
        
        res.json({
            success: true,
            data: {
                connected: availableDatabases,
                all: allConfigs.map(config => ({
                    name: config.name,
                    connected: prismaManager.isConnected(config.name),
                    generated: config.isGenerated,
                    schemaPath: config.schemaPath
                }))
            },
            message: 'Database list retrieved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get database list',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export default router.build();
