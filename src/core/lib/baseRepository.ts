import { prismaManager, PrismaManager } from './prismaManager';
import { log } from '../external/winston';


export abstract class BaseRepository {
    protected db: PrismaManager;

    constructor() {
        this.db = prismaManager;
    }

}
