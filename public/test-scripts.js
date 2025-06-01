// Test Report JavaScript Functions - Clean & Optimized

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
    
    // Force progress container to be visible
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'block';
        updateProgressDisplay(); // Initialize stats display
    }
    
    // Add failed tests filter button if not exists
    addFailedTestsFilter();
});

// Initialize progress tracking display
function initializeProgressTracking() {
    // Create progress container if it doesn't exist
    let progressContainer = document.getElementById('progress-container');
    if (!progressContainer) {
        progressContainer = document.createElement('div');
        progressContainer.id = 'progress-container';
        progressContainer.innerHTML = `
            <div class="progress-header">
                <h3>Test Execution Summary</h3>
                <button id="toggle-failed-only" class="btn btn-secondary" onclick="toggleFailedTestsOnly()">
                    Show Failed Tests Only
                </button>
            </div>
            <div class="progress-bar-container">
                <div id="progress-bar" class="progress-bar"></div>
                <div id="progress-text" class="progress-text">0/0 tests completed</div>
            </div>
            <div class="stats-container">
                <div class="stat-item">
                    <span class="stat-label">Passed:</span>
                    <span id="stat-passed" class="stat-value stat-passed">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Failed:</span>
                    <span id="stat-failed" class="stat-value stat-failed">0</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Accuracy:</span>
                    <span id="stat-accuracy" class="stat-value">0%</span>
                </div>
            </div>
        `;
        
        // Insert after the filter controls
        const filterControls = document.querySelector('.filter-controls');
        if (filterControls) {
            filterControls.parentNode.insertBefore(progressContainer, filterControls.nextSibling);
        } else {
            // Insert at the top of the container if filter controls not found
            const container = document.querySelector('.container');
            if (container) {
                const firstChild = container.firstChild;
                container.insertBefore(progressContainer, firstChild);
            } else {
                // Last resort: append to body
                document.body.appendChild(progressContainer);
            }
        }
    }
}

// Ensure progress container visibility
function showProgressContainer() {
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
}

// Add failed tests filter button
function addFailedTestsFilter() {
    const filterControls = document.querySelector('.filter-controls');
    if (filterControls && !document.getElementById('toggle-failed-only')) {
        const failedFilterBtn = document.createElement('button');
        failedFilterBtn.id = 'toggle-failed-only';
        failedFilterBtn.className = 'btn btn-secondary';
        failedFilterBtn.textContent = 'Show Failed Tests Only';
        failedFilterBtn.onclick = toggleFailedTestsOnly;
        failedFilterBtn.style.marginLeft = '10px';
        filterControls.appendChild(failedFilterBtn);
    }
}

// Search functionality
function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
    const testCases = document.querySelectorAll('.test-case');
    const routeGroups = document.querySelectorAll('.route-group');
    
    let visibleGroups = 0;
    
    routeGroups.forEach(group => {
        let groupHasVisibleSuites = false;
        const groupSuites = group.querySelectorAll('.test-suite');
        
        groupSuites.forEach(suite => {
            let suiteHasVisibleCases = false;
            const suiteCases = suite.querySelectorAll('.test-case');
            
            suiteCases.forEach(testCase => {
                const isVisible = matchesSearch(testCase, searchTerm) && matchesFilter(testCase);
                testCase.style.display = isVisible ? 'flex' : 'none';
                if (isVisible) suiteHasVisibleCases = true;
            });
            
            suite.style.display = suiteHasVisibleCases ? 'block' : 'none';
            if (suiteHasVisibleCases) groupHasVisibleSuites = true;
        });
        
        group.style.display = groupHasVisibleSuites ? 'block' : 'none';
        if (groupHasVisibleSuites) visibleGroups++;
    });
    
    const noResults = document.getElementById('noResults');
    if (noResults) {
        noResults.style.display = visibleGroups === 0 ? 'block' : 'none';
    }
}

function matchesSearch(testCase, searchTerm) {
    if (!searchTerm) return true;
    
    const text = testCase.textContent.toLowerCase();
    const method = testCase.dataset.method ? testCase.dataset.method.toLowerCase() : '';
    const endpoint = testCase.dataset.endpoint ? testCase.dataset.endpoint.toLowerCase() : '';
    
    return text.includes(searchTerm) || method.includes(searchTerm) || endpoint.includes(searchTerm);
}

function matchesFilter(testCase) {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'security') return testCase.classList.contains('security');
    return testCase.dataset.type === currentFilter;
}

function setActiveFilter(filter) {
    currentFilter = filter;
    
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filter);
    });
    
    performSearch();
}

// Toggle failed tests only
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

// Show only failed tests
function showOnlyFailedTests() {
    const testCases = document.querySelectorAll('.test-case');
    const routeGroups = document.querySelectorAll('.route-group');
    
    let visibleGroups = 0;
    
    routeGroups.forEach(group => {
        let groupHasFailedTests = false;
        const groupSuites = group.querySelectorAll('.test-suite');
        
        groupSuites.forEach(suite => {
            let suiteHasFailedTests = false;
            const suiteCases = suite.querySelectorAll('.test-case');
            
            suiteCases.forEach(testCase => {
                const isFailed = testCase.classList.contains('status-failed');
                const shouldShow = isFailed && matchesSearch(testCase, document.getElementById('searchInput')?.value || '') && matchesFilter(testCase);
                
                testCase.style.display = shouldShow ? 'flex' : 'none';
                if (shouldShow) suiteHasFailedTests = true;
            });
            
            suite.style.display = suiteHasFailedTests ? 'block' : 'none';
            if (suiteHasFailedTests) groupHasFailedTests = true;
        });
        
        group.style.display = groupHasFailedTests ? 'block' : 'none';
        if (groupHasFailedTests) visibleGroups++;
    });
    
    // Show message if no failed tests
    if (visibleGroups === 0) {
        showNoFailedTestsMessage();
    } else {
        hideNoFailedTestsMessage();
    }
}

// Show all tests
function showAllTests() {
    hideNoFailedTestsMessage();
    performSearch(); // Use existing search/filter logic
}

// Show/hide no failed tests message
function showNoFailedTestsMessage() {
    let message = document.getElementById('no-failed-tests-message');
    if (!message) {
        message = document.createElement('div');
        message.id = 'no-failed-tests-message';
        message.className = 'no-results-message';
        message.innerHTML = `
            <div style="text-align: center; padding: 40px; color: #28a745;">
                <h3>🎉 Great News!</h3>
                <p>No failed tests found. All tests are passing!</p>
            </div>
        `;
        document.querySelector('.test-groups-container')?.appendChild(message);
    }
    message.style.display = 'block';
}

function hideNoFailedTestsMessage() {
    const message = document.getElementById('no-failed-tests-message');
    if (message) {
        message.style.display = 'none';
    }
}

// Update progress display
function updateProgressDisplay() {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const statPassed = document.getElementById('stat-passed');
    const statFailed = document.getElementById('stat-failed');
    const statAccuracy = document.getElementById('stat-accuracy');
    
    if (!progressContainer) return;
    
    // Show progress container if tests are running
    if (testExecutionStats.total > 0) {
        progressContainer.style.display = 'block';
    }
    
    const { total, current, passed, failed } = testExecutionStats;
    const completed = passed + failed;
    const accuracy = total > 0 ? Math.round((passed / total) * 100) : 0;
    
    // Update progress bar
    if (progressBar) {
        const progressPercent = total > 0 ? (completed / total) * 100 : 0;
        progressBar.style.width = `${progressPercent}%`;
        
        // Color based on accuracy
        if (accuracy >= 80) {
            progressBar.style.backgroundColor = '#28a745';
        } else if (accuracy >= 60) {
            progressBar.style.backgroundColor = '#ffc107';
        } else {
            progressBar.style.backgroundColor = '#dc3545';
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
        statAccuracy.className = `stat-value ${accuracy >= 80 ? 'stat-passed' : accuracy >= 60 ? 'stat-warning' : 'stat-failed'}`;
    }
    
    // Store for global access
    testExecutionStats.accuracy = accuracy;
    
    // Update stats
    if (statPassed) statPassed.textContent = passed;
    if (statFailed) statFailed.textContent = failed;
    if (statAccuracy) {
        statAccuracy.textContent = `${accuracy}%`;
        statAccuracy.className = `stat-value ${accuracy >= 80 ? 'stat-passed' : accuracy >= 60 ? 'stat-warning' : 'stat-failed'}`;
    }
    
    // Store for global access
    testExecutionStats.accuracy = accuracy;
}

// Toggle test data visibility
function toggleTestData(dataId) {
    const dataContent = document.getElementById('data-' + dataId);
    const expandIcon = document.querySelector('[onclick*="' + dataId + '"] .expand-icon');
    
    if (dataContent) {
        const isVisible = dataContent.style.display !== 'none';
        dataContent.style.display = isVisible ? 'none' : 'block';
        if (expandIcon) {
            expandIcon.textContent = isVisible ? '▼' : '▲';
        }
    }
}

// Toggle route group visibility
function toggleGroup(groupId) {
    const groupContent = document.getElementById(groupId);
    const groupHeader = document.querySelector(`[onclick*="${groupId}"]`);
    const collapseIcon = groupHeader ? groupHeader.querySelector('.collapse-icon') : null;
    
    if (groupContent) {
        const isVisible = groupContent.style.display !== 'none';
        groupContent.style.display = isVisible ? 'none' : 'block';
        if (collapseIcon) {
            collapseIcon.textContent = isVisible ? '▶' : '▼';
        }
        
        // Toggle collapsed class on parent group
        const routeGroup = groupContent.closest('.route-group');
        if (routeGroup) {
            routeGroup.classList.toggle('collapsed', isVisible);
        }
    }
}

// Toggle test suite visibility
function toggleSuite(suiteId) {
    const suiteContent = document.getElementById('suite-' + suiteId);
    const suiteHeader = document.querySelector(`[onclick*="${suiteId}"]`);
    const collapseIcon = suiteHeader ? suiteHeader.querySelector('.collapse-icon') : null;
    
    if (suiteContent) {
        const isVisible = suiteContent.style.display !== 'none';
        suiteContent.style.display = isVisible ? 'none' : 'block';
        if (collapseIcon) {
            collapseIcon.textContent = isVisible ? '▶' : '▼';
        }
        
        // Toggle collapsed class on parent suite
        const testSuite = suiteContent.closest('.test-suite');
        if (testSuite) {
            testSuite.classList.toggle('collapsed', isVisible);
        }
    }
}

// Expand/Collapse all
function expandAll() {
    const groups = document.querySelectorAll('.route-group');
    const suites = document.querySelectorAll('.test-suite');
    const dataContents = document.querySelectorAll('.data-content');
    const expandIcons = document.querySelectorAll('.expand-icon');
    
    groups.forEach(group => group.classList.remove('collapsed'));
    suites.forEach(suite => suite.classList.remove('collapsed'));
    dataContents.forEach(content => content.style.display = 'block');
    expandIcons.forEach(icon => icon.textContent = '▲');
}

function collapseAll() {
    const groups = document.querySelectorAll('.route-group');
    const suites = document.querySelectorAll('.test-suite');
    const dataContents = document.querySelectorAll('.data-content');
    const expandIcons = document.querySelectorAll('.expand-icon');
    
    groups.forEach(group => group.classList.add('collapsed'));
    suites.forEach(suite => suite.classList.add('collapsed'));
    dataContents.forEach(content => content.style.display = 'none');
    expandIcons.forEach(icon => icon.textContent = '▼');
}

// Wrapper function to extract data from button attributes
// Make runTestFromButton globally accessible
window.runTestFromButton = function(button) {
    if (!button) {
        console.error('Button element is null or undefined');
        return;
    }
    
    try {
        const method = button.getAttribute('data-method');
        const endpoint = button.getAttribute('data-endpoint');
        const encodedData = button.getAttribute('data-test-data');
        const expectedStatus = parseInt(button.getAttribute('data-expected-status'), 10);
        const resultElementId = button.getAttribute('data-result-id');
        
        console.log('Running test from button:', { method, endpoint, expectedStatus, resultElementId });
        
        // Decode the test data
        let data = {};
        try {
            const decodedData = decodeURIComponent(encodedData);
            data = JSON.parse(decodedData);
        } catch (error) {
            console.error('Failed to parse test data from button:', error);
            data = {};
        }
        
        // Determine which runTest function to call based on signature
        if (typeof runTest !== 'function') {
            throw new Error('runTest function not defined');
        }
        
        // Check if there are multiple versions of the function
        if (window.originalRunTest) {
            // Call the original implementation with correct parameter order
            return window.originalRunTest(method, endpoint, data, expectedStatus, resultElementId, button);
        } else {
            // Call button-first version (newer implementation at the bottom of the file)
            return runTest(button, endpoint, method, data, expectedStatus);
        }
    } catch (error) {
        console.error('Error in runTestFromButton:', error);
        alert('An error occurred while setting up the test. See console for details.');
        return Promise.reject(error);
    }
}

// Keep the original function for backward compatibility - fixed to avoid recursion
function runTestFromButton(button) {
    // Avoid calling the window version directly to prevent recursion
    if (!button) {
        console.error('Button element is null or undefined in compatibility function');
        return;
    }
    
    try {
        const method = button.getAttribute('data-method');
        const endpoint = button.getAttribute('data-endpoint');
        const encodedData = button.getAttribute('data-test-data');
        const expectedStatus = parseInt(button.getAttribute('data-expected-status'), 10);
        const resultElementId = button.getAttribute('data-result-id');
        
        console.log('Running test from compatibility function:', { method, endpoint, expectedStatus, resultElementId });
        
        // Decode the test data
        let data = {};
        try {
            const decodedData = decodeURIComponent(encodedData);
            data = JSON.parse(decodedData);
        } catch (error) {
            console.error('Failed to parse test data from button:', error);
            data = {};
        }
        
        // Call runTest directly with the appropriate parameters
        if (window.originalRunTest) {
            return window.originalRunTest(method, endpoint, data, expectedStatus, resultElementId, button);
        } else {
            return runTest(button, endpoint, method, data, expectedStatus);
        }
    } catch (error) {
        console.error('Error in compatibility runTestFromButton:', error);
        alert('An error occurred while setting up the test. See console for details.');
        return Promise.reject(error);
    }
}

// Legacy runTest function removed - now using button-first signature runTest function below
// (This was causing parameter order confusion and has been consolidated)

// Run all visible tests sequentially with visual progress
async function runAllTests() {
    // Initialize progress tracking
    initializeProgressTracking();
    
    // Show progress container
    const progressContainer = document.getElementById('progress-container');
    
    if (progressContainer) {
        progressContainer.style.display = 'block';
    }
    
    // Get all visible test buttons
    const visibleTestCases = Array.from(document.querySelectorAll('.test-case'))
        .filter(testCase => {
            const style = window.getComputedStyle(testCase);
            return style.display !== 'none';
        });
    
    const testButtons = visibleTestCases.map(testCase => 
        testCase.querySelector('.run-test-btn')
    ).filter(btn => btn !== null);
    
    if (testButtons.length === 0) {
        alert('No visible tests to run');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        return;
    }
    
    // Reset stats
    testExecutionStats.total = testButtons.length;
    testExecutionStats.current = 0;
    testExecutionStats.passed = 0;
    testExecutionStats.failed = 0;
    
    console.log(`Starting execution of ${testButtons.length} tests...`);
    
    // Run tests sequentially with delay for visual feedback
    for (let i = 0; i < testButtons.length; i++) {
        const button = testButtons[i];
        const testCase = button.closest('.test-case');
        
        // Scroll test into view
        testCase.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'center' 
        });
        
        // Get test parameters from button data attributes
        const method = button.dataset.method || button.getAttribute('data-method');
        const endpoint = button.dataset.endpoint || button.getAttribute('data-endpoint');
        const dataStr = button.dataset.testData || button.getAttribute('data-test-data');
        const expectedStatus = parseInt(button.dataset.expectedStatus || button.getAttribute('data-expected-status'));
        const resultId = button.dataset.resultId || button.getAttribute('data-result-id');        try {
            // Ensure we pass a DOM element as button with correct parameter order
            if (button && typeof button.closest === 'function') {
                await runTest(button, endpoint, method, dataStr, expectedStatus);
            } else {
                console.error(`Test ${i + 1} skipped: Invalid button element`);
            }
        } catch (error) {
            console.error(`Test ${i + 1} failed:`, error);
        }
        
        // Small delay between tests for visual effect
        if (i < testButtons.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    console.log('All tests completed!');
    showTestCompletionNotification();
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
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 1000;
        font-weight: 600;
        max-width: 400px;
        animation: slideIn 0.3s ease;
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px;">
            <div>${message}</div>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: none; border: none; color: white; font-size: 1.2em; cursor: pointer;">
                ×
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Copy test data to clipboard
function copyTestData(testDataStr) {
    try {
        // Decode and parse the test data
        let cleanDataStr = testDataStr;
        try {
            // Try to decode URL encoding first
            cleanDataStr = decodeURIComponent(testDataStr);
        } catch (decodeError) {
            console.warn('Could not decode URL encoding in copyTestData, using original string:', decodeError);
            cleanDataStr = testDataStr;
        }
        
        // Clean HTML entities and parse
        const data = JSON.parse(cleanDataStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
        const formattedData = JSON.stringify(data, null, 2);
        
        // Copy to clipboard
        navigator.clipboard.writeText(formattedData).then(() => {
            // Show success feedback
            const copyBtn = event.target;
            const originalText = copyBtn.textContent;
            copyBtn.textContent = 'Copied!';
            copyBtn.style.background = '#10b981';
            
            setTimeout(() => {
                copyBtn.textContent = originalText;
                copyBtn.style.background = '';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy to clipboard:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = formattedData;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
        });
    } catch (error) {
        console.error('Failed to copy test data:', error);
    }
}

// Show notification
function showNotification(message, type) {
    type = type || 'info';
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.className = 'notification ' + type;
    notification.style.cssText = 
        'position: fixed; top: 20px; right: 20px; ' +
        'background: ' + (type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#17a2b8') + '; ' +
        'color: white; padding: 12px 20px; border-radius: 6px; z-index: 1000; ' +
        'font-size: 14px; box-shadow: 0 4px 15px rgba(0,0,0,0.2);';
    
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Keyboard shortcuts
function handleKeyboardShortcuts(e) {
    if (e.ctrlKey || e.metaKey) {
        switch(e.key) {
            case 'f':
                e.preventDefault();
                const searchInput = document.getElementById('searchInput');
                if (searchInput) {
                    searchInput.focus();
                }
                break;
            case 'e':
                e.preventDefault();
                expandAll();
                break;
            case 'c':
                e.preventDefault();
                collapseAll();
                break;
            case 'r':
                e.preventDefault();
                runAllTests();
                break;
        }
    }
}

// Utility functions
function debounce(func, wait) {
    let timeout;
    return function executedFunction() {
        const args = arguments;
        const later = () => {
            clearTimeout(timeout);
            func.apply(this, args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Initialize progress tracking
function initializeProgressTracking() {
    const testCases = document.querySelectorAll('.test-case');
    testExecutionStats.total = testCases.length;
    testExecutionStats.current = 0;
    testExecutionStats.passed = 0;
    testExecutionStats.failed = 0;
    testExecutionStats.accuracy = 0;
    
    // Create progress container if it doesn't exist
    if (!document.getElementById('progressContainer')) {
        const progressHtml = `
            <div id="progressContainer" class="progress-container" style="display: none;">
                <div class="progress-header">
                    <div class="progress-title">🧪 Running Tests...</div>
                    <div class="progress-stats">
                        <div class="progress-stat">
                            <span>📊</span>
                            <span id="progressCurrent">0</span> / <span id="progressTotal">0</span>
                        </div>
                        <div class="progress-stat">
                            <span>✅</span>
                            <span id="progressPassed">0</span>
                        </div>
                        <div class="progress-stat">
                            <span>❌</span>
                            <span id="progressFailed">0</span>
                        </div>
                        <div class="progress-stat">
                            <span>🎯</span>
                            <span id="progressAccuracy">0%</span>
                        </div>
                    </div>
                </div>
                <div class="progress-bar">
                    <div id="progressFill" class="progress-fill"></div>
                    <div id="progressText" class="progress-text">0%</div>
                </div>
            </div>
        `;
        
        const testResults = document.getElementById('testResults');
        testResults.insertAdjacentHTML('beforebegin', progressHtml);
    }
    
    // Create results summary if it doesn't exist
    if (!document.getElementById('resultsSummary')) {
        const summaryHtml = `
            <div id="resultsSummary" class="results-summary">
                <h3>📋 Test Execution Summary</h3>
                <div class="summary-grid">
                    <div class="summary-item passed">
                        <div id="summaryPassed" class="summary-number">0</div>
                        <div class="summary-label">Passed</div>
                    </div>
                    <div class="summary-item failed">
                        <div id="summaryFailed" class="summary-number">0</div>
                        <div class="summary-label">Failed</div>
                    </div>
                    <div class="summary-item accuracy">
                        <div id="summaryAccuracy" class="summary-number">0%</div>
                        <div class="summary-label">Accuracy</div>
                    </div>
                </div>
                <button id="failedTestsToggle" class="failed-tests-toggle" onclick="toggleFailedTestsOnly()">
                    🔍 Show Failed Tests Only
                </button>
            </div>
        `;
        
        const progressContainer = document.getElementById('progressContainer');
        progressContainer.insertAdjacentHTML('afterend', summaryHtml);
    }
}

// Update progress display
function updateProgressDisplay() {
    const progressContainer = document.getElementById('progress-container');
    if (!progressContainer) {
        console.warn('Progress container not found');
        return;
    }
    
    // Make sure progress container is visible
    progressContainer.style.display = 'block';
    
    // Calculate stats
    const { total, current, passed, failed } = testExecutionStats;
    const progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;
    const accuracy = current > 0 ? Math.round((passed / current) * 100) : 0;
    testExecutionStats.accuracy = accuracy;
    
    // Legacy implementation (support both old and new UI elements)
    try {
        // New UI elements
        document.getElementById('progress-bar').style.width = `${progressPercent}%`;
        document.getElementById('progress-text').textContent = `${current}/${total} tests completed`;
        document.getElementById('stat-passed').textContent = passed;
        document.getElementById('stat-failed').textContent = failed;
        document.getElementById('stat-accuracy').textContent = `${accuracy}%`;
        
        // Color based on accuracy
        const progressBar = document.getElementById('progress-bar');
        if (accuracy >= 80) {
            progressBar.style.backgroundColor = '#28a745';
        } else if (accuracy >= 60) {
            progressBar.style.backgroundColor = '#ffc107';
        } else {
            progressBar.style.backgroundColor = '#dc3545';
        }
    } catch (error) {
        console.warn('Error updating main progress display', error);
    }
    
    // Alternative UI elements (support both formats)
    try {
        // Update alternative progress elements if they exist
        const elements = {
            progressCurrent: current,
            progressTotal: total,
            progressPassed: passed,
            progressFailed: failed,
            progressAccuracy: accuracy + '%'
        };
        
        Object.keys(elements).forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.textContent = elements[id];
            }
        });
        
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        
        if (progressFill && progressText) {
            progressFill.style.width = progressPercent + '%';
            progressText.textContent = progressPercent + '%';
            
            // Update color based on accuracy
            if (accuracy >= 80) {
                progressFill.style.background = 'linear-gradient(90deg, #4CAF50 0%, #45a049 100%)';
            } else if (accuracy >= 60) {
                progressFill.style.background = 'linear-gradient(90deg, #ffc107 0%, #e0a800 100%)';
            } else {
                progressFill.style.background = 'linear-gradient(90deg, #dc3545 0%, #c82333 100%)';
            }
        }
    } catch (error) {
        console.warn('Error updating alternative progress display', error);
    }
    
    // Update summary when tests are complete
    if (testExecutionStats.current >= testExecutionStats.total) {
        document.getElementById('summaryPassed').textContent = testExecutionStats.passed;
        document.getElementById('summaryFailed').textContent = testExecutionStats.failed;
        document.getElementById('summaryAccuracy').textContent = accuracy + '%';
        
        document.getElementById('resultsSummary').classList.add('show');
        document.getElementById('progressContainer').style.display = 'none';
    }
}

// Show/hide failed tests only
let showingFailedOnly = false;

function toggleFailedTestsOnly() {
    showingFailedOnly = !showingFailedOnly;
    const button = document.getElementById('toggle-failed-only') || document.getElementById('failedTestsToggle');
    
    if (!button) return;
    
    const testCases = document.querySelectorAll('.test-case');
    
    if (showingFailedOnly) {
        button.textContent = 'Show All Tests';
        button.classList.add('active');
        
        testCases.forEach(testCase => {
            const isFailed = testCase.classList.contains('status-failed');
            testCase.style.display = isFailed ? 'flex' : 'none';
        });
        
        // Also hide empty groups and suites
        document.querySelectorAll('.route-group').forEach(group => {
            const visibleCases = group.querySelectorAll('.test-case.status-failed[style*="flex"]');
            group.style.display = visibleCases.length > 0 ? 'block' : 'none';
        });
        
        document.querySelectorAll('.test-suite').forEach(suite => {
            const visibleCases = suite.querySelectorAll('.test-case.status-failed[style*="flex"]');
            suite.style.display = visibleCases.length > 0 ? 'block' : 'none';
        });
        
        // Show no failed tests message if needed
        const hasFailedTests = document.querySelectorAll('.test-case.status-failed').length > 0;
        if (!hasFailedTests) {
            showNoFailedTestsMessage();
        } else {
            hideNoFailedTestsMessage();
        }
        
    } else {
        button.textContent = 'Show Failed Tests Only';
        button.classList.remove('active');
        
        testCases.forEach(testCase => {
            testCase.style.display = 'flex';
        });
        
        document.querySelectorAll('.route-group').forEach(group => {
            group.style.display = 'block';
        });
        
        document.querySelectorAll('.test-suite').forEach(suite => {
            suite.style.display = 'block';
        });
        
        hideNoFailedTestsMessage();
    }
}

// Enhanced run test function with visual feedback (button-first signature)
// button, endpoint, method, dataStr, expectedStatus
function runTest(button, endpoint, method, dataStr, expectedStatus) {
    console.log('runTest called with:', { button, endpoint, method });
    
    // Validate button is a DOM element
    if (!button || typeof button !== 'object' || !button.tagName || typeof button.closest !== 'function') {
        console.error('Invalid button element:', button);
        
        // Try to recover if possible
        if (typeof endpoint === 'string' && typeof method === 'string') {
            // Try to find any test-case element
            const anyTestCase = document.querySelector('.test-case');
            if (anyTestCase) {
                console.log('Found test case for recovery', anyTestCase);
                const tempButton = document.createElement('button');
                tempButton.className = 'run-test-btn';
                anyTestCase.appendChild(tempButton);
                button = tempButton;
            } else {
                console.error('Cannot recover from invalid button - no test case found');
                return Promise.reject(new Error('Invalid button element and recovery failed'));
            }
        } else {
            console.error('Cannot determine test parameters');
            return Promise.reject(new Error('Invalid test parameters'));
        }
    }
    
    // Now safely use button.closest
    let testCase;
    try {
        testCase = button.closest('.test-case');
        if (!testCase) {
            console.error('Test case not found for button:', button);
            const anyTestCase = document.querySelector('.test-case');
            if (anyTestCase) {
                console.log('Using alternative test case for recovery');
                testCase = anyTestCase;
            } else {
                return Promise.reject(new Error('Test case element not found'));
            }
        }
    } catch (error) {
        console.error('Error finding test case:', error);
        return Promise.reject(error);
    }
    
    // Safely get result div
    let resultDiv;
    try {
        resultDiv = testCase.querySelector('.test-result');
        if (!resultDiv) {
            console.log('Creating result div as it was not found');
            resultDiv = document.createElement('div');
            resultDiv.className = 'test-result';
            testCase.appendChild(resultDiv);
        }
    } catch (error) {
        console.error('Error finding/creating result div:', error);
        return Promise.reject(error);
    }
      // Parse data string safely with URL decoding
    let data = {};
    try {
        if (typeof dataStr === 'string') {
            // First decode URL encoding, then clean HTML entities
            let cleanDataStr = dataStr;
            try {
                // Try to decode URL encoding first
                cleanDataStr = decodeURIComponent(dataStr);
            } catch (decodeError) {
                console.warn('Could not decode URL encoding, using original string:', decodeError);
                cleanDataStr = dataStr;
            }
            
            // Clean HTML entities
            cleanDataStr = cleanDataStr
                .replace(/&apos;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'");
            
            data = JSON.parse(cleanDataStr);
        } else if (typeof dataStr === 'object') {
            data = dataStr;
        }
    } catch (error) {
        console.error('Failed to parse test data:', error, dataStr);
        data = {};
    }
    
    // Set running state
    testCase.classList.remove('status-passed', 'status-failed', 'status-pending');
    testCase.classList.add('status-running');
    
    // Show loading state
    button.disabled = true;
    button.textContent = 'Running...';
    resultDiv.style.display = 'block';
    resultDiv.className = 'test-result';
    resultDiv.innerHTML = '⏳ Executing test...';
    
    // Update stats
    testExecutionStats.current++;
    updateProgressDisplay();
    
    // Prepare request
    return executeTestRequest(endpoint, method, data, expectedStatus)
        .then(result => {
            handleTestResult(testCase, button, resultDiv, result, expectedStatus);
        })
        .catch(error => {
            handleTestError(testCase, button, resultDiv, error, expectedStatus);
        });
}

// Execute the actual test request
async function executeTestRequest(endpoint, method, data, expectedStatus) {
    let finalUrl = endpoint;
    const options = {
        method: method.toUpperCase(),
        headers: {
            'Content-Type': 'application/json',
        }
    };
    
    // Add query parameters
    if (data.query) {
        const url = new URL(endpoint, window.location.origin);
        Object.entries(data.query).forEach(([key, value]) => {
            url.searchParams.append(key, value);
        });
        finalUrl = url.toString();
    }
    
    // Add path parameters
    if (data.params) {
        Object.entries(data.params).forEach(([key, value]) => {
            finalUrl = finalUrl.replace(':' + key, value);
        });
    }
    
    // Add body data
    if (data.body && (method.toUpperCase() === 'POST' || method.toUpperCase() === 'PUT' || method.toUpperCase() === 'PATCH')) {
        options.body = JSON.stringify(data.body);
    }
    
    const response = await fetch(finalUrl, options);
    const responseData = await response.text();
    
    let parsedResponse;
    try {
        parsedResponse = JSON.parse(responseData);
    } catch {
        parsedResponse = responseData;
    }
    
    return {
        status: response.status,
        data: parsedResponse,
        url: finalUrl
    };
}

// Handle successful test result
function handleTestResult(testCase, button, resultDiv, result, expectedStatus) {
    const isPassed = result.status === expectedStatus;
    
    testCase.classList.remove('status-running');
    testCase.classList.add(isPassed ? 'status-passed' : 'status-failed');
    
    // Update stats
    if (isPassed) {
        testExecutionStats.passed++;
    } else {
        testExecutionStats.failed++;
    }
    updateProgressDisplay();
    
    // Create detailed result display
    const comparisonHtml = `
        <div class="result-comparison">
            <div class="comparison-row">
                <span class="comparison-label">Expected Status:</span>
                <span class="comparison-${isPassed ? 'match' : 'expected'}">${expectedStatus}</span>
            </div>
            <div class="comparison-row">
                <span class="comparison-label">Actual Status:</span>
                <span class="comparison-${isPassed ? 'match' : 'actual'}">${result.status}</span>
            </div>
            <div class="comparison-row">
                <span class="comparison-label">Accuracy:</span>
                <span class="accuracy-indicator ${isPassed ? 'accuracy-high' : 'accuracy-low'}">
                    ${isPassed ? '✅ 100%' : '❌ 0%'}
                </span>
            </div>
        </div>
    `;
    
    resultDiv.className = `test-result ${isPassed ? 'passed' : 'failed'} show-comparison`;
    resultDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong>${isPassed ? '✅ PASSED' : '❌ FAILED'}</strong>
            <span class="accuracy-indicator ${isPassed ? 'accuracy-high' : 'accuracy-low'}">
                ${isPassed ? 'Perfect Match' : 'Status Mismatch'}
            </span>
        </div>
        ${comparisonHtml}
        <details style="margin-top: 10px;">
            <summary style="cursor: pointer; font-weight: 600;">Response Data</summary>
            <pre style="background: #f8f9fa; padding: 10px; border-radius: 4px; margin-top: 5px; font-size: 0.85em; overflow-x: auto;">${JSON.stringify(result.data, null, 2)}</pre>
        </details>
    `;
    
    // Reset button
    button.disabled = false;
    button.textContent = 'Run Test';
}

// Handle test error
function handleTestError(testCase, button, resultDiv, error, expectedStatus) {
    testCase.classList.remove('status-running');
    testCase.classList.add('status-failed');
    
    testExecutionStats.failed++;
    updateProgressDisplay();
    
    resultDiv.className = 'test-result failed show-comparison';
    resultDiv.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <strong>❌ ERROR</strong>
            <span class="accuracy-indicator accuracy-low">Network/Runtime Error</span>
        </div>
        <div class="result-comparison">
            <div class="comparison-row">
                <span class="comparison-label">Expected Status:</span>
                <span class="comparison-expected">${expectedStatus}</span>
            </div>
            <div class="comparison-row">
                <span class="comparison-label">Error:</span>
                <span class="comparison-actual">${error.message}</span>
            </div>
        </div>
    `;
    
    button.disabled = false;
    button.textContent = 'Run Test';
}

// Initialize on page load
window.addEventListener('load', function() {
    console.log('🧪 Test Report Keyboard Shortcuts:');
    console.log('• Ctrl/Cmd + F: Focus search');
    console.log('• Ctrl/Cmd + E: Expand all');
    console.log('• Ctrl/Cmd + C: Collapse all');
    console.log('• Ctrl/Cmd + R: Run all tests');
});
