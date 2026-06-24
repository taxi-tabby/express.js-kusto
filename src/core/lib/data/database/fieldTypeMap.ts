/**
 * schema.prisma 텍스트에서 모델의 필드 타입 맵을 추출하는 순수 함수.
 *
 * CRUD 배열 연산자(all/elemMatch/size)가 scalar list / Json 필드에만 적용되도록
 * 검증하는 데 쓰인다.
 *
 * 왜 런타임 데이터모델이 아니라 schema.prisma 를 파싱하나:
 *   Prisma 7 의 `client._runtimeDataModel` 필드 항목은 `{name, kind, type}` 만 담고
 *   **`isList` 를 담지 않는다**(생성된 클라이언트 어디에도 isList 가 없음). 따라서 런타임
 *   데이터모델만으로는 scalar list(`String[]`)와 일반 scalar(`String`)를 구분할 수 없다.
 *   schema.prisma 는 dev 소스 트리뿐 아니라 dist 빌드에도 복사되며(CopyWebpackPlugin),
 *   PrismaManager.getProviderForDatabase 도 같은 파일을 읽으므로 런타임에 항상 사용 가능하다.
 *   data 티어에 두어 런타임 crud 티어가 devtools 의존 없이 사용한다(one-way 규칙 준수).
 */

export interface FieldTypeInfo {
    isList: boolean;
    kind: string; // 'scalar' | 'object' (model/enum relation)
    type: string; // 'String' | 'Int' | 'Json' | <model/enum name> | ...
}

// Prisma 내장 스칼라 타입. 그 외의 base type 은 모델/enum 관계로 간주(kind: 'object').
const PRISMA_SCALARS = new Set([
    'String',
    'Boolean',
    'Int',
    'BigInt',
    'Float',
    'Decimal',
    'DateTime',
    'Json',
    'Bytes',
]);

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `schema.prisma` 텍스트에서 `modelName` 모델의 필드 타입 맵을 만든다.
 * @returns fieldName -> { isList, kind, type } 맵. 모델 블록을 못 찾으면 null
 *          (호출부는 null 이면 배열 연산자를 400 으로 거부해 존재하지 않는 Prisma 키를 방출하지 않는다).
 */
export function buildFieldTypeMapFromSchema(
    schemaContent: string,
    modelName: string,
): Map<string, FieldTypeInfo> | null {
    try {
        if (!schemaContent || !modelName) return null;
        // model <Name> { ... } 블록 추출 (필드 정의에는 중괄호가 없으므로 non-greedy 로 첫 '}' 까지).
        const blockRe = new RegExp(
            `model\\s+${escapeRegExp(modelName)}\\s*\\{([\\s\\S]*?)\\}`,
            'm',
        );
        const block = schemaContent.match(blockRe);
        if (!block) return null;

        const map = new Map<string, FieldTypeInfo>();
        for (const rawLine of block[1].split('\n')) {
            // 라인 주석 제거 후 트림
            const line = rawLine.replace(/\/\/.*$/, '').trim();
            if (!line || line.startsWith('@@')) continue; // 빈 줄 / 블록 속성 스킵
            // field 형태: <name> <Type>[]? ?  @attrs...
            const m = line.match(/^(\w+)\s+(\w+)(\[\])?/);
            if (!m) continue;
            const name = m[1];
            const baseType = m[2];
            const isList = !!m[3];
            const kind = PRISMA_SCALARS.has(baseType) ? 'scalar' : 'object';
            map.set(name, { isList, kind, type: baseType });
        }
        return map;
    } catch {
        return null;
    }
}
