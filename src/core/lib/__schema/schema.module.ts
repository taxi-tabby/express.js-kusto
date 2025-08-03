import { Module } from '@nestjs/common';
import { SchemaController } from './schema.controller';
import { DevOnlyGuard } from '../../guards/dev-only.guard';
import { SecurityValidationService } from './services/security-validation.service';
import { CrudMetadataService } from './services/crud-metadata.service';

@Module({
  controllers: [SchemaController],
  providers: [
    DevOnlyGuard,
    SecurityValidationService,
    CrudMetadataService,
  ],
})
export class SchemaModule { } 