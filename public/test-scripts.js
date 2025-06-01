// Test Report JavaScript Functions

let currentFilter = 'all';

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
});

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
function runTestFromButton(button) {
    const method = button.getAttribute('data-method');
    const endpoint = button.getAttribute('data-endpoint');
    const encodedData = button.getAttribute('data-test-data');
    const expectedStatus = button.getAttribute('data-expected-status');
    const resultElementId = button.getAttribute('data-result-id');
    
    // Decode the test data
    let data = {};
    try {
        const decodedData = decodeURIComponent(encodedData);
        data = JSON.parse(decodedData);
    } catch (error) {
        console.error('Failed to parse test data from button:', error);
        data = {};
    }
    
    // Call the original runTest function
    runTest(method, endpoint, data, expectedStatus, resultElementId, button);
}

// Test execution - MAIN FUNCTION
async function runTest(method, endpoint, dataStr, expectedStatus, resultElementId, buttonElement) {
    const button = buttonElement || event.target;
    const resultDiv = document.getElementById(resultElementId);
    
    if (!resultDiv) {
        console.error('Result element not found:', resultElementId);
        return;
    }
    
    // Parse data string safely
    let data = {};
    try {
        if (typeof dataStr === 'string') {
            // Clean up HTML entities
            const cleanDataStr = dataStr
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
    
    // Show loading state
    button.disabled = true;
    button.textContent = 'Running...';
    resultDiv.style.display = 'block';
    resultDiv.className = 'test-result';
    resultDiv.innerHTML = 'Executing test...';
    
    try {
        // Prepare request
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
        if (data.body && ['POST', 'PUT', 'PATCH'].includes(method.toUpperCase())) {
            options.body = JSON.stringify(data.body);
        }
        
        // Execute request
        const response = await fetch(finalUrl, options);
        const result = await response.text();
        
        let parsedResult;
        try {
            parsedResult = JSON.parse(result);
        } catch {
            parsedResult = result;
        }
        
        // Display results
        const statusMatch = response.status == expectedStatus;
        const statusClass = statusMatch ? 'success' : 'error';
        
        resultDiv.className = 'test-result ' + statusClass;
        resultDiv.innerHTML = 
            '<strong>Status:</strong> ' + response.status + ' ' + (statusMatch ? '✅' : '❌') + ' (Expected: ' + expectedStatus + ')<br>' +
            '<strong>URL:</strong> ' + finalUrl + '<br>' +
            '<strong>Response:</strong><br>' +
            '<pre>' + (typeof parsedResult === 'object' ? JSON.stringify(parsedResult, null, 2) : parsedResult) + '</pre>';
        
    } catch (error) {
        resultDiv.className = 'test-result error';
        resultDiv.innerHTML = 
            '<strong>Error:</strong> ' + error.message + '<br>' +
            '<pre>' + (error.stack || '') + '</pre>';
    } finally {
        button.disabled = false;
        button.textContent = 'Run Test';
    }
}

// Run all tests
async function runAllTests() {
    const runButtons = document.querySelectorAll('.run-test-btn:not(:disabled)');
    const bulkBtn = document.querySelector('.run-all');
    
    if (!bulkBtn) return;
    
    bulkBtn.disabled = true;
    bulkBtn.textContent = 'Running All Tests...';
    
    let completed = 0;
    const total = runButtons.length;
    
    for (const button of runButtons) {
        const testCase = button.closest('.test-case');
        if (testCase && testCase.style.display !== 'none') {
            button.click();
            completed++;
            bulkBtn.textContent = 'Running... (' + completed + '/' + total + ')';
            
            // Add delay between tests
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    
    bulkBtn.disabled = false;
    bulkBtn.textContent = 'Run All Tests';
}

// Copy test data to clipboard
function copyTestData(dataStr) {
    const cleanData = dataStr.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    
    navigator.clipboard.writeText(cleanData).then(() => {
        showNotification('Test data copied to clipboard!', 'success');
    }).catch(err => {
        console.error('Failed to copy text:', err);
        showNotification('Failed to copy to clipboard', 'error');
    });
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

// Initialize on page load
window.addEventListener('load', function() {
    console.log('🧪 Test Report Keyboard Shortcuts:');
    console.log('• Ctrl/Cmd + F: Focus search');
    console.log('• Ctrl/Cmd + E: Expand all');
    console.log('• Ctrl/Cmd + C: Collapse all');
    console.log('• Ctrl/Cmd + R: Run all tests');
});
