// import { ExpressRouter } from '@lib/expressRouter';

// const router = new ExpressRouter();

// // === Types ===
// interface UserRecord {
//     id: string;
//     email: string;
//     hashedPassword: string;
//     role: string;
//     isActive: boolean;
// }

// interface LoginResponse {
//     message: string;
//     token?: string;
//     refreshToken?: string;
//     isSuccess: boolean;
//     user?: {
//         id: string;
//         email: string;
//         role: string;
//     };
// }

// // === Test Data (TODO: Replace with actual database service) ===
// const TEST_USERS: UserRecord[] = [
//     {
//         id: '1',
//         email: 'admin@example.com',
//         hashedPassword: '$2b$10$XQ9lP9cqVLx8H.q4pP7W4uH7tFJ1wN5K8xP2dQ3aG6vE8wL4qR5mC', // 'password123'
//         role: 'admin',
//         isActive: true
//     },
//     {
//         id: '2',
//         email: 'user@example.com',
//         hashedPassword: '$2b$10$YR0mQ8drWMy9I.r5qQ8X5vI8uGK2xO6L9yQ3eR4bH7wF9xM5rS6nD', // 'userpass'
//         role: 'user',
//         isActive: true
//     },
//     {
//         id: '3',
//         email: 'test@example.com',
//         hashedPassword: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // 'password'
//         role: 'user',
//         isActive: true
//     }
// ];



// // === Route Handler ===
// router.POST_VALIDATED(
//     {
//         body: {
//             email: { type: 'email' },
//             password: { type: 'string', min: 1, max: 128 } // 더 유연한 패스워드 제한
//         }
//     },
//     {
//         200: {
//             message: { type: 'string' },
//             token: { type: 'string' },
//             refreshToken: { type: 'string' },
//             isSuccess: { type: 'boolean' },
//             user: {
//                 type: 'object',
//             }
//         },
//         401: {
//             message: { type: 'string' },
//             isSuccess: { type: 'boolean' }
//         },
//         403: {
//             message: { type: 'string' },
//             isSuccess: { type: 'boolean' }
//         },
//         500: {
//             message: { type: 'string' },
//             isSuccess: { type: 'boolean' }
//         }
//     },
//     async (req, res, inject, db) => {
//         try {
//             const { email, password } = req.body;
//             const jwtService = inject.authJSONWEBToken;

//             // 1. 사용자 조회
//             const user = await authService.findUserByEmail(email, db);

//             // 2. 사용자 검증
//             const userValidation = authService.validateUser(user);
//             if (!userValidation.isValid) {
//                 res.status(userValidation.statusCode!);
//                 return authService.createErrorResponse(userValidation.error!);
//             }

//             // 3. 비밀번호 검증
//             const isValidPassword = await jwtService.verifyPassword(password, user!.hashedPassword);
//             if (!isValidPassword) {
//                 res.status(401);
//                 return authService.createErrorResponse('이메일 또는 비밀번호가 올바르지 않습니다.');
//             }

//             // 4. 토큰 생성
//             const tokenPayload = authService.createTokenPayload(user!);
//             const accessToken = jwtService.generateAccessToken(tokenPayload);
//             const refreshToken = jwtService.generateRefreshToken(tokenPayload);

//             // 5. 성공 응답
//             return authService.createSuccessResponse(user!, accessToken, refreshToken);

//         } catch (error) {
//             console.error('Authentication error:', error);
//             res.status(500);
//             return authService.createErrorResponse('서버 내부 오류가 발생했습니다.');
//         }
//     }
// );

// export default router.build();


import { ExpressRouter } from '@lib/expressRouter';

const router = new ExpressRouter();



export default router.build();
