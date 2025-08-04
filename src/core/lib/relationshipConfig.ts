/**
 * 관계형 데이터베이스의 관계 설정을 위한 구성 타입과 인터페이스
 */

export interface RelationshipPattern {
  /** 관계 패턴의 이름 */
  name: string;
  /** 소스 모델 패턴 (정규표현식 또는 문자열) */
  sourcePattern: string | RegExp;
  /** 관계 필드명 패턴 */
  relationPattern: string | RegExp;
  /** 중간 테이블 패턴 */
  intermediatePattern: string | RegExp;
  /** 타겟 모델을 추출하는 함수 */
  extractTarget: (relation: any, sourceModel: string) => string;
  /** 조인 테이블명을 생성하는 함수 */
  generateJoinTable: (sourceModel: string, targetModel: string, relation: any) => string;
  /** 조인 컬럼을 생성하는 함수 */
  generateJoinColumns: (sourceModel: string, targetModel: string, relation: any) => any[];
  /** 역방향 관계명을 생성하는 함수 */
  generateInverseSide: (sourceModel: string, targetModel: string, relation: any) => string;
}

export interface ManyToManyConfig {
  /** 관계 이름 */
  relationName: string;
  /** 소스 모델명 */
  sourceModel: string;
  /** 타겟 모델명 */
  targetModel: string;
  /** 중간 테이블명 */
  joinTable: string;
  /** 소스 외래키 컬럼명 */
  sourceColumn: string;
  /** 타겟 외래키 컬럼명 */
  targetColumn: string;
  /** 역방향 관계명 */
  inverseSide: string;
}

/**
 * 관계 설정을 동적으로 관리하는 클래스
 */
export class RelationshipConfigManager {
  private patterns: RelationshipPattern[] = [];
  private manyToManyConfigs: Map<string, ManyToManyConfig> = new Map();

  constructor() {
    this.initializeDefaultPatterns();
  }

  /**
   * 기본 관계 패턴들을 초기화합니다
   */
  private initializeDefaultPatterns(): void {
    // User-Role 관계 패턴
    this.addPattern({
      name: 'user-role',
      sourcePattern: /^User$/,
      relationPattern: /^roles?$/i,
      intermediatePattern: /^UserRole$/,
      extractTarget: () => 'Role',
      generateJoinTable: () => 'user_roles',
      generateJoinColumns: (sourceModel) => [
        {
          name: `${sourceModel.toLowerCase()}_id`,
          referencedColumnName: 'id'
        }
      ],
      generateInverseSide: () => 'users'
    });

    // User-Permission 관계 패턴
    this.addPattern({
      name: 'user-permission',
      sourcePattern: /^User$/,
      relationPattern: /^permissions?$/i,
      intermediatePattern: /^UserPermission$/,
      extractTarget: () => 'Permission',
      generateJoinTable: () => 'user_permissions',
      generateJoinColumns: (sourceModel) => [
        {
          name: `${sourceModel.toLowerCase()}_id`,
          referencedColumnName: 'id'
        }
      ],
      generateInverseSide: () => 'users'
    });

    // Role-Permission 관계 패턴
    this.addPattern({
      name: 'role-permission',
      sourcePattern: /^Role$/,
      relationPattern: /^permissions?$/i,
      intermediatePattern: /^RolePermission$/,
      extractTarget: () => 'Permission',
      generateJoinTable: () => 'role_permissions',
      generateJoinColumns: (sourceModel) => [
        {
          name: `${sourceModel.toLowerCase()}_id`,
          referencedColumnName: 'id'
        }
      ],
      generateInverseSide: () => 'roles'
    });

    // 일반적인 Many-to-Many 패턴
    this.addPattern({
      name: 'generic-many-to-many',
      sourcePattern: /.*/,
      relationPattern: /.*/,
      intermediatePattern: /^(\w+)(\w+)$/,
      extractTarget: (relation, sourceModel) => {
        const intermediate = relation.model;
        // 중간 테이블명에서 소스 모델명을 제거하여 타겟 모델 추출
        return intermediate.replace(sourceModel, '').replace(/^(\w)/, (match: string) => match.toUpperCase());
      },
      generateJoinTable: (sourceModel, targetModel) => 
        `${sourceModel.toLowerCase()}_${this.pluralize(targetModel.toLowerCase())}`,
      generateJoinColumns: (sourceModel) => [
        {
          name: `${sourceModel.toLowerCase()}_id`,
          referencedColumnName: 'id'
        }
      ],
      generateInverseSide: (sourceModel) => this.pluralize(sourceModel.toLowerCase())
    });
  }

  /**
   * 새로운 관계 패턴을 추가합니다
   */
  public addPattern(pattern: RelationshipPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Many-to-Many 관계 설정을 추가합니다
   */
  public addManyToManyConfig(config: ManyToManyConfig): void {
    const key = `${config.sourceModel}.${config.relationName}`;
    this.manyToManyConfigs.set(key, config);
  }

  /**
   * 관계가 Many-to-Many인지 확인합니다
   */
  public isManyToManyRelation(relation: any, sourceModel: string): boolean {
    // 직접 설정된 Many-to-Many 설정 확인
    const key = `${sourceModel}.${relation.name}`;
    if (this.manyToManyConfigs.has(key)) {
      return true;
    }

    // 패턴 매칭으로 확인
    return this.patterns.some(pattern => this.matchesPattern(pattern, relation, sourceModel));
  }

  /**
   * Many-to-Many 관계 설정을 가져옵니다
   */
  public getManyToManyConfig(relation: any, sourceModel: string): ManyToManyConfig | null {
    const key = `${sourceModel}.${relation.name}`;
    
    // 직접 설정된 설정이 있는지 확인
    if (this.manyToManyConfigs.has(key)) {
      return this.manyToManyConfigs.get(key)!;
    }

    // 패턴 매칭으로 동적 생성
    const matchingPattern = this.patterns.find(pattern => 
      this.matchesPattern(pattern, relation, sourceModel)
    );

    if (matchingPattern) {
      const targetModel = matchingPattern.extractTarget(relation, sourceModel);
      const joinTable = matchingPattern.generateJoinTable(sourceModel, targetModel, relation);
      const joinColumns = matchingPattern.generateJoinColumns(sourceModel, targetModel, relation);
      const inverseSide = matchingPattern.generateInverseSide(sourceModel, targetModel, relation);

      return {
        relationName: relation.name,
        sourceModel,
        targetModel,
        joinTable,
        sourceColumn: joinColumns[0]?.name || `${sourceModel.toLowerCase()}_id`,
        targetColumn: `${targetModel.toLowerCase()}_id`,
        inverseSide
      };
    }

    return null;
  }

  /**
   * 중간 테이블 관계인지 확인합니다
   */
  public isIntermediateTableRelation(relation: any, sourceModel: string): boolean {
    const targetModel = relation.model;
    
    // 패턴 매칭으로 중간 테이블 확인
    return this.patterns.some(pattern => {
      const sourceMatches = this.matchPattern(pattern.sourcePattern, sourceModel);
      const intermediateMatches = this.matchPattern(pattern.intermediatePattern, targetModel);
      return sourceMatches && intermediateMatches;
    });
  }

  /**
   * 실제 타겟 모델을 가져옵니다
   */
  public getActualTargetModel(relation: any, sourceModel: string): string {
    if (this.isManyToManyRelation(relation, sourceModel)) {
      const config = this.getManyToManyConfig(relation, sourceModel);
      return config?.targetModel || relation.model;
    }
    return relation.model;
  }

  /**
   * 패턴이 매치되는지 확인합니다
   */
  private matchesPattern(pattern: RelationshipPattern, relation: any, sourceModel: string): boolean {
    const sourceMatches = this.matchPattern(pattern.sourcePattern, sourceModel);
    const relationMatches = this.matchPattern(pattern.relationPattern, relation.name);
    const intermediateMatches = this.matchPattern(pattern.intermediatePattern, relation.model);
    
    return sourceMatches && relationMatches && intermediateMatches;
  }

  /**
   * 패턴 매칭을 수행합니다
   */
  private matchPattern(pattern: string | RegExp, value: string): boolean {
    if (typeof pattern === 'string') {
      return pattern === value;
    }
    return pattern.test(value);
  }

  /**
   * 단어를 복수형으로 변환합니다
   */
  private pluralize(word: string): string {
    if (word.endsWith('s') || word.endsWith('x') || word.endsWith('ch') || word.endsWith('sh')) {
      return word + 'es';
    }
    if (word.endsWith('y')) {
      return word.slice(0, -1) + 'ies';
    }
    return word + 's';
  }

  /**
   * 관계에서 역방향 이름을 생성합니다
   */
  public generateInverseSideName(relation: any, sourceModel: string): string {
    const config = this.getManyToManyConfig(relation, sourceModel);
    if (config) {
      return config.inverseSide;
    }

    // 기본 규칙으로 역방향 이름 생성
    const relationName = relation.name;
    const targetModel = relation.model;
    
    // many-to-many 관계인 경우
    if (this.isManyToManyRelation(relation, sourceModel)) {
      return this.pluralize(sourceModel.toLowerCase());
    }
    
    // one-to-many 관계인 경우
    if (relation.type === 'one-to-many') {
      return this.singularize(relationName);
    }
    
    // many-to-one 관계인 경우
    if (relation.type === 'many-to-one') {
      return this.pluralize(relationName);
    }
    
    return relationName;
  }

  /**
   * 단어를 단수형으로 변환합니다
   */
  private singularize(word: string): string {
    if (word.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    }
    if (word.endsWith('es')) {
      return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  }

  /**
   * 모든 패턴을 가져옵니다 (디버깅용)
   */
  public getAllPatterns(): RelationshipPattern[] {
    return [...this.patterns];
  }

  /**
   * 모든 Many-to-Many 설정을 가져옵니다 (디버깅용)
   */
  public getAllManyToManyConfigs(): ManyToManyConfig[] {
    return Array.from(this.manyToManyConfigs.values());
  }
}
