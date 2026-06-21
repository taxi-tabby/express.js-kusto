const { execSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const isBuild = args.includes('--build');

const scriptsDir = path.join(__dirname);

// 기본 generate 스크립트 (dev용)
const baseScripts = [
    'generate-db-types.js',
    'generate-injectable-types.js',
    'generate-repository-types.js',
];

// 빌드 전용 스크립트
const buildScripts = ['generate-routes-map.js', 'build-routes.js'];

const scriptsToRun = isBuild ? [...baseScripts, ...buildScripts] : baseScripts;

console.log(`\n🚀 Running generate scripts${isBuild ? ' (build mode)' : ''}...\n`);

for (const script of scriptsToRun) {
    const scriptPath = path.join(scriptsDir, script);
    console.log(`📦 ${script}`);
    try {
        execSync(`node "${scriptPath}"`, { stdio: 'inherit' });
    } catch (_error) {
        console.error(`❌ Failed: ${script}`);
        process.exit(1);
    }
}

console.log('\n✅ All generate scripts completed!\n');
