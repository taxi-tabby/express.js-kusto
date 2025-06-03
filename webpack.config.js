const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const nodeExternals = require("webpack-node-externals");

const envVariables = {}; // 필요 시 여기에 환경 변수 추가


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


module.exports = (env, argv) => {
    const mode = argv.mode || 'production';
    const isProduction = mode === 'production';
    
    loadEnvironmentVariables();
    
    return {
        mode: mode,
    entry: {
        bundle: path.resolve(__dirname, "./src/index.ts"),
    },
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "server.js",
    },    module: {
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
    ],resolve: {
        extensions: [".ts", ".js"], // .ts 파일을 인식할 수 있도록 확장자 추가
        alias: {
            '@': path.resolve(__dirname, '.'),
            '@app': path.resolve(__dirname, 'src/app'),
            '@core': path.resolve(__dirname, 'src/core'),
            '@lib': path.resolve(__dirname, 'src/core/lib'),
            '@ext': path.resolve(__dirname, 'src/core/external'),
            '@db': path.resolve(__dirname, 'src/app/db')
        }
    },plugins: [        
        new webpack.DefinePlugin({
            'process.env.NODE_ENV': JSON.stringify(mode),
            'process.env.WEBPACK_BUILD': JSON.stringify('true'),
            ...envVariables
        }),
        new CopyWebpackPlugin({
            patterns: [
                // 라우트 파일은 더 이상 복사하지 않고 가상 파일 시스템 사용
                // view 파일만 복사
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
                },
                {
                    from: 'src/core/lib/static',
                    to: 'public',
                }
            ]
        })
    ],
    target: "node",
    externalsPresets: {
        node: true,
    },    externals: [nodeExternals()],
    };
};
