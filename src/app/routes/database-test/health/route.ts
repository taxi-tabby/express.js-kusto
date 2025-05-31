
import { Request, Response } from 'express';
import { prismaManager } from '@core/lib/prismaManager';

/**
 * GET /database/health
 * Comprehensive health check for all databases
 */
export async function GET(req: Request, res: Response) {
    try {
        const healthCheck = await prismaManager.healthCheck();
        
        const statusCode = healthCheck.overall === 'healthy' ? 200 : 
                          healthCheck.overall === 'degraded' ? 206 : 503;
        
        res.status(statusCode).json({
            success: healthCheck.overall !== 'unhealthy',
            data: healthCheck,
            timestamp: new Date().toISOString(),
            message: `Database health check completed - ${healthCheck.overall}`
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to perform health check',
            details: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString()
        });
    }
}
