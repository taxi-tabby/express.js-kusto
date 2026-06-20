import { BaseRepository } from '@lib/data/database/baseRepository';


export default class ExampleRepository extends BaseRepository<'default'> {
    protected getDatabaseName(): 'default' {
        return 'default';
    }

}