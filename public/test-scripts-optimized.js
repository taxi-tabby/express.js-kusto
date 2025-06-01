// Test Report JavaScript Functions - Optimized Version

let currentFilter = 'all';

// Test execution tracking
let testExecutionStats = {
    total: 0,
    current: 0,
    passed: 0,
    failed: 0,
    accuracy: 0
};

// Performance optimization
let requestQueue = [];
let isProcessingQueue = false;
const MAX_CONCURRENT_REQUESTS = 5;
const REQUEST_DELAY = 50; // ms between requests

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.getElementById('searchInput');
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    // Search functionality
    if (searchInput) {
        searchInput.addEventListener('input', debounce(performSearch, 300));
    }
    
    // Filter buttons
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            setActiveFilter(this.dataset.filter);
        });
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Initialize progress tracking
    initializeProgressTracking();
    
    // Add failed tests filter button if not exists
    addFailedTestsFilter();
});

// Initialize progress tracking display - UNIFIED VERSION
function initializeProgressTracking() {
    // Count test cases
    const testCases = document.querySelectorAll('.test-case');
    testExecutionStats.total = testCases.length;
    testExecutionStats.current = 0;
    testExecutionStats.passed = 0;
    testExecutionStats.failed = 0;
    testExecutionStats.accuracy = 0;
    
    // Create progress container if it doesn't exist
    let progressContainer = document.getElementById('progress-container');
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'progress-container';
        progressContainer.className = 'progress-container';
        progressContainer.style.cssText = `
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin: 20px 0;
            padding: 20px;
            border: 1px solid #ddd;
            border-radius: 8px;
            background: #f8f9fa;
        `;
        
        progressContainer.innerHTML = `
            <div class="progress-header">
                <h3>🧪 Test Execution Progress</h3>
                <button id="toggle-failed-only" class="btn btn-secondary" onclick="toggleFailedTestsOnly()">
                    Show Failed Tests Only
                </button>
            </div>
            <div class="progress-bar-container" style="position: relative; background: #e9ecef; height: 20px; border-radius: 10px; margin: 15px 0;">
                <div id="progress-bar" class="progress-bar" style="height: 100%; background: #28a745; border-radius: 10px; width: 0%; transition: width 0.3s ease;"></div>
                <div id="progress-text" class="progress-text" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-weight: bold; font-size: 12px;">0/0 tests completed</div>
            </div>
            <div class="stats-container" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-top: 15px;">
                <div class="stat-item" style="text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                    <span class="stat-label" style="display: block; font-size: 12px; color: #666;">Passed:</span>
                    <span id="stat-passed" class="stat-value stat-passed" style="display: block; font-size: 18px; font-weight: bold; color: #28a745;">0</span>
                </div>
                <div class="stat-item" style="text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                    <span class="stat-label" style="display: block; font-size: 12px; color: #666;">Failed:</span>
                    <span id="stat-failed" class="stat-value stat-failed" style="display: block; font-size: 18px; font-weight: bold; color: #dc3545;">0</span>
                </div>
                <div class="stat-item" style="text-align: center; padding: 10px; border: 1px solid #ddd; border-radius: 5px;">
                    <span class="stat-label" style="display: block; font-size: 12px; color: #666;">Accuracy:</span>
                    <span id="stat-accuracy" class="stat-value" style="display: block; font-size: 18px; font-weight: bold; color: #007bff;">0%</span>
                </div>
            </div>
            <div id="test-summary" class="test-summary" style="margin-top: 15px; padding: 15px; background: white; border-radius: 5px; display: none;">
                <h4>📊 Test Results Summary</h4>
                <div id="summary-details"></div>
            </div>
        `;
        
        // Insert after filter controls or at the top
        const filterControls = document.querySelector('.filter-controls');
        if (filterControls) {
            filterControls.parentNode.insertBefore(progressContainer, filterControls.nextSibling);
        } else {
            const container = document.querySelector('.container') || document.body;
            const firstChild = container.firstChild;
            container.insertBefore(progressContainer, firstChild);
        }
    }
    
    // Force visibility
    progressContainer.style.display = 'block';
    progressContainer.style.visibility = 'visible';
    progressContainer.style.opacity = '1';
    
    // Initialize display
    updateProgressDisplay();
}

// Update progress display - UNIFIED VERSION
function updateProgressDisplay() {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const statPassed = document.getElementById('stat-passed');
    const statFailed = document.getElementById('stat-failed');
    const statAccuracy = document.getElementById('stat-accuracy');
    
    if (!progressContainer) {
        console.warn('Progress container not found');
        return;
    }
    
    // Force visibility
    progressContainer.style.display = 'block';
    progressContainer.style.visibility = 'visible';
    progressContainer.style.opacity = '1';
    
    const { total, current, passed, failed } = testExecutionStats;
    const completed = passed + failed;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;
    const accuracy = completed > 0 ? Math.round((passed / completed) * 100) : 0;
    
    // Update testExecutionStats
    testExecutionStats.current = completed;
    testExecutionStats.accuracy = accuracy;
    
    // Update progress bar
    if (progressBar) {
        progressBar.style.width = `${progressPercent}%`;
        
        // Color based on accuracy
        if (accuracy >= 80) {
            progressBar.style.background = 'linear-gradient(90deg, #28a745 0%, #20c997 100%)';
        } else if (accuracy >= 60) {
            progressBar.style.background = 'linear-gradient(90deg, #ffc107 0%, #fd7e14 100%)';
        } else {
            progressBar.style.background = 'linear-gradient(90deg, #dc3545 0%, #e83e8c 100%)';
        }
    }
    
    // Update text
    if (progressText) {
        progressText.textContent = `${completed}/${total} tests completed`;
    }
    
    // Update stats
    if (statPassed) statPassed.textContent = passed;
    if (statFailed) statFailed.textContent = failed;
    if (statAccuracy) {
        statAccuracy.textContent = `${accuracy}%`;
        const color = accuracy >= 80 ? '#28a745' : accuracy >= 60 ? '#ffc107' : '#dc3545';
        statAccuracy.style.color = color;
    }
    
    // Show summary when tests are complete
    if (completed >= total && total > 0) {
        showTestSummary();
    }
}

// Show test summary
function showTestSummary() {
    const testSummary = document.getElementById('test-summary');
    const summaryDetails = document.getElementById('summary-details');
    
    if (testSummary && summaryDetails) {
        const { total, passed, failed, accuracy } = testExecutionStats;
        
        let emoji = accuracy >= 80 ? '🎉' : accuracy >= 60 ? '⚠️' : '❌';
        let message = accuracy >= 80 ? 'Excellent!' : accuracy >= 60 ? 'Good progress!' : 'Needs attention!';
        
        summaryDetails.innerHTML = `
            <p><strong>${emoji} ${message}</strong></p>
            <p>Total Tests: <strong>${total}</strong></p>
            <p>Passed: <strong style="color: #28a745;">${passed}</strong></p>
            <p>Failed: <strong style="color: #dc3545;">${failed}</strong></p>
            <p>Success Rate: <strong style="color: ${accuracy >= 80 ? '#28a745' : accuracy >= 60 ? '#ffc107' : '#dc3545'};">${accuracy}%</strong></p>
        `;
        
        testSummary.style.display = 'block';
        
        // Show notification
        showTestCompletionNotification();
    }
}

// Show completion notification
function showTestCompletionNotification() {
    const { passed, failed, accuracy } = testExecutionStats;
    const total = passed + failed;
    
    let message, bgColor;
    if (accuracy >= 80) {
        message = `🎉 Excellent! ${passed}/${total} tests passed (${accuracy}% accuracy)`;
        bgColor = '#28a745';
    } else if (accuracy >= 60) {
        message = `⚠️ Good progress! ${passed}/${total} tests passed (${accuracy}% accuracy)`;
        bgColor = '#ffc107';
    } else {
        message = `❌ Needs attention! ${passed}/${total} tests passed (${accuracy}% accuracy)`;
        bgColor = '#dc3545';
    }
    
    // Create notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${bgColor};
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        font-weight: bold;
        max-width: 300px;
        animation: slideIn 0.3s ease-out;
    `;
    
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out forwards';
        setTimeout(() => notification.remove(), 300);
    }, 5000);
}

// Optimized HTTP request queue system
function addToRequestQueue(requestFunction) {
    return new Promise((resolve, reject) => {
        requestQueue.push({ requestFunction, resolve, reject });
        processRequestQueue();
    });
}

async function processRequestQueue() {
    if (isProcessingQueue || requestQueue.length === 0) return;
    
    isProcessingQueue = true;
    const activeBatches = [];
    
    while (requestQueue.length > 0 || activeBatches.length > 0) {
        // Start new requests up to the concurrent limit
        while (activeBatches.length < MAX_CONCURRENT_REQUESTS && requestQueue.length > 0) {
            const { requestFunction, resolve, reject } = requestQueue.shift();
            
            const batchPromise = (async () => {
                try {
                    const result = await requestFunction();
                    resolve(result);
                    return result;
                } catch (error) {
                    reject(error);
                    throw error;
                } finally {
                    // Add delay between requests to prevent overwhelming the server
                    if (requestQueue.length > 0 || activeBatches.length > 1) {
                        await new Promise(resolve => setTimeout(resolve, REQUEST_DELAY));
                    }
                }
            })();
            
            activeBatches.push(batchPromise);
        }
        
        // Wait for at least one batch to complete
        if (activeBatches.length > 0) {
            try {
                await Promise.race(activeBatches);
            } catch (error) {
                console.warn('Request batch error:', error);
            }
            
            // Remove completed batches
            for (let i = activeBatches.length - 1; i >= 0; i--) {
                const batch = activeBatches[i];
                const isCompleted = await Promise.race([
                    batch.then(() => true, () => true),
                    new Promise(resolve => setTimeout(() => resolve(false), 0))
                ]);
                
                if (isCompleted) {
                    activeBatches.splice(i, 1);
                }
            }
        }
    }
    
    isProcessingQueue = false;
}

// Optimized HTTP request function
async function makeOptimizedRequest(url, options = {}) {
    const requestFunction = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            throw error;
        }
    };
    
    return addToRequestQueue(requestFunction);
}

// Enhanced test running functions
async function runTest(button) {
    if (!button || typeof button.closest !== 'function') {
        console.error('Invalid button element provided to runTest');
        return;
    }
    
    const testCase = button.closest('.test-case');
    if (!testCase) {
        console.error('Test case container not found');
        return;
    }
    
    try {
        // Update button state
        button.disabled = true;
        button.textContent = 'Running...';
        button.classList.add('running');
        
        // Extract test data
        const testData = extractTestData(testCase);
        if (!testData) {
            throw new Error('Failed to extract test data');
        }
        
        // Make request using optimized queue
        const result = await makeOptimizedRequest(testData.endpoint, {
            method: testData.method,
            body: testData.body
        });
        
        // Update test result
        updateTestResult(testCase, true, result);
        testExecutionStats.passed++;
        
    } catch (error) {
        console.error('Test execution failed:', error);
        updateTestResult(testCase, false, { error: error.message });
        testExecutionStats.failed++;
    } finally {
        // Reset button state
        button.disabled = false;
        button.textContent = 'Run Test';
        button.classList.remove('running');
        
        // Update progress
        updateProgressDisplay();
    }
}

// Extract test data from test case element
function extractTestData(testCase) {
    try {
        const methodElement = testCase.querySelector('.method');
        const endpointElement = testCase.querySelector('.endpoint');
        const bodyElement = testCase.querySelector('.request-body');
        
        if (!methodElement || !endpointElement) {
            throw new Error('Missing required test data elements');
        }
        
        const method = methodElement.textContent.trim();
        const endpoint = endpointElement.textContent.trim();
        
        let body = null;
        if (bodyElement && bodyElement.textContent.trim()) {
            try {
                // Handle URL-encoded data
                const bodyText = decodeURIComponent(bodyElement.textContent.trim());
                body = bodyText === '{}' ? null : JSON.stringify(JSON.parse(bodyText));
            } catch (parseError) {
                console.warn('Failed to parse request body:', parseError);
                body = bodyElement.textContent.trim();
            }
        }
        
        return { method, endpoint, body };
    } catch (error) {
        console.error('Error extracting test data:', error);
        return null;
    }
}

// Update test result display
function updateTestResult(testCase, success, result) {
    const statusElement = testCase.querySelector('.status');
    const responseElement = testCase.querySelector('.response');
    
    if (statusElement) {
        statusElement.textContent = success ? '✅ PASS' : '❌ FAIL';
        statusElement.className = `status ${success ? 'pass' : 'fail'}`;
        statusElement.style.color = success ? '#28a745' : '#dc3545';
        statusElement.style.fontWeight = 'bold';
    }
    
    if (responseElement) {
        responseElement.textContent = JSON.stringify(result, null, 2);
        responseElement.style.color = success ? '#28a745' : '#dc3545';
    }
}

// Run all tests with optimized batching
async function runAllTests() {
    const runButtons = document.querySelectorAll('.run-test-btn:not([disabled])');
    
    if (runButtons.length === 0) {
        alert('No tests available to run');
        return;
    }
    
    // Reset stats
    testExecutionStats.passed = 0;
    testExecutionStats.failed = 0;
    testExecutionStats.current = 0;
    
    // Force progress container to be visible
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'block';
        progressContainer.style.visibility = 'visible';
        progressContainer.style.opacity = '1';
    }
    
    updateProgressDisplay();
    
    // Convert NodeList to Array and run tests
    const testPromises = Array.from(runButtons).map(button => runTest(button));
    
    try {
        await Promise.allSettled(testPromises);
        console.log('All tests completed');
    } catch (error) {
        console.error('Error running tests:', error);
    }
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function performSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    const testCases = document.querySelectorAll('.test-case');
    
    testCases.forEach(testCase => {
        const text = testCase.textContent.toLowerCase();
        const shouldShow = text.includes(searchTerm);
        testCase.style.display = shouldShow ? 'block' : 'none';
    });
}

function setActiveFilter(filter) {
    currentFilter = filter;
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    
    filterTestCases();
}

function filterTestCases() {
    const testCases = document.querySelectorAll('.test-case');
    
    testCases.forEach(testCase => {
        const method = testCase.querySelector('.method')?.textContent.toLowerCase();
        const shouldShow = currentFilter === 'all' || method === currentFilter;
        testCase.style.display = shouldShow ? 'block' : 'none';
    });
}

function handleKeyboardShortcuts(event) {
    if (event.ctrlKey || event.metaKey) {
        switch(event.key) {
            case 'Enter':
                event.preventDefault();
                runAllTests();
                break;
            case 'f':
                event.preventDefault();
                const searchInput = document.getElementById('searchInput');
                if (searchInput) searchInput.focus();
                break;
        }
    }
}

// Failed tests filter functionality
let showFailedOnly = false;
function toggleFailedTestsOnly() {
    showFailedOnly = !showFailedOnly;
    const toggleBtn = document.getElementById('toggle-failed-only');
    
    if (showFailedOnly) {
        toggleBtn.textContent = 'Show All Tests';
        toggleBtn.classList.add('active');
        showOnlyFailedTests();
    } else {
        toggleBtn.textContent = 'Show Failed Tests Only';
        toggleBtn.classList.remove('active');
        showAllTests();
    }
}

function showOnlyFailedTests() {
    const testCases = document.querySelectorAll('.test-case');
    testCases.forEach(testCase => {
        const status = testCase.querySelector('.status');
        const isFailed = status && status.textContent.includes('FAIL');
        testCase.style.display = isFailed ? 'block' : 'none';
    });
}

function showAllTests() {
    const testCases = document.querySelectorAll('.test-case');
    testCases.forEach(testCase => {
        testCase.style.display = 'block';
    });
    filterTestCases(); // Reapply current filter
}

function addFailedTestsFilter() {
    const existingBtn = document.getElementById('toggle-failed-only');
    if (existingBtn) return; // Already exists
    
    const progressContainer = document.getElementById('progress-container');
    if (!progressContainer) return;
    
    const button = document.createElement('button');
    button.id = 'toggle-failed-only';
    button.className = 'btn btn-secondary';
    button.textContent = 'Show Failed Tests Only';
    button.onclick = toggleFailedTestsOnly;
    
    const header = progressContainer.querySelector('.progress-header');
    if (header) {
        header.appendChild(button);
    }
}

// CSS animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
    }
    
    .progress-container {
        animation: fadeIn 0.3s ease-in;
    }
    
    @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
    }
    
    .run-test-btn.running {
        background: #ffc107 !important;
        cursor: not-allowed;
    }
    
    .stat-value {
        transition: color 0.3s ease;
    }
`;
document.head.appendChild(style);

console.log('Test scripts optimized version loaded successfully');
