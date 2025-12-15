const fs = require('fs');
const path = require('path');

const tmpDir = path.join(process.cwd(), 'src', 'core', 'tmp');

if (fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('🧹 Cleaned tmp directory');
} else {
    console.log('✨ tmp directory already clean');
}
