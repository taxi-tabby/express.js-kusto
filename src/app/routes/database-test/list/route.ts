import { ExpressRouter } from '@core/lib/expressRouter'
import { Request, Response } from 'express';
import { prismaManager } from '../../../../core/lib/prismaManager';

/**
 * Database list routes
 */
const router = new ExpressRouter();

/**
 * GET /database/list - Get list of all available databases
 */
router.GET((req: Request, res: Response) => {
    try {
        const availableDatabases = prismaManager.getAvailableDatabases();
        const allConfigs = prismaManager.getAllConfigs();
        
        res.json({
            success: true,
            data: {
                connected: availableDatabases,
                total: allConfigs.length,
                databases: allConfigs.map(config => ({
                    name: config.name,
                    connected: prismaManager.isConnected(config.name),
                    generated: config.isGenerated,
                    schemaPath: config.schemaPath.replace(process.cwd(), '.')
                }))
            },
            message: 'Database list retrieved successfully',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get database list',
            details: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
});

export default router.build();
