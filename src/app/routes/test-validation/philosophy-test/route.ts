import { ExpressRouter } from '@core/lib/expressRouter'

const router = new ExpressRouter();

// ✅ 수정됨: 소문자 사용, 복수형 리소스명
router.GET_SLUG(['users', ':id'], (req, res) => {
    const { id } = req.params;
    res.json({ message: `Get user by ID: ${id}` });
});

// ✅ 수정됨: PUT 사용하여 특정 리소스 업데이트
router.PUT_SLUG(['users', ':id'], (req, res) => {
    const { id } = req.params;
    res.json({ message: `Update user: ${id}` });
});

// ✅ 수정됨: 단순하고 명확한 네이밍, 공통 기능을 앞으로
router.GET_SLUG(['admin', 'reports', 'users'], (req, res) => {
    res.json({ message: 'Admin user reports' });
});

// ✅ 수정됨: 벌크 삭제는 별도 엔드포인트로 명시
router.DELETE_SLUG(['users'], (req, res) => {
    // Query parameter로 벌크 삭제 조건 지정
    const { bulkDelete } = req.query;
    if (bulkDelete === 'true') {
        res.json({ message: 'Delete all users' });
    } else {
        res.status(400).json({ error: 'Bulk delete requires bulkDelete=true parameter' });
    }
});

// ✅ 철학 준수: 올바른 네이밍과 RESTful 패턴
router.GET_SLUG(['users'], (req, res) => {
    res.json({ message: 'Get all users' });
});

// ✅ 철학 준수: 적절한 POST 요청
router.POST_SLUG(['users'], (req, res) => {
    res.status(201).json({ message: 'User created' });
});

// ✅ 철학 준수: 적절한 DELETE 요청 (개별 삭제)
router.DELETE_SLUG(['users', ':id'], (req, res) => {
    const { id } = req.params;
    res.status(204).send();
});

export default router.build();
