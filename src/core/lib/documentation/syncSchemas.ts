import { PrismaSchemaAnalyzer } from '@lib/prismaSchemaAnalyzer';
import { PrismaModelInfo } from '@lib/crudSchemaTypes';
import { DocumentationGenerator } from '@lib/documentationGenerator';
import { jsonApiResource, jsonApiAttributes, jsonApiRelationships, jsonApiErrorObject } from './jsonApiSchemas';
import { enumToOpenApi } from './dmmfToOpenApi';
import { log } from '@ext/winston';

/**
 * 분석기 1개 → 모든 model 의 JSON:API 3변형 + enum 들을
 * DocumentationGenerator.registerSchema 로 등록.
 *
 * AUTO_DOCS off / production 에서는 즉시 return.
 */
export function syncSchemasFromAnalyzer(analyzer: PrismaSchemaAnalyzer, databaseName: string): void {
    if (!isEnabled()) return;

    const models = analyzer.getAllModels();
    const enumValuesByName = collectEnumValues(analyzer, models);

    for (const enumName of enumValuesByName.keys()) {
        const values = enumValuesByName.get(enumName)!;
        DocumentationGenerator.registerSchema(enumName, enumToOpenApi(enumName, values));
    }

    for (const model of models) {
        DocumentationGenerator.registerSchema(model.name, jsonApiResource(model, enumValuesByName));
        DocumentationGenerator.registerSchema(`${model.name}Attributes`, jsonApiAttributes(model, enumValuesByName));
        DocumentationGenerator.registerSchema(`${model.name}Relationships`, jsonApiRelationships(model));
    }

    log.Debug('Documentation schemas synced', {
        databaseName,
        modelCount: models.length,
        enumCount: enumValuesByName.size,
    });
}

/**
 * 공통 JSON:API errors[] 응답 본문 schema 등록.
 * Idempotent — 여러 번 호출해도 같은 내용 덮어쓰기.
 */
export function registerJsonApiErrorSchema(): void {
    if (!isEnabled()) return;
    DocumentationGenerator.registerSchema('JsonApiError', jsonApiErrorObject());
}

function isEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.AUTO_DOCS === 'true';
}

function collectEnumValues(analyzer: PrismaSchemaAnalyzer, models: PrismaModelInfo[]): Map<string, string[]> {
    const map = new Map<string, string[]>();

    for (const model of models) {
        for (const field of model.fields) {
            if (analyzer.isEnumType(field.type) && !map.has(field.type)) {
                const values = analyzer.getEnumValues(field.type);
                if (Array.isArray(values) && values.length > 0) {
                    map.set(field.type, values);
                }
            }
        }
    }
    return map;
}
