import { buildFieldTypeMapFromSchema } from '@lib/data/database/fieldTypeMap';

// Prisma 7 의 런타임 데이터모델(_runtimeDataModel)은 필드에 isList 를 담지 않으므로
// (scalar list 와 일반 scalar 를 구분 불가), schema.prisma 텍스트를 파싱해 필드 타입을 얻는다.
const SCHEMA = `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model Post {
  id        String    @id @default(uuid())
  title     String
  content   String?
  authorId  String
  author    User      @relation(fields: [authorId], references: [id])
  comments  Comment[]
  tags      PostTag[]
  labels    String[] // scalar list
  meta      Json?
  scores    Int[]
  deletedAt DateTime?
}

model User {
  id   String @id
  name String
}
`;

describe('buildFieldTypeMapFromSchema', () => {
    it('scalar list(String[]) 는 isList:true, kind:scalar 로 파싱된다', () => {
        const map = buildFieldTypeMapFromSchema(SCHEMA, 'Post');
        expect(map).not.toBeNull();
        expect(map!.get('labels')).toEqual({ isList: true, kind: 'scalar', type: 'String' });
        expect(map!.get('scores')).toEqual({ isList: true, kind: 'scalar', type: 'Int' });
    });

    it('일반 scalar 필드는 isList:false 로 파싱된다', () => {
        const map = buildFieldTypeMapFromSchema(SCHEMA, 'Post');
        expect(map!.get('title')).toEqual({ isList: false, kind: 'scalar', type: 'String' });
        expect(map!.get('deletedAt')).toMatchObject({ isList: false, kind: 'scalar' });
    });

    it('Json 필드는 type:Json 으로 파싱된다', () => {
        const map = buildFieldTypeMapFromSchema(SCHEMA, 'Post');
        expect(map!.get('meta')).toMatchObject({ kind: 'scalar', type: 'Json' });
    });

    it('관계 리스트(Comment[]/PostTag[]) 는 kind:object 로 파싱된다 (scalar list 아님)', () => {
        const map = buildFieldTypeMapFromSchema(SCHEMA, 'Post');
        expect(map!.get('comments')).toEqual({ isList: true, kind: 'object', type: 'Comment' });
        expect(map!.get('tags')).toEqual({ isList: true, kind: 'object', type: 'PostTag' });
        // 단일 관계도 object
        expect(map!.get('author')).toMatchObject({ isList: false, kind: 'object', type: 'User' });
    });

    it('존재하지 않는 모델은 null 을 반환한다', () => {
        expect(buildFieldTypeMapFromSchema(SCHEMA, 'Nope')).toBeNull();
    });
});
