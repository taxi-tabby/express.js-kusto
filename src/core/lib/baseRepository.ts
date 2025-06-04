import { prismaManager, PrismaManager } from './prismaManager';
import { log } from '../external/winston';

/**
 * Base Repository Class
 * Provides common database functionality using PrismaManager
 */
export abstract class BaseRepository {
    protected db: PrismaManager;

    constructor() {
        this.db = prismaManager;
    }

}
