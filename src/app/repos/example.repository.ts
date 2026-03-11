import { BaseRepository } from '@lib/baseRepository';


export default class ExampleRepository extends BaseRepository<'default'> {
    protected getDatabaseName(): 'default' {
        return 'default';
    }

}