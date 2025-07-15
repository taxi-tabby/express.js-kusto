import { PrismaClient } from "./client";
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// 고정 사용자 데이터 (10명)
const FIXED_USERS = [
    {
        email: "test@asd.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS", // 'password'
        firstName: "Test",
        lastName: "User",
        username: "testuser",
        isActive: true,
        isVerified: true,
        isSuspended: false,
    },
    {
        email: "admin@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Admin",
        lastName: "User",
        username: "admin",
        isActive: true,
        isVerified: true,
        isSuspended: false,
    },
    {
        email: "john.doe@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "John",
        lastName: "Doe",
        username: "johndoe",
        isActive: true,
        isVerified: true,
        isSuspended: false,
    },
    {
        email: "jane.smith@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Jane",
        lastName: "Smith",
        username: "janesmith",
        isActive: true,
        isVerified: true,
        isSuspended: false,
    },
    {
        email: "bob.wilson@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Bob",
        lastName: "Wilson",
        username: "bobwilson",
        isActive: true,
        isVerified: false,
        isSuspended: false,
    },
    {
        email: "alice.brown@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Alice",
        lastName: "Brown",
        username: "alicebrown",
        isActive: true,
        isVerified: true,
        isSuspended: false,
    },
    {
        email: "charlie.davis@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Charlie",
        lastName: "Davis",
        username: "charliedavis",
        isActive: false,
        isVerified: true,
        isSuspended: false,
    },
    {
        email: "diana.evans@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Diana",
        lastName: "Evans",
        username: "dianaevans",
        isActive: true,
        isVerified: true,
        isSuspended: true,
    },
    {
        email: "frank.miller@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Frank",
        lastName: "Miller",
        username: "frankmiller",
        isActive: true,
        isVerified: false,
        isSuspended: false,
    },
    {
        email: "grace.taylor@example.com",
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS",
        firstName: "Grace",
        lastName: "Taylor",
        username: "gracetaylor",
        isActive: true,
        isVerified: true,
        isSuspended: false,
    }
];

// 랜덤 이름 생성용 데이터 (100만명 대응, 더 많은 이름 추가)
const FIRST_NAMES = [
    'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
    'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
    'Thomas', 'Sarah', 'Christopher', 'Karen', 'Charles', 'Nancy', 'Daniel', 'Lisa',
    'Matthew', 'Betty', 'Anthony', 'Helen', 'Mark', 'Sandra', 'Donald', 'Donna',
    'Steven', 'Carol', 'Paul', 'Ruth', 'Andrew', 'Sharon', 'Joshua', 'Michelle',
    'Kenneth', 'Laura', 'Kevin', 'Kimberly', 'George', 'Deborah', 'Timothy', 'Dorothy',
    'Ronald', 'Jason', 'Edward', 'Brian', 'Angela', 'Melissa', 'Brenda', 'Amy',
    'Gregory', 'Joshua', 'Jerry', 'Dennis', 'Walter', 'Patrick', 'Peter', 'Harold',
    'Douglas', 'Henry', 'Carl', 'Arthur', 'Ryan', 'Roger', 'Joe', 'Juan', 'Jack',
    'Albert', 'Jonathan', 'Justin', 'Terry', 'Gerald', 'Keith', 'Samuel', 'Willie',
    'Ralph', 'Lawrence', 'Nicholas', 'Roy', 'Benjamin', 'Bruce', 'Brandon', 'Adam',
    'Harry', 'Fred', 'Wayne', 'Billy', 'Steve', 'Louis', 'Jeremy', 'Aaron', 'Randy',
    'Howard', 'Eugene', 'Carlos', 'Russell', 'Bobby', 'Victor', 'Martin', 'Ernest',
    'Phillip', 'Todd', 'Jesse', 'Craig', 'Alan', 'Shawn', 'Clarence', 'Sean', 'Philip',
    'Chris', 'Johnny', 'Earl', 'Jimmy', 'Antonio', 'Danny', 'Bryan', 'Tony', 'Luis',
    'Mike', 'Stanley', 'Leonard', 'Nathan', 'Dale', 'Manuel', 'Rodney', 'Curtis',
    'Norman', 'Allen', 'Marvin', 'Vincent', 'Glenn', 'Jeffery', 'Travis', 'Jeff',
    'Chad', 'Jacob', 'Lee', 'Melvin', 'Alfred', 'Kyle', 'Francis', 'Bradley', 'Jesus',
    'Herbert', 'Frederick', 'Ray', 'Joel', 'Edwin', 'Don', 'Eddie', 'Ricky', 'Troy',
    'Randall', 'Barry', 'Alexander', 'Bernard', 'Mario', 'Leroy', 'Francisco', 'Marcus',
    'Micheal', 'Theodore', 'Clifford', 'Miguel', 'Oscar', 'Jay', 'Jim', 'Tom', 'Calvin',
    'Alex', 'Jon', 'Ronnie', 'Bill', 'Lloyd', 'Tommy', 'Leon', 'Derek', 'Warren',
    'Darrell', 'Jerome', 'Floyd', 'Leo', 'Alvin', 'Tim', 'Wesley', 'Gordon', 'Dean',
    'Greg', 'Jorge', 'Dustin', 'Pedro', 'Derrick', 'Dan', 'Lewis', 'Zachary', 'Corey',
    'Herman', 'Maurice', 'Vernon', 'Roberto', 'Clyde', 'Glen', 'Hector', 'Shane',
    'Ricardo', 'Sam', 'Rick', 'Lester', 'Brent', 'Ramon', 'Charlie', 'Tyler', 'Gilbert',
    'Gene', 'Marc', 'Reginald', 'Ruben', 'Brett', 'Angel', 'Nathaniel', 'Rafael', 'Leslie',
    'Edgar', 'Milton', 'Raul', 'Ben', 'Chester', 'Cecil', 'Duane', 'Franklin', 'Andre',
    // 여성 이름 추가
    'Emily', 'Emma', 'Olivia', 'Ava', 'Sophia', 'Isabella', 'Mia', 'Charlotte', 'Amelia',
    'Harper', 'Evelyn', 'Abigail', 'Emily', 'Ella', 'Elizabeth', 'Camila', 'Luna', 'Sofia',
    'Avery', 'Mila', 'Aria', 'Scarlett', 'Penelope', 'Layla', 'Chloe', 'Victoria', 'Madison',
    'Eleanor', 'Grace', 'Nora', 'Riley', 'Zoey', 'Hannah', 'Hazel', 'Lily', 'Ellie', 'Violet',
    'Lillian', 'Zoe', 'Stella', 'Aurora', 'Natalie', 'Emilia', 'Everly', 'Leah', 'Aubrey',
    'Willow', 'Addison', 'Lucy', 'Audrey', 'Bella', 'Nova', 'Brooklyn', 'Paisley', 'Savannah',
    'Claire', 'Skylar', 'Isla', 'Genesis', 'Naomi', 'Elena', 'Caroline', 'Eliana', 'Anna',
    'Maya', 'Valentina', 'Ruby', 'Kennedy', 'Ivy', 'Ariana', 'Aaliyah', 'Cora', 'Madelyn',
    'Alice', 'Kinsley', 'Hailey', 'Gabriella', 'Allison', 'Gianna', 'Serenity', 'Samantha',
    'Sarah', 'Autumn', 'Quinn', 'Eva', 'Piper', 'Sophie', 'Sadie', 'Delilah', 'Josephine',
    'Nevaeh', 'Adeline', 'Arya', 'Emery', 'Lydia', 'Clara', 'Vivian', 'Madeline', 'Peyton',
    'Julia', 'Rylee', 'Brielle', 'Reagan', 'Natalia', 'Jade', 'Athena', 'Maria', 'Leilani',
    'Everleigh', 'Liliana', 'Melanie', 'Maya', 'Isabelle', 'Julia', 'Valeria', 'Eliza',
    // ... 필요시 더 추가
];

const LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
    'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
    'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
    'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill',
    'Flores', 'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell',
    'Mitchell', 'Carter', 'Roberts', 'Gomez', 'Phillips', 'Evans', 'Turner', 'Diaz',
    'Parker', 'Cruz', 'Edwards', 'Collins', 'Reyes', 'Stewart', 'Morris', 'Morales',
    'Murphy', 'Cook', 'Rogers', 'Gutierrez', 'Ortiz', 'Morgan', 'Cooper', 'Peterson',
    'Bailey', 'Reed', 'Kelly', 'Howard', 'Ramos', 'Kim', 'Cox', 'Ward', 'Richardson',
    'Watson', 'Brooks', 'Chavez', 'Wood', 'James', 'Bennett', 'Gray', 'Mendoza',
    'Ruiz', 'Hughes', 'Price', 'Alvarez', 'Castillo', 'Sanders', 'Patel', 'Myers',
    'Long', 'Ross', 'Foster', 'Jimenez', 'Powell', 'Jenkins', 'Perry', 'Russell',
    'Sullivan', 'Bell', 'Coleman', 'Butler', 'Henderson', 'Barnes', 'Gonzales',
    'Fisher', 'Vasquez', 'Simmons', 'Romero', 'Jordan', 'Patterson', 'Alexander',
    'Hamilton', 'Graham', 'Reynolds', 'Griffin', 'Wallace', 'Moreno', 'West',
    'Cole', 'Hayes', 'Bryant', 'Herrera', 'Gibson', 'Ellis', 'Tran', 'Medina',
    'Aguilar', 'Stevens', 'Murray', 'Ford', 'Castro', 'Marshall', 'Owens', 'Harrison',
    'Fernandez', 'Mcdonald', 'Woods', 'Washington', 'Kennedy', 'Wells', 'Vargas',
    'Henry', 'Chen', 'Freeman', 'Webb', 'Tucker', 'Guzman', 'Burns', 'Crawford',
    'Olson', 'Simpson', 'Porter', 'Hunter', 'Gordon', 'Mendez', 'Silva', 'Shaw',
    'Snyder', 'Mason', 'Dixon', 'Munoz', 'Hunt', 'Hicks', 'Holmes', 'Palmer',
    'Wagner', 'Black', 'Robertson', 'Boyd', 'Rose', 'Stone', 'Salazar', 'Fox',
    'Warren', 'Mills', 'Meyer', 'Rice', 'Schmidt', 'Garza', 'Daniels', 'Ferguson',
    'Nichols', 'Stephens', 'Soto', 'Weaver', 'Ryan', 'Gardner', 'Payne', 'Grant',
    'Dunn', 'Kelley', 'Spencer', 'Hawkins', 'Arnold', 'Pierce', 'Vazquez', 'Hansen',
    'Peters', 'Santos', 'Hart', 'Bradley', 'Knight', 'Elliott', 'Cunningham',
    'Duncan', 'Armstrong', 'Hudson', 'Carroll', 'Lane', 'Riley', 'Andrews', 'Alvarado',
    'Ray', 'Delgado', 'Berry', 'Perkins', 'Hoffman', 'Johnston', 'Matthews', 'Pena',
    'Richards', 'Contreras', 'Willis', 'Carpenter', 'Lawrence', 'Sandoval', 'Guerrero',
    // ... 필요시 더 추가
];

// 랜덤 사용자 생성 함수
function generateRandomUser(index: number) {
    const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    const username = `${firstName.toLowerCase()}${lastName.toLowerCase()}${index}`;
    const email = `${username}@example.com`;
    
    return {
        email,
        passwordHash: "$2a$12$BNgSJejJythAgoZVNUc4vuUYDL2lOzbZb9b163MW3H9/hKYswHiKS", // 'password'
        firstName,
        lastName,
        username,
        isActive: Math.random() > 0.1, // 90% 활성
        isVerified: Math.random() > 0.2, // 80% 인증됨
        isSuspended: Math.random() < 0.05, // 5% 정지
    };
}

async function seedFixedUsers() {
    console.log('🌱 Creating fixed users...');
    
    for (const userData of FIXED_USERS) {
        const user = await prisma.user.upsert({
            create: userData,
            where: { email: userData.email },
            update: {}
        });
        console.log(`✅ Fixed user created/updated: ${user.email}`);
    }
}

async function seedRandomUsers(length: number = 100) {
    console.log('🌱 Creating random users...');
    
    const randomUsers = [];
    for (let i = 1; i <= length; i++) {
        randomUsers.push(generateRandomUser(i));
    }
    
    // 배치로 생성 (성능 최적화)
    const batchSize = 10;
    for (let i = 0; i < randomUsers.length; i += batchSize) {
        const batch = randomUsers.slice(i, i + batchSize);
        
        await Promise.all(
            batch.map(userData =>
                prisma.user.upsert({
                    create: userData,
                    where: { email: userData.email },
                    update: {}
                })
            )
        );
    }
}

async function main() {
    console.log('🌱 Starting user database seeding...');

    // 고정 사용자 생성
    await seedFixedUsers();
    
    // 랜덤 사용자 생성
    await seedRandomUsers(500);
    
    // 통계 출력
    const totalUsers = await prisma.user.count();
    const activeUsers = await prisma.user.count({ where: { isActive: true } });
    const verifiedUsers = await prisma.user.count({ where: { isVerified: true } });
    const suspendedUsers = await prisma.user.count({ where: { isSuspended: true } });
    
    console.log('📊 User Statistics:');
    console.log(`   Total Users: ${totalUsers}`);
    console.log(`   Active Users: ${activeUsers}`);
    console.log(`   Verified Users: ${verifiedUsers}`);
    console.log(`   Suspended Users: ${suspendedUsers}`);
    
    console.log('🌱 User database seeding completed!');
}

main()
    .then(async () => {
        console.log('🎉 Seeding process finished successfully');
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error('❌ Seeding failed:', e);
        await prisma.$disconnect();
        process.exit(1);
    });