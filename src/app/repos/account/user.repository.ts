
import { BaseRepository } from '@core/lib/baseRepository';

/**
 * User repository for handling user-related database operations
 */
export class UserRepository extends BaseRepository {
    
    /**
     * Get user database client
     */
    private getUserDb() {
        return this.db.getWrap('user');
    }




}

export default UserRepository;
