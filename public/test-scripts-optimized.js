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
});

// --- Progress UI ---
function initProgress() {
    const testCases = document.querySelectorAll('.test-case');
    testStats.total = testCases.length;
    testStats.passed = 0;
    testStats.failed = 0;
    testStats.accuracy = 0;
    updateProgress();
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
    try {
        const { method, endpoint, body, expectedStatus } = extractTestData(testCase);
        const options = { method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } };
        if (body && !['GET','HEAD'].includes(method.toUpperCase())) options.body = body;
        const res = await fetch(endpoint, options);
        const status = res.status;
        const data = await (res.headers.get('content-type')?.includes('json') ? res.json() : res.text());
        const success = (status >= 200 && status < 300) || status === expectedStatus;
        updateTestResult(testCase, success, { status, data });
        if (success) testStats.passed++; else testStats.failed++;
    } catch (e) {
        updateTestResult(testCase, false, { error: e.message });
        testStats.failed++;
    } finally {
        button.disabled = false;
        button.textContent = 'Run Test';
        button.classList.remove('running');
        updateProgress();
    }
}
function runTestFromButton(btn) { runTest(btn); }

async function runAllTests() {
    const buttons = Array.from(document.querySelectorAll('.run-test-btn')).filter(btn => btn.closest('.test-case')?.style.display !== 'none');
    if (!buttons.length) return alert('No tests found.');
    testStats.passed = 0; testStats.failed = 0; updateProgress();
    expandAll();
    for (const btn of buttons) {
        await runTest(btn);
        await new Promise(r => setTimeout(r, REQUEST_DELAY));
    }
    showTestSummary();
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
    const endpoint = btn.dataset.endpoint;
    const testDataAttr = btn.dataset.testData;
    const expectedStatus = parseInt(btn.dataset.expectedStatus) || 200;
    let body = null;
    if (!['GET','HEAD'].includes(method.toUpperCase()) && testDataAttr && testDataAttr !== 'null') {
        try {
            const parsed = JSON.parse(decodeURIComponent(testDataAttr));
            if (Object.keys(parsed).length) body = JSON.stringify(parsed);
        } catch {}
    }
    return { method, endpoint, body, expectedStatus };
}

// --- UI Helpers ---
function updateTestResult(testCase, success, result) {
    const btn = testCase.querySelector('.run-test-btn');
    const resultId = btn.dataset.resultId;
    const el = document.getElementById(resultId);
    if (!el) return;
    el.style.display = 'block';
    el.innerHTML = `<div style="margin:10px 0;padding:15px;border-left:4px solid ${success ? '#28a745' : '#dc3545'};background:${success ? '#f8fff9' : '#fff8f8'};"><div style="color:${success ? '#28a745' : '#dc3545'};font-weight:bold;margin-bottom:10px;">${success ? '✅ PASS' : '❌ FAIL'}</div>${result.error ? `<div style='color:#dc3545;'><strong>Error:</strong> ${result.error}</div>` : `<div style='margin-bottom:10px;'><strong>Status:</strong> ${result.status || 'N/A'}<br><strong>Response:</strong> <pre style='background:#f8f9fa;padding:10px;border-radius:4px;overflow:auto;max-height:200px;'>${JSON.stringify(result.data, null, 2)}</pre></div>`}</div>`;
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

// --- Search/Filter ---
function debounce(fn, wait) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), wait); };
}
function performSearch() {
    const v = document.getElementById('searchInput')?.value.toLowerCase() || '';
    document.querySelectorAll('.test-case').forEach(tc => {
        tc.style.display = tc.textContent.toLowerCase().includes(v) ? 'block' : 'none';
    });
}
function setActiveFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
    filterTestCases();
}
function filterTestCases() {
    document.querySelectorAll('.test-case').forEach(tc => {
        const method = tc.querySelector('.method')?.textContent.toLowerCase();
        tc.style.display = currentFilter === 'all' || method === currentFilter ? 'block' : 'none';
    });
}
function handleShortcuts(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runAllTests(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); document.getElementById('searchInput')?.focus(); }
}

console.log('Test scripts optimized version loaded.');
