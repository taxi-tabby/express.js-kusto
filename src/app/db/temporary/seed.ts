import { PrismaClient } from "./client";

const prisma = new PrismaClient();

async function main() {
    console.log("🌱 Starting seed for temporary database...");

    // temporary 데이터베이스는 현재 스키마에 테이블이 정의되어 있지 않습니다.
    // 필요에 따라 임시 데이터를 추가하는 코드를 작성하세요.
    
    console.log("✅ Temporary database seeding completed (no tables defined)");
}

main()
    .catch((e) => {
        console.error("❌ Temporary database seeding failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
