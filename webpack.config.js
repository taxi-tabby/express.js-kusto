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

// // 빌드 시 환경 변수 자동 생성 함수
function getEnvironmentVariables() {
    const envVars = {};

    // process.env의 모든 환경 변수를 webpack DefinePlugin 형태로 변환
    // NODE_ENV는 제외 (webpack에서 명시적으로 설정)
    Object.keys(process.env).forEach(key => {
        if (key !== 'NODE_ENV') {
            envVars[`process.env.${key}`] = JSON.stringify(process.env[key]);
        }
    });

    return envVars;
}


module.exports = (env, argv) => {
    const mode = argv.mode || 'production';
    const isProduction = mode === 'production';

    // 환경 변수 로드
    loadEnvironmentVariables();

    // 동적으로 환경 변수 생성
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
                            configFile: "tsconfig.webpack.json"
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
                        from: 'src/core/lib/views',
                        to: 'views'
                    },
                    {
                        from: 'public',
                        to: 'public',
                    }, {
                        from: 'src/core/lib/static',
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
