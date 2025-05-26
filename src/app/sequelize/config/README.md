# RDS Connection Management in `config.json`

`config.json` 파일을 사용하여 다양한 환경과 스키마에 대한 RDS(관계형 데이터베이스 서비스) 연결을 관리하는 것은 여러 가지 장점이 있습니다:

1. **중앙 집중화**: 모든 데이터베이스 연결 정보를 한 곳에서 관리할 수 있어 유지보수가 용이합니다.
2. **환경 분리**: 개발, 테스트, 프로덕션 등 다양한 환경에 맞는 설정을 쉽게 분리할 수 있습니다.
3. **보안**: 민감한 정보(예: 사용자 이름, 비밀번호)를 코드에서 분리하여 보안성을 높일 수 있습니다.
4. **유연성**: 여러 스키마나 데이터베이스에 대한 연결을 쉽게 추가하거나 변경할 수 있습니다.

## 등록 방법

1. `config.json` 파일을 프로젝트의 적절한 위치에 생성합니다.
2. 각 환경이나 스키마에 대한 연결 정보를 JSON 형식으로 입력합니다. 예시는 다음과 같습니다:

    ```json
    {
        "foo": {
            "username": "your_username",
            "password": "your_password",
            "database": "your_database",
            "host": "your_host",
            "dialect": "postgres",
            "port": 5432,
            "schema": "product"
        },
        "bar": {
            "username": "your_username",
            "password": "your_password",
            "database": "your_database",
            "host": "your_host",
            "dialect": "postgres",
            "port": 5432,
            "schema": "admin"
        }
    }
    ```

3. 애플리케이션 코드에서 `config.json` 파일을 읽어 데이터베이스 연결을 설정합니다.

이렇게 하면 다양한 환경과 스키마에 대한 데이터베이스 연결을 효율적으로 관리할 수 있습니다.
