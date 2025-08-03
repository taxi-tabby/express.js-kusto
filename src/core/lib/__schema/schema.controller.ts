import { Controller, Get, Param, NotFoundException, UseGuards, Logger } from '@nestjs/common';
import { DataSource, EntityMetadata } from 'typeorm';
import { ColumnMetadata as TypeORMColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { crudResponse } from '@foryourdev/nestjs-crud';
import { DevOnlyGuard } from '../../guards/dev-only.guard';
import { CrudMetadataService } from './services/crud-metadata.service';
import { SCHEMA_CONSTANTS } from './constants/schema.constants';
import {
  ColumnMetadata,
  SchemaEntityInfo,
  RelationInfo,
  IndexInfo,
  PrimaryKeyInfo,
  CheckInfo,
  UniqueInfo,
  ForeignKeyInfo,
  CrudInfo,
  JS_TYPE_MAPPING,
  TypeORMColumnType
} from './types/schema.types';
import 'reflect-metadata';

@Controller({
  path: 'schema',
  version: '1',
})
@UseGuards(DevOnlyGuard)
export class SchemaController {
  private readonly logger = new Logger(SchemaController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly crudMetadataService: CrudMetadataService,
  ) { }

  @Get()
  async index() {
    try {
      const metadata = this.dataSource.entityMetadatas;

      const modelsInfo: SchemaEntityInfo[] = metadata.map(entityMetadata => {
        // 컬럼 정보 추출
        const columns: ColumnMetadata[] = entityMetadata.columns.map(column => ({
          name: column.propertyName,
          databaseName: column.databaseName,
          type: column.type as string,
          jsType: this.getJsType(column),
          isPrimary: column.isPrimary,
          isGenerated: column.isGenerated,
          generationStrategy: column.generationStrategy as 'uuid' | 'increment' | 'rowid' | 'identity' | undefined,
          isNullable: column.isNullable,
          isArray: column.isArray,
          default: column.default,
          length: column.length,
          width: column.width,
          precision: column.precision ?? undefined,
          scale: column.scale ?? undefined,
          zerofill: column.zerofill,
          unsigned: column.unsigned,
          charset: column.charset,
          collation: column.collation,
          comment: column.comment,
          enum: column.enum,
          enumName: column.enumName,
          asExpression: column.asExpression,
          generatedType: column.generatedType as 'VIRTUAL' | 'STORED' | undefined,
          // 메타데이터 정보 추가
          metadata: this.getColumnMetadata(column),
        }));

        // 관계 정보 추출
        const relations: RelationInfo[] = entityMetadata.relations.map(relation => ({
          name: relation.propertyName,
          type: relation.relationType as 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many',
          target: typeof relation.type === 'function' ? relation.type.name : String(relation.type),
          inverseSide: relation.inverseSidePropertyPath,
          isOwner: relation.isOwning,
          isLazy: relation.isLazy,
          isCascade: {
            insert: relation.isCascadeInsert || false,
            update: relation.isCascadeUpdate || false,
            remove: relation.isCascadeRemove || false,
            softRemove: relation.isCascadeSoftRemove || false,
            recover: relation.isCascadeRecover || false,
          },
          onDelete: relation.onDelete,
          onUpdate: relation.onUpdate,
          nullable: relation.isNullable,
          joinColumns: relation.joinColumns?.map(jc => ({
            name: jc.databaseName,
            referencedColumnName: jc.referencedColumn?.databaseName,
          })),
          joinTable: relation.joinTableName || null,
        }));

        // 인덱스 정보 추출
        const indices: IndexInfo[] = entityMetadata.indices.map(index => ({
          name: index.name,
          columns: index.columns.map(column => column.databaseName),
          isUnique: index.isUnique,
          where: index.where,
        }));

        // 기본 키 정보
        const primaryKeys: PrimaryKeyInfo[] = entityMetadata.primaryColumns.map(column => ({
          name: column.propertyName,
          databaseName: column.databaseName,
          type: column.type as string,
          isGenerated: column.isGenerated,
          generationStrategy: column.generationStrategy as 'uuid' | 'increment' | 'rowid' | 'identity' | undefined,
        }));

        // 체크 제약조건
        const checks: CheckInfo[] = entityMetadata.checks.map(check => ({
          name: check.name,
          expression: check.expression,
        }));

        // 유니크 제약조건
        const uniques: UniqueInfo[] = entityMetadata.uniques.map(unique => ({
          name: unique.name,
          columns: unique.columns.map(column => column.databaseName),
        }));

        // 외래키
        const foreignKeys: ForeignKeyInfo[] = entityMetadata.foreignKeys.map(fk => ({
          name: fk.name,
          columns: fk.columns.map(column => column.databaseName),
          referencedTable: fk.referencedTablePath,
          referencedColumns: fk.referencedColumns.map(column => column.databaseName),
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
        }));

        return {
          entityName: entityMetadata.name,
          tableName: entityMetadata.tableName,
          schema: entityMetadata.schema,
          database: entityMetadata.database,
          targetName: (entityMetadata.target as Function).name || 'Unknown',
          primaryKeys,
          columns,
          relations,
          indices,
          checks,
          uniques,
          foreignKeys,
          // TypeORM 설정 정보
          engine: entityMetadata.engine,
          synchronize: entityMetadata.synchronize,
          withoutRowid: entityMetadata.withoutRowid,
        };
      });

      this.logger.log(`Retrieved schema information for ${modelsInfo.length} entities`);
      return crudResponse(modelsInfo);
    } catch (error) {
      this.logger.error('Failed to retrieve schema information', error);
      throw error;
    }
  }

  @Get(':entityName')
  async show(@Param('entityName') entityName: string) {
    try {
      const metadata = this.dataSource.entityMetadatas;
      const entityMetadata = metadata.find(meta =>
        meta.name.toLowerCase() === entityName.toLowerCase() ||
        meta.tableName.toLowerCase() === entityName.toLowerCase()
      );

      if (!entityMetadata) {
        throw new NotFoundException(`Entity '${entityName}' not found`);
      }

      // 상세한 컬럼 정보
      const columns: ColumnMetadata[] = entityMetadata.columns.map(column => ({
        name: column.propertyName,
        databaseName: column.databaseName,
        type: column.type as string,
        jsType: this.getJsType(column),
        isPrimary: column.isPrimary,
        isGenerated: column.isGenerated,
        generationStrategy: column.generationStrategy as 'uuid' | 'increment' | 'rowid' | 'identity' | undefined,
        isNullable: column.isNullable,
        isArray: column.isArray,
        default: column.default,
        length: column.length,
        width: column.width,
        precision: column.precision ?? undefined,
        scale: column.scale ?? undefined,
        zerofill: column.zerofill,
        unsigned: column.unsigned,
        charset: column.charset,
        collation: column.collation,
        comment: column.comment,
        enum: column.enum,
        enumName: column.enumName,
        asExpression: column.asExpression,
        generatedType: column.generatedType as 'VIRTUAL' | 'STORED' | undefined,
        // 메타데이터 정보 추가
        metadata: this.getColumnMetadata(column),
      }));

      const relations: RelationInfo[] = entityMetadata.relations.map(relation => ({
        name: relation.propertyName,
        type: relation.relationType as 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many',
        target: typeof relation.type === 'function' ? relation.type.name : String(relation.type),
        inverseSide: relation.inverseSidePropertyPath,
        isOwner: relation.isOwning,
        isLazy: relation.isLazy,
        isCascade: {
          insert: relation.isCascadeInsert || false,
          update: relation.isCascadeUpdate || false,
          remove: relation.isCascadeRemove || false,
          softRemove: relation.isCascadeSoftRemove || false,
          recover: relation.isCascadeRecover || false,
        },
        onDelete: relation.onDelete,
        onUpdate: relation.onUpdate,
        nullable: relation.isNullable,
        joinColumns: relation.joinColumns?.map(jc => ({
          name: jc.databaseName,
          referencedColumnName: jc.referencedColumn?.databaseName,
        })),
        joinTable: relation.joinTableName || null,
      }));

      const entityInfo: SchemaEntityInfo = {
        entityName: entityMetadata.name,
        tableName: entityMetadata.tableName,
        targetName: (entityMetadata.target as Function).name || 'Unknown',
        primaryKeys: entityMetadata.primaryColumns.map(column => ({
          name: column.propertyName,
          databaseName: column.databaseName,
          type: column.type as string,
          isGenerated: column.isGenerated,
          generationStrategy: column.generationStrategy as 'uuid' | 'increment' | 'rowid' | 'identity' | undefined,
        })),
        columns,
        relations,
        indices: entityMetadata.indices.map(index => ({
          name: index.name,
          columns: index.columns.map(column => column.databaseName),
          isUnique: index.isUnique,
          where: index.where,
        })),
        checks: entityMetadata.checks.map(check => ({
          name: check.name,
          expression: check.expression,
        })),
        uniques: entityMetadata.uniques.map(unique => ({
          name: unique.name,
          columns: unique.columns.map(column => column.databaseName),
        })),
        foreignKeys: entityMetadata.foreignKeys.map(fk => ({
          name: fk.name,
          columns: fk.columns.map(column => column.databaseName),
          referencedTable: fk.referencedTablePath,
          referencedColumns: fk.referencedColumns.map(column => column.databaseName),
          onDelete: fk.onDelete,
          onUpdate: fk.onUpdate,
        })),
        // CRUD 설정 정보 (실제 컨트롤러에서 추출)
        crudInfo: this.getCrudInfo(entityMetadata.name),
      };

      this.logger.log(`Retrieved detailed schema for entity: ${entityName}`);
      return crudResponse(entityInfo);
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      this.logger.error(`Failed to retrieve schema for entity: ${entityName}`, error);
      throw error;
    }
  }

  private getColumnMetadata(column: TypeORMColumnMetadata): ColumnMetadata['metadata'] {
    return {
      type: column.type as string,
      jsType: this.getJsType(column),
      isEnum: !!column.enum,
      enumValues: column.enum,
      isNullable: column.isNullable,
      isPrimary: column.isPrimary,
      isGenerated: column.isGenerated,
      length: column.length,
      default: column.default,
    };
  }

  /**
   * 데이터베이스 타입을 JavaScript 타입으로 변환합니다.
   */
  private getJsType(column: TypeORMColumnMetadata): string {
    const columnType = column.type as TypeORMColumnType;
    return JS_TYPE_MAPPING[columnType] || 'unknown';
  }

  /**
   * 엔티티의 CRUD 설정 정보를 반환합니다.
   */
  private getCrudInfo(entityName: string): CrudInfo {
    return this.crudMetadataService.getCrudInfo(entityName);
  }
} 