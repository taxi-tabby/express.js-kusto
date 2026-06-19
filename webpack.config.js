const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const nodeExternals = require("webpack-node-externals");
const { config } = require('dotenv');
const fs = require('fs');

// 환경 변수 로딩 함수
function loadEnvironmentVariables() {
    // 기본 .env 파일 로드
    const defaultEnvPath = path.resolve(__dirname, '.env');
    if (fs.existsSync(defaultEnvPath)) {
        config({ path: defaultEnvPath });
    }

    // NODE_ENV 기반 환경별 파일 로드
    const nodeEnv = process.env.NODE_ENV || 'development';
    let envSpecificPath = null;

    if (nodeEnv === 'development') {
        envSpecificPath = path.resolve(__dirname, '.env.dev');
    } else if (nodeEnv === 'production') {
        envSpecificPath = path.resolve(__dirname, '.env.prod');
    }
    if (envSpecificPath && fs.existsSync(envSpecificPath)) {
        config({ path: envSpecificPath, override: true });
    }
}

// 빌드 시 번들에 정적으로 주입할 환경 변수 allowlist.
// 주의: 시크릿(DB URL, API 키 등)은 절대 여기에 추가하지 말 것 —
// 런타임에 EnvironmentLoader(dotenv)가 .env 에서 읽으므로 번들에 박을 필요가 없다.
// process.env 전체를 DefinePlugin 에 넣으면 빌드 셸의 모든 시크릿이
// dist/server.js 에 평문으로 박히는 유출 사고가 발생한다.
const BUILD_TIME_ENV_ALLOWLIST = [];

function getEnvironmentVariables() {
    const envVars = {};
    BUILD_TIME_ENV_ALLOWLIST.forEach(key => {
        if (process.env[key] !== undefined) {
            envVars[`process.env.${key}`] = JSON.stringify(process.env[key]);
        }
    });
    return envVars;
}


module.exports = (env, argv) => {
    const mode = argv.mode || 'production';
    const isProduction = mode === 'production';

    // 빌드 타임에 번들로 주입할 allowlist 키가 있을 때만 .env 를 로드한다.
    // (allowlist 가 비어 있으면 번들에 박을 env 가 없으므로 dotenv 로딩 자체가 불필요)
    if (BUILD_TIME_ENV_ALLOWLIST.length) {
        loadEnvironmentVariables();
    }

    // 동적으로 환경 변수 생성 (allowlist 비어 있으면 {})
    const envVariables = getEnvironmentVariables();

    return {
        mode: mode,
        entry: {
            bundle: path.resolve(__dirname, "./src/index.ts"),
        },
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "server.js",
        }, module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: "ts-loader",
                        options: {
                            configFile: "tsconfig.webpack.json",
                            // 타입 검사는 build 스크립트의 `npm run typecheck`(tsc --noEmit)가 단독으로 수행.
                            // 여기서는 transpile 만 하여 전체 프로젝트 이중 타입체크(빌드 2배 시간)를 피한다.
                            transpileOnly: true
                        }
                    },
                    exclude: /node_modules/,
                },
            ],
        },
        ignoreWarnings: [
            /Critical dependency: the request of a dependency is an expression/,
            /require function is used in a way in which dependencies cannot be statically extracted/
        ], resolve: {
            extensions: [".ts", ".js"], // .ts 파일을 인식할 수 있도록 확장자 추가
            alias: {
                '@': path.resolve(__dirname, '.'),
                '@app': path.resolve(__dirname, 'src/app'),
                '@core': path.resolve(__dirname, 'src/core'),
                '@lib': path.resolve(__dirname, 'src/core/lib'),
                '@ext': path.resolve(__dirname, 'src/core/external'),
                '@db': path.resolve(__dirname, 'src/app/db')
            }
        }, plugins: [
            new webpack.DefinePlugin({
                'process.env.NODE_ENV': JSON.stringify(mode),
                'process.env.WEBPACK_BUILD': JSON.stringify('true'),
                ...envVariables
            }),
            new CopyWebpackPlugin({
                patterns: [
                    // view 파일들 복사
                    {
                        from: 'src/app/views',
                        to: 'views'
                    },
                    {
                        from: 'public',
                        to: 'public',
                    },
                    
                    // Prisma 클라이언트 파일들 복사
                    {
                        from: 'src/app/db/**/client/**',
                        to: ({ context, absoluteFilename }) => {
                            const relativePath = path.relative(context, absoluteFilename);
                            return relativePath;
                        },
                        globOptions: {
                            ignore: ['**/node_modules/**']
                        }
                    },
                    
                    // Prisma 스키마 파일들 복사
                    {
                        from: 'src/app/db/**/schema.prisma',
                        to: ({ context, absoluteFilename }) => {
                            const relativePath = path.relative(context, absoluteFilename);
                            return relativePath;
                        }
                    }
                ]
            })
        ],
        target: "node",
        externalsPresets: {
            node: true,
        },
        externals: [
            nodeExternals({})
        ],
    };
};
