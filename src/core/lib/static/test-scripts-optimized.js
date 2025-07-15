/**
 * Legacy compatibility layer for Advanced Test Engine
 * This file now imports and initializes the advanced test engine
 * while maintaining backward compatibility with existing templates
 */

// --- Advanced Test Engine Loader ---
if (!window.testEngine) {
    const script = document.createElement('script');
    script.src = '/test-engine-advanced.js';
    script.onload = () => console.log('✅ Advanced Test Engine loaded');
    document.head.appendChild(script);
}

// --- State ---
let currentFilter = 'all';
let testStats = { total: 0, passed: 0, failed: 0, accuracy: 0 };
const REQUEST_DELAY = 50;

// --- DOM Ready ---
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.addEventListener('input', debounce(performSearch, 300));
    document.querySelectorAll('.filter-btn').forEach(btn =>
        btn.addEventListener('click', () => setActiveFilter(btn.dataset.filter))
    );
    document.addEventListener('keydown', handleShortcuts);
    initProgress();
    updateFilterCounts(); // Initialize filter counts
});

// --- Progress UI ---
function initProgress() {
    const testCases = document.querySelectorAll('.test-case');
    testStats.total = testCases.length;
    testStats.passed = 0;
    testStats.failed = 0;
    testStats.accuracy = 0;
    
    // Create progress container if it doesn't exist
    createProgressContainer();
    updateProgress();
}

function createProgressContainer() {
    let progressContainer = document.getElementById('progress-container');
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'progress-container';
        progressContainer.innerHTML = `
            <div style="margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background: #f8f9fa;">
                <h3 style="margin: 0 0 15px 0;">🧪 Test Execution Progress</h3>
                <div style="position: relative; background: #e9ecef; height: 20px; border-radius: 10px; margin: 15px 0;">
                    <div id="progress-bar" style="height: 100%; background: #28a745; border-radius: 10px; width: 0%; transition: width 0.3s ease;"></div>
                    <div id="progress-text" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: bold; font-size: 12px;">0/0 tests completed</div>
                </div>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px;">
                    <div style="text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                        <span style="display: block; font-size: 12px; color: #666;">Passed:</span>
                        <span id="stat-passed" style="display: block; font-size: 18px; font-weight: bold; color: #28a745;">0</span>
                    </div>
                    <div style="text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                        <span style="display: block; font-size: 12px; color: #666;">Failed:</span>
                        <span id="stat-failed" style="display: block; font-size: 18px; font-weight: bold; color: #dc3545;">0</span>
                    </div>
                    <div style="text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                        <span style="display: block; font-size: 12px; color: #666;">Accuracy:</span>
                        <span id="stat-accuracy" style="display: block; font-size: 18px; font-weight: bold; color: #007bff;">0%</span>
                    </div>
                </div>
                <div id="test-summary" style="margin-top: 15px; padding: 15px; background: white; border-radius: 5px; display: none;">
                    <h4>📊 Test Results Summary</h4>
                    <div id="summary-details"></div>
                </div>
            </div>
        `;
        
        // Insert at the top of the page
        const container = document.querySelector('.container') || document.body;
        container.insertBefore(progressContainer, container.firstChild);
    }
}
function updateProgress() {
    const completed = testStats.passed + testStats.failed;
    testStats.accuracy = completed ? Math.round((testStats.passed / completed) * 100) : 0;
    const bar = document.getElementById('progress-bar');
    if (bar) bar.style.width = `${testStats.total ? Math.round((completed / testStats.total) * 100) : 0}%`;
    const txt = document.getElementById('progress-text');
    if (txt) txt.textContent = `${completed}/${testStats.total} tests completed`;
    const statPassed = document.getElementById('stat-passed');
    if (statPassed) statPassed.textContent = testStats.passed;
    const statFailed = document.getElementById('stat-failed');
    if (statFailed) statFailed.textContent = testStats.failed;
    const statAccuracy = document.getElementById('stat-accuracy');
    if (statAccuracy) statAccuracy.textContent = `${testStats.accuracy}%`;
}

// --- Test Execution ---
async function runTest(button) {
    const testCase = button.closest('.test-case');
    if (!testCase) return;
    button.disabled = true;
    button.textContent = 'Running...';
    button.classList.add('running');
    
    // Check if this test was already executed and adjust stats accordingly
    const previousResult = testCase.dataset.testResult;
    if (previousResult === 'passed') {
        testStats.passed = Math.max(0, testStats.passed - 1);
    } else if (previousResult === 'failed') {
        testStats.failed = Math.max(0, testStats.failed - 1);
    }
      try {
        const { method, endpoint, body, expectedStatus, acceptableStatuses } = extractTestData(testCase);
        console.log(`테스트 실행:`, { method, endpoint, body, expectedStatus, acceptableStatuses });
        
        const options = { method };
        
        // GET/HEAD 요청은 body와 Content-Type 헤더를 제거
        if (['GET', 'HEAD'].includes(method.toUpperCase())) {
            options.headers = { 'Accept': 'application/json' };
        } else {
            options.headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
            if (body) options.body = body;
        }
        
        const res = await fetch(endpoint, options);
        const status = res.status;
        const data = await (res.headers.get('content-type')?.includes('json') ? res.json() : res.text());

        // Check success based on acceptableStatuses (for security tests) or standard logic
        let success;
        if (acceptableStatuses && Array.isArray(acceptableStatuses)) {
            success = acceptableStatuses.includes(status);
        } else {
            success = (status >= 200 && status < 300) || status === expectedStatus;
        }
        
        // Store test result in data attribute for filtering
        testCase.dataset.testResult = success ? 'passed' : 'failed';
        
        updateTestResult(testCase, success, { status, data });
        if (success) testStats.passed++; else testStats.failed++;} catch (e) {
        // Store test result as failed for errors
        testCase.dataset.testResult = 'failed';
        
        updateTestResult(testCase, false, { error: e.message });
        testStats.failed++;    } finally {
        button.disabled = false;
        button.textContent = 'Run Test';
        button.classList.remove('running');
        updateProgress();
        updateFilterCounts(); // Update filter counts after test completion
    }
}
function runTestFromButton(btn) { runTest(btn); }

async function runAllTests() {
    const buttons = Array.from(document.querySelectorAll('.run-test-btn')).filter(btn => btn.closest('.test-case')?.style.display !== 'none');
    if (!buttons.length) return alert('No tests found.');
    
    // Reset stats completely for "Run All Tests"
    testStats.passed = 0; 
    testStats.failed = 0; 
    
    // Clear all previous test results
    document.querySelectorAll('.test-case').forEach(testCase => {
        delete testCase.dataset.testResult;
    });
    
    updateProgress();
    expandAll();
    for (const btn of buttons) {
        await runTest(btn);
        await new Promise(r => setTimeout(r, REQUEST_DELAY));
    }
    showTestSummary();
    updateFilterCounts(); // Update filter counts after all tests complete
}

// --- Test Data ---
function toggleTestData(testId) {
    const el = document.getElementById(`data-${testId}`);
    const icon = el?.parentElement.querySelector('.expand-icon');
    if (el) {
        const show = el.style.display !== 'block';
        el.style.display = show ? 'block' : 'none';
        if (icon) icon.textContent = show ? '▲' : '▼';
    }
}
function copyTestData(encoded) {
    try {
        const data = decodeURIComponent(encoded);
        navigator.clipboard.writeText(data).then(() => notify('📋 Test data copied!'));
    } catch { notify('Failed to copy test data', true); }
}
function extractTestData(testCase) {
    const btn = testCase.querySelector('.run-test-btn');
    const method = btn.dataset.method;
    let endpoint = btn.dataset.endpoint;
    const testDataAttr = btn.dataset.testData;
    const expectedStatus = parseInt(btn.dataset.expectedStatus) || 200;
    const acceptableStatusesAttr = btn.dataset.acceptableStatuses;
    let body = null;
    let acceptableStatuses = null;
    
    // Parse acceptable statuses if provided (for security tests)
    if (acceptableStatusesAttr && acceptableStatusesAttr !== 'null') {
        try {
            acceptableStatuses = JSON.parse(acceptableStatusesAttr);
        } catch (parseError) {
            console.warn('Failed to parse acceptable statuses:', parseError);
        }
    }
    
    if (testDataAttr && testDataAttr !== 'null' && testDataAttr !== '{}') {
        try {
            const parsed = JSON.parse(decodeURIComponent(testDataAttr));
            
            if (Object.keys(parsed).length > 0) {
                const methodUpper = method.toUpperCase();
                
                // GET/HEAD 요청의 경우 query 파라미터로 처리
                if (['GET', 'HEAD'].includes(methodUpper)) {
                    if (parsed.query) {
                        // query 객체가 있는 경우
                        const queryParams = new URLSearchParams();
                        Object.entries(parsed.query).forEach(([key, value]) => {
                            queryParams.append(key, String(value));
                        });
                        endpoint += (endpoint.includes('?') ? '&' : '?') + queryParams.toString();
                    } else {
                        // 직접 query 파라미터로 변환
                        const queryParams = new URLSearchParams();
                        Object.entries(parsed).forEach(([key, value]) => {
                            queryParams.append(key, String(value));
                        });
                        endpoint += (endpoint.includes('?') ? '&' : '?') + queryParams.toString();
                    }                } else {
                    // POST/PUT/PATCH 등의 경우 body로 처리
                    if (parsed.query) {
                        // query 객체가 있으면 query 파라미터로, 나머지는 body로
                        const queryParams = new URLSearchParams();
                        Object.entries(parsed.query).forEach(([key, value]) => {
                            queryParams.append(key, String(value));
                        });
                        endpoint += (endpoint.includes('?') ? '&' : '?') + queryParams.toString();
                        
                        // body 데이터가 있으면 body로 설정
                        const bodyData = { ...parsed };
                        delete bodyData.query;
                        if (Object.keys(bodyData).length > 0) {
                            body = JSON.stringify(bodyData);
                        }
                    } else if (parsed.body) {
                        // body 객체가 있는 경우 - body 안의 데이터를 HTTP body로 전송
                        body = JSON.stringify(parsed.body);
                    } else {
                        // 직접 body로 전송
                        body = JSON.stringify(parsed);
                    }
                }
            }
        } catch (error) {
            console.error('테스트 데이터 파싱 오류:', error);
        }
    }
    
    return { method, endpoint, body, expectedStatus, acceptableStatuses };
}

// --- UI Helpers ---
function updateTestResult(testCase, success, result) {
    const btn = testCase.querySelector('.run-test-btn');
    const resultId = btn.dataset.resultId;
    const el = document.getElementById(resultId);
    if (!el) return;
    
    // HTML 이스케이핑 함수
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
    
    el.style.display = 'block';
    
    const errorContent = result.error 
        ? `<div style='color:#dc3545;'><strong>Error:</strong> ${escapeHtml(result.error)}</div>`
        : `<div style='margin-bottom:10px;'><strong>Status:</strong> ${escapeHtml(String(result.status || 'N/A'))}<br><strong>Response:</strong> <pre style='background:#f8f9fa;padding:10px;border-radius:4px;overflow:auto;max-height:200px;'>${escapeHtml(JSON.stringify(result.data, null, 2))}</pre></div>`;
    
    el.innerHTML = `<div style="margin:10px 0;padding:15px;border-left:4px solid ${success ? '#28a745' : '#dc3545'};background:${success ? '#f8fff9' : '#fff8f8'};"><div style="color:${success ? '#28a745' : '#dc3545'};font-weight:bold;margin-bottom:10px;">${success ? '✅ PASS' : '❌ FAIL'}</div>${errorContent}</div>`;
}
function showTestSummary() {
    const el = document.getElementById('test-summary');
    const details = document.getElementById('summary-details');
    if (!el || !details) return;
    const { total, passed, failed, accuracy } = testStats;
    let emoji = accuracy >= 80 ? '🎉' : accuracy >= 60 ? '⚠️' : '❌';
    let msg = accuracy >= 80 ? 'Excellent!' : accuracy >= 60 ? 'Good progress!' : 'Needs attention!';
    details.innerHTML = `<p><strong>${emoji} ${msg}</strong></p><p>Total: <strong>${total}</strong></p><p>Passed: <strong style='color:#28a745;'>${passed}</strong></p><p>Failed: <strong style='color:#dc3545;'>${failed}</strong></p><p>Success Rate: <strong style='color:${accuracy >= 80 ? '#28a745' : accuracy >= 60 ? '#ffc107' : '#dc3545'};'>${accuracy}%</strong></p>`;
    el.style.display = 'block';
    notify(`${emoji} ${msg} ${passed}/${total} passed (${accuracy}%)`);
}
function notify(msg, error) {
    const n = document.createElement('div');
    n.style.cssText = `position:fixed;top:20px;right:20px;background:${error ? '#dc3545' : '#28a745'};color:white;padding:10px 15px;border-radius:5px;z-index:10000;font-size:14px;`;
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 2000);
}

// --- Bulk Actions ---
function expandAll() {
    document.querySelectorAll('.route-group-content,.suite-content,.data-content').forEach(el => {
        el.style.display = 'block';
        const icon = el.previousElementSibling?.querySelector('.collapse-icon, .expand-icon');
        if (icon) icon.textContent = icon.classList.contains('expand-icon') ? '▲' : '▼';
    });
}
function collapseAll() {
    document.querySelectorAll('.route-group-content,.suite-content,.data-content').forEach(el => {
        el.style.display = 'none';
        const icon = el.previousElementSibling?.querySelector('.collapse-icon, .expand-icon');
        if (icon) icon.textContent = icon.classList.contains('expand-icon') ? '▼' : '▶';
    });
}

// --- Toggle Functions for Template Compatibility ---
function toggleGroup(groupId) {
    const content = document.getElementById(groupId);
    const header = content?.previousElementSibling;
    const icon = header?.querySelector('.collapse-icon');
    
    if (content && icon) {
        const isVisible = content.style.display !== 'none';
        content.style.display = isVisible ? 'none' : 'block';
        icon.textContent = isVisible ? '▶' : '▼';
        
        // Update group container class for styling
        const group = content.closest('.route-group');
        if (group) {
            group.classList.toggle('collapsed', isVisible);
        }
    }
}

function toggleSuite(suiteId) {
    const content = document.getElementById(`suite-${suiteId}`);
    const header = content?.previousElementSibling;
    const icon = header?.querySelector('.collapse-icon');
    
    if (content && icon) {
        const isVisible = content.style.display !== 'none';
        content.style.display = isVisible ? 'none' : 'block';
        icon.textContent = isVisible ? '▶' : '▼';
    }
}

// --- Search/Filter ---
function debounce(fn, wait) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
function performSearch() {
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    let visibleCount = 0;
    
    document.querySelectorAll('.test-case').forEach(tc => {
        const textContent = tc.textContent.toLowerCase();
        const matchesSearch = !searchTerm || textContent.includes(searchTerm);
        
        // Apply both search and filter criteria
        let shouldShow = matchesSearch;
        if (shouldShow && currentFilter !== 'all') {
            const testType = tc.dataset.type?.toLowerCase();
            const testResult = tc.dataset.testResult?.toLowerCase();
            
            if (currentFilter === 'success') {
                shouldShow = testType === 'success' || testResult === 'passed';            
            } else if (currentFilter === 'failure') {
                shouldShow = testType === 'failure' || testResult === 'failed';
            } else {
                shouldShow = testType === currentFilter;
            }
        }
        
        tc.style.display = shouldShow ? 'block' : 'none';
        if (shouldShow) visibleCount++;
    });
    
    // Show/hide "no results" message
    const noResults = document.getElementById('noResults');
    if (noResults) {
        noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    }
}
function setActiveFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
    
    // Reapply search with new filter
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim()) {
        performSearch(); // This will apply both search and filter
    } else {
        filterTestCases(); // Just apply filter
    }
}
function filterTestCases() {
    let visibleCount = 0;
    
    document.querySelectorAll('.test-case').forEach(tc => {
        if (currentFilter === 'all') {
            tc.style.display = 'block';
            visibleCount++;
        } else {
            let shouldShow = false;
            
            // Filter by test type (success, failure, security) OR by test result (passed, failed)
            const testType = tc.dataset.type?.toLowerCase();
            const testResult = tc.dataset.testResult?.toLowerCase();
              if (currentFilter === 'success') {
                // Show success tests OR tests that have passed
                shouldShow = testType === 'success' || testResult === 'passed';            
            } else if (currentFilter === 'failure') {
                // Show failure tests OR tests that have failed
                shouldShow = testType === 'failure' || testResult === 'failed';
            } else if (currentFilter === 'philosophy') {
                // Show philosophy validation tests
                const testName = tc.querySelector('.test-name')?.textContent?.toLowerCase() || '';
                shouldShow = testName.includes('philosophy') || 
                           (tc.dataset.securityTestType && tc.dataset.securityTestType.includes('philosophy'));
            } else {
                // Direct test type match
                shouldShow = testType === currentFilter;
            }
            
            tc.style.display = shouldShow ? 'block' : 'none';
            if (shouldShow) visibleCount++;
        }
    });
    
    // Show/hide "no results" message
    const noResults = document.getElementById('noResults');
    if (noResults) {
        noResults.style.display = visibleCount === 0 ? 'block' : 'none';
    }
    
    console.log(`🏷️ Filter applied: ${currentFilter} (${visibleCount} tests visible)`);
}
function handleShortcuts(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAllTests(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); document.getElementById('searchInput')?.focus(); }
}

// Add real-time filter counts update
function updateFilterCounts() {
    const testCases = document.querySelectorAll('.test-case');
    const counts = {
        all: testCases.length,
        success: 0,
        failure: 0,
        security: 0
    };
    
    testCases.forEach(tc => {
        const testType = tc.dataset.type?.toLowerCase();
        if (testType === 'success') counts.success++;
        if (testType === 'failure') counts.failure++;
        if (testType === 'security') counts.security++;
    });
    
    // Update filter button labels with counts (showing only original test case counts)
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const filter = btn.dataset.filter;
        const originalText = btn.textContent.split(' (')[0]; // Remove existing count
        
        if (filter === 'all') {
            btn.textContent = `${originalText} (${counts.all})`;
        } else if (filter === 'success') {
            btn.textContent = `${originalText} (${counts.success})`;        
        } else if (filter === 'failure') {
            btn.textContent = `${originalText} (${counts.failure})`;
        } else if (filter === 'security') {
            btn.textContent = `${originalText} (${counts.security})`;
        }
    });
}

console.log('Test scripts optimized version loaded.');
