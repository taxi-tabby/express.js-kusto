import { PrismaClient } from './generated';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed...');

  // 사용자 생성
  const user1 = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      name: 'Admin User',
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'user@example.com' },
    update: {},
    create: {
      email: 'user@example.com',
      name: 'Regular User',
    },
  });
  // 게시글 생성
  const post1 = await prisma.post.upsert({
    where: { id: 1 },
    update: {},
    create: {
      title: 'Welcome to our platform!',
      content: 'This is the first post on our platform. Welcome everyone!',
      published: true,
      authorId: user1.id,
    }
  });

  const post2 = await prisma.post.upsert({
    where: { id: 2 },
    update: {},
    create: {
      title: 'Getting started guide',
      content: 'Here is how you can get started with our platform...',
      published: true,
      authorId: user1.id,
    }
  });

  const post3 = await prisma.post.upsert({
    where: { id: 3 },
    update: {},
    create: {
      title: 'Draft post',
      content: 'This is a draft post that is not yet published.',
      published: false,
      authorId: user2.id,
    }
  });

  console.log('✅ Database seeded successfully!');
  console.log(`Created users: ${user1.name}, ${user2.name}`);
  console.log(`Created posts: ${post1.title}, ${post2.title}, ${post3.title}`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seed failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
