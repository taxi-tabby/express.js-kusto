const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const nodeExternals = require("webpack-node-externals");

const isProduction = process.env.NODE_ENV === "production";
const envVariables = {}; // 필요 시 여기에 환경 변수 추가

module.exports = {
    mode: "production",
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
            'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
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
                }
            ]
        })
    ],
    target: "node",
    externalsPresets: {
        node: true,
    },
    externals: [nodeExternals()],
};
