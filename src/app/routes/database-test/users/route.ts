import { ExpressRouter } from '@core/lib/expressRouter'
import { Request, Response } from 'express';
import { prismaManager } from '@core/lib/prismaManager';

/**
 * User management routes using PrismaManager
 */
const router = new ExpressRouter();

/**
 * GET /users - Get all users from testdb1 (default database)
 */
router.GET(async (req: Request, res: Response) => {
    try {


        const a  = await prismaManager.healthCheck();
        console.log(a);

        if (!prismaManager.isConnected('testdb1')) {
            return res.status(503).json({
                success: false,
                error: 'Database testdb1 is not connected',
                availableDatabases: prismaManager.getAvailableDatabases()
            });
        }



        const db1 = prismaManager.getClient('testdb1');
        
        
        const users = await db1.user.findMany({
            include: {
                posts: true
            }
        });
        
        res.json({
            success: true,
            data: users,
            database: 'testdb1',
            count: users.length,
            message: 'Users retrieved successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to get users',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /users - Create a new user in testdb1
 */
router.POST(async (req: Request, res: Response) => {
    try {
        const { email, name } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        if (!prismaManager.isConnected('testdb1')) {
            return res.status(503).json({
                success: false,
                error: 'Database testdb1 is not connected'
            });
        }
        
        const db1 = prismaManager.getClient('testdb1');
        
        const user = await db1.user.create({
            data: {
                email,
                name: name || null
            }
        });
        
        res.status(201).json({
            success: true,
            data: user,
            database: 'testdb1',
            message: 'User created successfully'
        });
    } catch (error) {
        if (error instanceof Error && error.message.includes('Unique constraint')) {
            res.status(409).json({
                success: false,
                error: 'Email already exists',
                details: error.message
            });
        } else {
            res.status(500).json({
                success: false,
                error: 'Failed to create user',
                details: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
});

export default router.build();
