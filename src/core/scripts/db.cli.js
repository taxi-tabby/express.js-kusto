const { scripts } = require('kusto-framework-core');

// CLI에서 전달받은 인자 처리
const args = process.argv.slice(2);

if (args.length === 0) {
    console.log('Usage: npm run db -- <command> [options]');
    console.log('');
    console.log('Available commands:');
    console.log('  migrate dev [--name <name>]  - Create and apply migration');
    console.log('  migrate deploy               - Apply pending migrations');
    console.log('  migrate reset                - Reset database and migrations');
    console.log('  migrate status               - Check migration status');
    console.log('  studio                       - Open Prisma Studio');
    console.log('  generate                     - Generate Prisma Client');
    process.exit(0);
}

// Prisma CLI 실행
scripts.runDatabaseCLI(args);