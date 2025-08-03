import { Injectable } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { SCHEMA_CONSTANTS, SECURITY_CONSTANTS } from '../constants/schema.constants';
import { CrudMetadata, CrudInfo, ControllerWrapper } from '../types/schema.types';

@Injectable()
export class CrudMetadataService {
  constructor(
    private readonly modulesContainer: ModulesContainer,
    private readonly reflector: Reflector,
  ) { }

  /**
   * 엔티티 이름으로 CRUD 정보를 추출합니다.
   */
  getCrudInfo(entityName: string): CrudInfo {
    const crudMetadata = this.extractCrudMetadata(entityName);
 
    if (!crudMetadata) {
      return {
        note: `${SECURITY_CONSTANTS.ERROR_MESSAGES.NO_CRUD_CONTROLLER}: ${entityName}`,
        availableEndpoints: [],
        isConfigured: false,
      };
    }

    return {
      isConfigured: true,
      controllerPath: crudMetadata.controllerPath,
      entityName: crudMetadata.entityName,
      allowedMethods: crudMetadata.allowedMethods,
      allowedFilters: crudMetadata.allowedFilters,
      allowedParams: crudMetadata.allowedParams,
      allowedIncludes: crudMetadata.allowedIncludes,
      routeSettings: crudMetadata.routeSettings,
      availableEndpoints: this.generateEndpoints(crudMetadata),
    };
  }

  /**
   * 엔티티 이름으로 CRUD 메타데이터를 추출합니다.
   * admin 경로의 컨트롤러는 제외하고 일반 API 컨트롤러만 처리합니다.
   */
  private extractCrudMetadata(entityName: string): CrudMetadata | null {
    const controllers = this.getAllControllers();

    for (const controller of controllers) {
      // admin 컨트롤러는 제외
      if (this.isAdminController(controller)) {
        continue;
      }

      const crudMetadata = this.findCrudMetadata(controller);

      if (crudMetadata?.entity) {
        const controllerEntityName = this.getEntityName(crudMetadata.entity);

        if (controllerEntityName.toLowerCase() === entityName.toLowerCase()) {
          return this.buildCrudMetadata(controller, crudMetadata);
        }
      }
    }

    return null;
  }

  /**
   * 컨트롤러에서 CRUD 메타데이터를 찾습니다.
   */
  private findCrudMetadata(controller: ControllerWrapper): any {
    const { METADATA_KEYS } = SCHEMA_CONSTANTS;

    // 여러 메타데이터 키를 시도
    let crudMetadata = this.reflector.get(METADATA_KEYS.CRUD_OPTIONS, controller.metatype) ||
      this.reflector.get(METADATA_KEYS.CRUD_ALT, controller.metatype) ||
      this.reflector.get(METADATA_KEYS.CRUD, controller.metatype) ||
      this.reflector.get(METADATA_KEYS.CRUD_UPPER, controller.metatype) ||
      Reflect.getMetadata(METADATA_KEYS.CRUD_OPTIONS, controller.metatype) ||
      Reflect.getMetadata(METADATA_KEYS.CRUD_ALT, controller.metatype) ||
      Reflect.getMetadata(METADATA_KEYS.CRUD, controller.metatype);

    // 메타데이터가 없으면 모든 키를 동적으로 검색
    if (!crudMetadata) {
      crudMetadata = this.findCrudMetadataDynamically(controller);
    }

    return crudMetadata;
  }

  /**
   * 동적으로 CRUD 메타데이터를 검색합니다.
   */
  private findCrudMetadataDynamically(controller: ControllerWrapper): any {
    const allKeys = Reflect.getMetadataKeys(controller.metatype);
    console.log(`Controller ${controller.metatype.name} metadata keys:`, allKeys);

    const crudKey = allKeys.find(key =>
      typeof key === 'string' &&
      key.toLowerCase().includes('crud')
    );

    if (crudKey) {
      const metadata = Reflect.getMetadata(crudKey, controller.metatype);
      console.log(`Found CRUD metadata with key "${crudKey}":`, metadata);
      return metadata;
    }

    return null;
  }

  /**
   * 엔티티 메타데이터에서 엔티티 이름을 추출합니다.
   */
  private getEntityName(entityMetadata: any): string {
    return typeof entityMetadata === 'function'
      ? entityMetadata.name
      : entityMetadata;
  }

  /**
   * CRUD 메타데이터 객체를 구성합니다.
   */
  private buildCrudMetadata(controller: ControllerWrapper, crudMetadata: any): CrudMetadata {
    const controllerPath = this.getControllerPath(controller.metatype);

    return {
      controllerName: controller.metatype.name,
      controllerPath,
      entityName: this.getEntityName(crudMetadata.entity),
      allowedMethods: crudMetadata.only || SCHEMA_CONSTANTS.DEFAULT_CRUD_METHODS,
      allowedFilters: crudMetadata.allowedFilters || [],
      allowedParams: crudMetadata.allowedParams || [],
      allowedIncludes: crudMetadata.allowedIncludes || [],
      routeSettings: crudMetadata.routes || {},
      paginationType: crudMetadata.paginationType,
      softDelete: crudMetadata.softDelete,
      logging: crudMetadata.logging,
    };
  }

  /**
   * 컨트롤러에서 경로를 추출합니다.
   */
  private getControllerPath(controllerClass: any): string {
    const { METADATA_KEYS } = SCHEMA_CONSTANTS;

    // @Controller 데코레이터에서 path 추출
    const controllerMetadata = this.reflector.get(METADATA_KEYS.CONTROLLER_PATH, controllerClass) ||
      Reflect.getMetadata(METADATA_KEYS.CONTROLLER_PATH, controllerClass) ||
      Reflect.getMetadata(METADATA_KEYS.CONTROLLER_PATH_ALT, controllerClass);

    if (controllerMetadata) {
      return controllerMetadata;
    }

    // 메타데이터에서 컨트롤러 옵션 확인
    const allKeys = Reflect.getMetadataKeys(controllerClass);
    for (const key of allKeys) {
      const metadata = Reflect.getMetadata(key, controllerClass);
      if (metadata && typeof metadata === 'object' && metadata.path) {
        return metadata.path;
      }
    }

    // 기본값: 컨트롤러 이름에서 추출
    return controllerClass.name.toLowerCase().replace('controller', '');
  }

  /**
   * 등록된 모든 컨트롤러를 반환합니다.
   */
  private getAllControllers(): ControllerWrapper[] {
    const controllers: ControllerWrapper[] = [];

    for (const module of this.modulesContainer.values()) {
      for (const controller of module.controllers.values()) {
        if (controller.metatype && this.isValidController(controller.metatype)) {
          controllers.push(controller as ControllerWrapper);
        }
      }
    }

    return controllers;
  }

  /**
   * 유효한 컨트롤러인지 확인합니다.
   */
  private isValidController(controllerClass: any): boolean {
    return controllerClass.name !== 'SchemaController';
  }

  /**
   * admin 경로의 컨트롤러인지 확인합니다.
   */
  private isAdminController(controller: ControllerWrapper): boolean {
    const controllerPath = this.getControllerPath(controller.metatype);
    const controllerName = controller.metatype.name;

    // 컨트롤러 경로가 admin으로 시작하거나 컨트롤러 이름에 Admin이 포함된 경우
    return controllerPath.startsWith('admin/') ||
      controllerPath.startsWith('admin') ||
      controllerName.includes('Admin');
  }

  /**
   * CRUD 메타데이터를 기반으로 엔드포인트를 생성합니다.
   */
  private generateEndpoints(crudMetadata: CrudMetadata): string[] {
    const basePath = crudMetadata.controllerPath ||
      crudMetadata.entityName.toLowerCase() + 's';
    const endpoints: string[] = [];
    const allowedMethods = crudMetadata.allowedMethods;

    const methodEndpointMap = {
      index: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.INDEX,
      show: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.SHOW,
      create: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.CREATE,
      update: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.UPDATE,
      destroy: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.DESTROY,
      upsert: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.UPSERT,
      recover: SCHEMA_CONSTANTS.ENDPOINT_TEMPLATES.RECOVER,
    };

    for (const method of allowedMethods) {
      const template = methodEndpointMap[method as keyof typeof methodEndpointMap];
      if (template) {
        endpoints.push(template.replace('{basePath}', basePath));
      }
    }

    return endpoints;
  }
} 