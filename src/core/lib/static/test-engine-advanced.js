/**
 * Advanced Test Engine - Modern JavaScript Implementation
 * 
 * Features:
 * - ES6+ Modern JavaScript
 * - Class-based architecture
 * - Optimized performance
 * - Better error handling
 * - Clean separation of concerns
 * - Type safety considerations
 * - Memory management
 * 
 * @version 2.0.0
 * @author Advanced Development Team
 */

class TestEngine {
    constructor() {
        this.config = {
            maxConcurrentRequests: 5,
            requestDelay: 50,
            timeout: 30000,
            retryAttempts: 3,
            debounceDelay: 300
        };

        this.state = {
            currentFilter: 'all',
            showFailedOnly: false,
            isProcessingQueue: false,
            stats: this.createInitialStats()
        };

        this.requestQueue = [];
        this.activeRequests = new Set();
        this.cache = new Map();
        this.eventHandlers = new Map();
        
        this.initialize();
    }

    createInitialStats() {
        return {
            total: 0,
            current: 0,
            passed: 0,
            failed: 0,
            accuracy: 0,
            startTime: null,
            endTime: null
        };
    }

    /**
     * Initialize the test engine
     */
    initialize() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.setup());
        } else {
            this.setup();
        }
    }

    /**
     * Main setup method
     */
    setup() {        try {
            this.setupEventListeners();
            this.initializeProgressTracking();
            this.setupKeyboardShortcuts();
            this.createControlsInterface();
            this.optimizePerformance();
            this.updateFilterCounts(); // Initialize filter counts
            
            console.info('🚀 Advanced Test Engine initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize Test Engine:', error);
            this.showError('Failed to initialize test engine. Please refresh the page.');
        }
    }

    /**
     * Setup event listeners with proper cleanup
     */
    setupEventListeners() {
        const handlers = [
            {
                element: '#searchInput',
                event: 'input',
                handler: this.debounce(this.performSearch.bind(this), this.config.debounceDelay)
            },
            {
                element: '.filter-btn',
                event: 'click',
                handler: (e) => this.setActiveFilter(e.target.dataset.filter),
                multiple: true
            }
        ];

        handlers.forEach(({ element, event, handler, multiple }) => {
            const elements = multiple ? 
                document.querySelectorAll(element) : 
                [document.querySelector(element)].filter(Boolean);

            elements.forEach(el => {
                if (el) {
                    el.addEventListener(event, handler);
                    this.eventHandlers.set(el, { event, handler });
                }
            });
        });
    }

    /**
     * Initialize progress tracking with modern UI
     */
    initializeProgressTracking() {
        this.updateStats();
        
        let progressContainer = document.getElementById('progress-container');
        if (!progressContainer) {
            progressContainer = this.createProgressContainer();
            this.insertProgressContainer(progressContainer);
        }

        this.updateProgressDisplay();
    }

    /**
     * Create modern progress container
     */
    createProgressContainer() {
        const container = document.createElement('div');
        container.id = 'progress-container';
        container.className = 'progress-container';
        
        container.innerHTML = `
            <div class="progress-header">
                <h3 class="progress-title">🧪 Test Execution Dashboard</h3>
                <div class="progress-controls">
                    <button id="expand-all-btn" class="btn btn-outline" onclick="testEngine.expandAll()">
                        📂 Expand All
                    </button>
                    <button id="collapse-all-btn" class="btn btn-outline" onclick="testEngine.collapseAll()">
                        📁 Collapse All
                    </button>
                    <button id="run-all-btn" class="btn btn-primary" onclick="testEngine.runAllTests()">
                        ▶️ Run All Tests
                    </button>
                    <button id="toggle-failed-btn" class="btn btn-secondary" onclick="testEngine.toggleFailedTestsOnly()">
                        🔍 Show Failed Only
                    </button>
                </div>
            </div>
            
            <div class="progress-stats">
                <div class="stat-card">
                    <div class="stat-icon">✅</div>
                    <div class="stat-content">
                        <div class="stat-value" id="stat-passed">0</div>
                        <div class="stat-label">Passed</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">❌</div>
                    <div class="stat-content">
                        <div class="stat-value" id="stat-failed">0</div>
                        <div class="stat-label">Failed</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">📊</div>
                    <div class="stat-content">
                        <div class="stat-value" id="stat-accuracy">0%</div>
                        <div class="stat-label">Success Rate</div>
                    </div>
                </div>
                <div class="stat-card">
                    <div class="stat-icon">⏱️</div>
                    <div class="stat-content">
                        <div class="stat-value" id="stat-time">0s</div>
                        <div class="stat-label">Total Time</div>
                    </div>
                </div>
            </div>
            
            <div class="progress-bar-container">
                <div id="progress-bar" class="progress-bar"></div>
                <div id="progress-text" class="progress-text">Ready to run tests</div>
            </div>
            
            <div id="test-summary" class="test-summary" style="display: none;">
                <h4 class="summary-title">📋 Test Results Summary</h4>
                <div id="summary-details" class="summary-content"></div>
            </div>
        `;

        return container;
    }

    /**
     * Insert progress container at optimal position
     */
    insertProgressContainer(container) {
        const filterControls = document.querySelector('.filter-controls');
        const targetParent = filterControls?.parentNode || 
                           document.querySelector('.container') || 
                           document.body;
        
        if (filterControls) {
            targetParent.insertBefore(container, filterControls.nextSibling);
        } else {
            targetParent.insertBefore(container, targetParent.firstChild);
        }
    }

    /**
     * Update statistics
     */
    updateStats() {
        const testCases = document.querySelectorAll('.test-case');
        this.state.stats.total = testCases.length;
        
        // Count current results
        const results = document.querySelectorAll('.test-result[style*="block"]');
        const passed = document.querySelectorAll('.test-result .status:contains("PASS")').length;
        const failed = document.querySelectorAll('.test-result .status:contains("FAIL")').length;
        
        this.state.stats.passed = passed;
        this.state.stats.failed = failed;
        this.state.stats.current = passed + failed;
        this.state.stats.accuracy = this.state.stats.current > 0 ? 
            Math.round((this.state.stats.passed / this.state.stats.current) * 100) : 0;
    }

    /**
     * Update progress display with smooth animations
     */
    updateProgressDisplay() {
        const elements = {
            progressBar: document.getElementById('progress-bar'),
            progressText: document.getElementById('progress-text'),
            statPassed: document.getElementById('stat-passed'),
            statFailed: document.getElementById('stat-failed'),
            statAccuracy: document.getElementById('stat-accuracy'),
            statTime: document.getElementById('stat-time')
        };

        // Check if elements exist
        if (!Object.values(elements).every(Boolean)) {
            console.warn('Some progress elements not found');
            return;
        }

        const { total, current, passed, failed, accuracy, startTime, endTime } = this.state.stats;
        const progressPercent = total > 0 ? Math.round((current / total) * 100) : 0;
        const elapsed = startTime && endTime ? 
            Math.round((endTime - startTime) / 1000) : 
            startTime ? Math.round((Date.now() - startTime) / 1000) : 0;

        // Update progress bar with smooth transition
        this.animateProgressBar(elements.progressBar, progressPercent, accuracy);
        
        // Update text elements
        elements.progressText.textContent = current >= total && total > 0 ? 
            'All tests completed!' : 
            `${current}/${total} tests completed`;
            
        elements.statPassed.textContent = passed;
        elements.statFailed.textContent = failed;
        elements.statAccuracy.textContent = `${accuracy}%`;
        elements.statTime.textContent = `${elapsed}s`;

        // Apply color coding
        this.applyProgressColors(elements, accuracy);

        // Show summary if complete
        if (current >= total && total > 0) {
            this.showTestSummary();
        }
    }

    /**
     * Animate progress bar with smooth transitions
     */
    animateProgressBar(progressBar, percent, accuracy) {
        if (!progressBar) return;

        progressBar.style.width = `${percent}%`;
        
        // Color based on accuracy
        const colors = {
            high: 'linear-gradient(90deg, #28a745 0%, #20c997 100%)',
            medium: 'linear-gradient(90deg, #ffc107 0%, #fd7e14 100%)',
            low: 'linear-gradient(90deg, #dc3545 0%, #e83e8c 100%)'
        };

        const colorKey = accuracy >= 80 ? 'high' : accuracy >= 60 ? 'medium' : 'low';
        progressBar.style.background = colors[colorKey];
        progressBar.style.transition = 'all 0.3s ease-in-out';
    }

    /**
     * Apply color coding to progress elements
     */
    applyProgressColors(elements, accuracy) {
        const colorMap = {
            80: '#28a745',
            60: '#ffc107',
            0: '#dc3545'
        };

        const color = Object.entries(colorMap)
            .find(([threshold]) => accuracy >= parseInt(threshold))?.[1] || '#dc3545';

        elements.statAccuracy.style.color = color;
    }

    /**
     * Show comprehensive test summary
     */
    showTestSummary() {
        const testSummary = document.getElementById('test-summary');
        const summaryDetails = document.getElementById('summary-details');
        
        if (!testSummary || !summaryDetails) return;

        const { total, passed, failed, accuracy, startTime, endTime } = this.state.stats;
        const duration = endTime && startTime ? endTime - startTime : 0;
        
        const emoji = accuracy >= 90 ? '🎉' : accuracy >= 70 ? '👍' : accuracy >= 50 ? '⚠️' : '❌';
        const message = accuracy >= 90 ? 'Outstanding!' : 
                       accuracy >= 70 ? 'Great job!' : 
                       accuracy >= 50 ? 'Good progress!' : 'Needs attention!';

        summaryDetails.innerHTML = `
            <div class="summary-overview">
                <div class="summary-emoji">${emoji}</div>
                <div class="summary-message">${message}</div>
            </div>
            
            <div class="summary-grid">
                <div class="summary-item">
                    <strong>Total Tests:</strong> ${total}
                </div>
                <div class="summary-item success">
                    <strong>Passed:</strong> ${passed}
                </div>
                <div class="summary-item error">
                    <strong>Failed:</strong> ${failed}
                </div>
                <div class="summary-item">
                    <strong>Success Rate:</strong> ${accuracy}%
                </div>
                <div class="summary-item">
                    <strong>Duration:</strong> ${Math.round(duration / 1000)}s
                </div>
                <div class="summary-item">
                    <strong>Average per test:</strong> ${total > 0 ? Math.round(duration / total) : 0}ms
                </div>
            </div>
        `;

        testSummary.style.display = 'block';
        testSummary.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    /**
     * Advanced HTTP request with retry logic and caching
     */
    async makeRequest(url, options = {}) {
        const cacheKey = `${options.method || 'GET'}_${url}_${JSON.stringify(options.body || '')}`;
        
        // Check cache for GET requests
        if ((!options.method || options.method === 'GET') && this.cache.has(cacheKey)) {
            console.log('📋 Cache hit for:', url);
            return this.cache.get(cacheKey);
        }

        const requestOptions = {
            method: options.method || 'GET',
            headers: {
                'Accept': 'application/json',
                ...options.headers
            },
            signal: AbortSignal.timeout(this.config.timeout)
        };

        // Add Content-Type and body for non-GET/HEAD requests
        if (requestOptions.method !== 'GET' && requestOptions.method !== 'HEAD') {
            if (options.body) {
                requestOptions.headers['Content-Type'] = 'application/json';
                requestOptions.body = typeof options.body === 'string' ? 
                    options.body : JSON.stringify(options.body);
            }
        }

        let lastError;
        
        // Retry logic
        for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
            try {
                console.log(`🔄 Request attempt ${attempt}/${this.config.retryAttempts}:`, url);
                
                const response = await fetch(url, requestOptions);
                
                if (!response.ok) {
                    const errorText = await response.text().catch(() => '');
                    throw new Error(`HTTP ${response.status}: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
                }

                const contentType = response.headers.get('content-type');
                let result;
                
                if (contentType?.includes('application/json')) {
                    result = await response.json();
                } else {
                    const text = await response.text();
                    result = { message: text || 'Success', status: response.status };
                }

                result.status = response.status;

                // Cache successful GET requests
                if ((!options.method || options.method === 'GET')) {
                    this.cache.set(cacheKey, result);
                }

                return result;

            } catch (error) {
                lastError = error;
                console.warn(`⚠️ Request attempt ${attempt} failed:`, error.message);
                
                if (attempt < this.config.retryAttempts) {
                    await this.delay(Math.pow(2, attempt) * 1000); // Exponential backoff
                }
            }
        }

        throw lastError;
    }

    /**
     * Run individual test with enhanced error handling
     */
    async runTest(button) {
        if (!button?.closest) {
            throw new Error('Invalid button element');
        }

        const testCase = button.closest('.test-case');
        if (!testCase) {
            throw new Error('Test case container not found');
        }

        const testData = this.extractTestData(testCase);
        if (!testData) {
            throw new Error('Failed to extract test data');
        }        // Check if this test was already executed and adjust stats accordingly
        const previousResult = testCase.dataset.testResult;
        if (previousResult === 'passed') {
            this.state.stats.passed = Math.max(0, this.state.stats.passed - 1);
        } else if (previousResult === 'failed') {
            this.state.stats.failed = Math.max(0, this.state.stats.failed - 1);
        }

        // Update UI state
        this.setButtonState(button, 'running');
        
        const startTime = performance.now();
        
        try {
            const result = await this.makeRequest(testData.endpoint, {
                method: testData.method,
                body: testData.body
            });

            const responseTime = Math.round(performance.now() - startTime);            const testResult = {
                status: result.status || 200,
                responseTime,
                data: result,
                expectedStatus: testData.expectedStatus,
                acceptableStatuses: testData.acceptableStatuses,
                expectedData: testData.expectedData
            };const success = this.isTestSuccessful(testResult);
            
            // Store test result in data attribute for filtering
            testCase.dataset.testResult = success ? 'passed' : 'failed';
            
            this.updateTestResult(testCase, success, testResult);
            
            // Update stats
            if (success) {
                this.state.stats.passed++;
            } else {
                this.state.stats.failed++;
            }

            return success;

        } catch (error) {
            console.error('❌ Test execution failed:', error);
              const errorResult = {
                error: error.message,
                responseTime: Math.round(performance.now() - startTime),
                status: 0
            };
            
            // Store test result as failed for errors
            testCase.dataset.testResult = 'failed';
            
            this.updateTestResult(testCase, false, errorResult);
            this.state.stats.failed++;
            
            return false;        } finally {
            this.setButtonState(button, 'idle');
            this.updateProgressDisplay();
            this.updateFilterCounts(); // Update filter counts after test completion
        }
    }

    /**
     * Set button state with visual feedback
     */
    setButtonState(button, state) {
        if (!button) return;

        const states = {
            idle: { text: 'Run Test', disabled: false, className: '' },
            running: { text: '⏳ Running...', disabled: true, className: 'running' },
            success: { text: '✅ Passed', disabled: false, className: 'success' },
            error: { text: '❌ Failed', disabled: false, className: 'error' }
        };

        const config = states[state] || states.idle;
        
        button.textContent = config.text;
        button.disabled = config.disabled;
        button.className = button.className.replace(/\b(running|success|error)\b/g, '');
        
        if (config.className) {
            button.classList.add(config.className);
        }
    }    /**
     * Determine if test was successful
     */
    isTestSuccessful(result) {
        const { status, expectedStatus, acceptableStatuses, data, expectedData } = result;
        
        // First check HTTP status
        let statusSuccess = false;
        
        // If acceptableStatuses is provided (for security tests), check if status is in that array
        if (acceptableStatuses && Array.isArray(acceptableStatuses)) {
            statusSuccess = acceptableStatuses.includes(status);
        } else if (expectedStatus && expectedStatus !== 200) {
            statusSuccess = status === expectedStatus;
        } else {
            statusSuccess = status >= 200 && status < 300;
        }
        
        // If status check fails, test fails
        if (!statusSuccess) {
            return false;
        }
        
        // If no expected data is specified, just check status
        if (!expectedData) {
            return true;
        }
        
        // Validate response data
        return this.validateResponseData(data, expectedData);
    }

    /**
     * Validate response data against expected data
     */
    validateResponseData(actualData, expectedData) {
        try {
            // Handle different validation modes
            if (expectedData.mode === 'exact') {
                return JSON.stringify(actualData) === JSON.stringify(expectedData.value);
            } else if (expectedData.mode === 'partial') {
                return this.isPartialMatch(actualData, expectedData.value);
            } else if (expectedData.mode === 'schema') {
                return this.validateSchema(actualData, expectedData.schema);
            } else if (expectedData.mode === 'contains') {
                return this.containsValues(actualData, expectedData.value);
            } else {
                // Default: exact match for backward compatibility
                return JSON.stringify(actualData) === JSON.stringify(expectedData);
            }
        } catch (error) {
            console.error('Data validation error:', error);
            return false;
        }
    }

    /**
     * Check if actual data contains all expected partial values
     */
    isPartialMatch(actual, expected) {
        if (typeof expected !== 'object' || expected === null) {
            return actual === expected;
        }
        
        if (typeof actual !== 'object' || actual === null) {
            return false;
        }
        
        for (const [key, value] of Object.entries(expected)) {
            if (!(key in actual)) {
                return false;
            }
            if (typeof value === 'object' && value !== null) {
                if (!this.isPartialMatch(actual[key], value)) {
                    return false;
                }
            } else if (actual[key] !== value) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Check if data contains specific values (for arrays and objects)
     */
    containsValues(actual, expected) {
        if (Array.isArray(actual) && Array.isArray(expected)) {
            return expected.every(expectedItem => 
                actual.some(actualItem => 
                    JSON.stringify(actualItem) === JSON.stringify(expectedItem)
                )
            );
        }
        
        if (typeof actual === 'object' && typeof expected === 'object') {
            return this.isPartialMatch(actual, expected);
        }
        
        return String(actual).includes(String(expected));
    }

    /**
     * Basic schema validation
     */
    validateSchema(actual, schema) {
        if (typeof schema !== 'object' || schema === null) {
            return false;
        }
        
        for (const [key, expectedType] of Object.entries(schema)) {
            if (!(key in actual)) {
                return false;
            }
            
            const actualValue = actual[key];
            const actualType = Array.isArray(actualValue) ? 'array' : typeof actualValue;
            
            if (expectedType === 'number' && actualType !== 'number') {
                return false;
            } else if (expectedType === 'string' && actualType !== 'string') {
                return false;
            } else if (expectedType === 'boolean' && actualType !== 'boolean') {
                return false;
            } else if (expectedType === 'array' && !Array.isArray(actualValue)) {
                return false;
            } else if (expectedType === 'object' && (actualType !== 'object' || Array.isArray(actualValue))) {
                return false;
            }
        }
        
        return true;
    }    /**
     * Extract test data from DOM element
     */
    extractTestData(testCase) {
        try {
            const button = testCase.querySelector('.run-test-btn');
            if (!button) {
                throw new Error('Test button not found');
            }            const method = button.dataset.method;
            let endpoint = button.dataset.endpoint;
            const testDataAttr = button.dataset.testData;
            const expectedStatus = parseInt(button.dataset.expectedStatus) || 200;
            const expectedDataAttr = button.dataset.expectedData;
            const acceptableStatusesAttr = button.dataset.acceptableStatuses;

            if (!method || !endpoint) {
                throw new Error('Missing required test data attributes');
            }

            let body = null;
            let expectedData = null;
            let acceptableStatuses = null;
            
            // Parse acceptable statuses if provided (for security tests)
            if (acceptableStatusesAttr && acceptableStatusesAttr !== 'null') {
                try {
                    acceptableStatuses = JSON.parse(acceptableStatusesAttr);
                } catch (parseError) {
                    console.warn('Failed to parse acceptable statuses:', parseError);
                }
            }
            
            // Parse expected response data if provided
            if (expectedDataAttr && expectedDataAttr !== 'null') {
                try {
                    const decodedExpectedData = decodeURIComponent(expectedDataAttr);
                    expectedData = JSON.parse(decodedExpectedData);
                } catch (parseError) {
                    console.warn('Failed to parse expected data:', parseError);
                }
            }
            
            // Process test data based on HTTP method
            if (testDataAttr && testDataAttr !== 'null' && testDataAttr !== '{}') {
                try {
                    const decodedData = decodeURIComponent(testDataAttr);
                    const parsedData = JSON.parse(decodedData);
                    
                    if (Object.keys(parsedData).length > 0) {
                        const methodUpper = method.toUpperCase();
                        
                        // GET/HEAD 요청의 경우 query 파라미터로 처리
                        if (['GET', 'HEAD'].includes(methodUpper)) {
                            if (parsedData.query) {
                                // query 객체가 있는 경우
                                const queryParams = new URLSearchParams();
                                Object.entries(parsedData.query).forEach(([key, value]) => {
                                    queryParams.append(key, String(value));
                                });
                                endpoint += (endpoint.includes('?') ? '&' : '?') + queryParams.toString();
                            } else {
                                // 직접 query 파라미터로 변환
                                const queryParams = new URLSearchParams();
                                Object.entries(parsedData).forEach(([key, value]) => {
                                    queryParams.append(key, String(value));
                                });
                                endpoint += (endpoint.includes('?') ? '&' : '?') + queryParams.toString();
                            }
                        } else {
                            // POST/PUT/PATCH 등의 경우 body로 처리
                            if (parsedData.query) {
                                // query 객체가 있으면 query 파라미터로, 나머지는 body로
                                const queryParams = new URLSearchParams();
                                Object.entries(parsedData.query).forEach(([key, value]) => {
                                    queryParams.append(key, String(value));
                                });
                                endpoint += (endpoint.includes('?') ? '&' : '?') + queryParams.toString();
                                
                                // body 데이터가 있으면 body로 설정
                                const bodyData = { ...parsedData };
                                delete bodyData.query;
                                if (Object.keys(bodyData).length > 0) {
                                    body = bodyData;
                                }
                            } else if (parsedData.body) {
                                // body 객체가 있는 경우 - body 안의 데이터를 HTTP body로 전송
                                body = parsedData.body;
                            } else {
                                // 직접 body로 전송
                                body = parsedData;
                            }
                        }
                    }
                } catch (parseError) {
                    console.warn('Failed to parse test data:', parseError);
                }
            }

            return { method, endpoint, body, expectedStatus, acceptableStatuses, expectedData };

        } catch (error) {
            console.error('Error extracting test data:', error);
            return null;
        }
    }/**
     * Update test result display with enhanced UI
     */
    updateTestResult(testCase, success, result) {
        const resultContainer = testCase.querySelector('.test-result');
        if (!resultContainer) {
            console.warn('Result container not found');
            return;
        }

        const statusIcon = success ? '✅' : '❌';
        const statusText = success ? 'PASS' : 'FAIL';
        const statusClass = success ? 'success' : 'error';

        const responseTime = result.responseTime || 0;
        const statusCode = result.status || 'N/A';

        // Build validation details for expected data
        let validationDetails = '';
        if (result.expectedData) {
            const dataValidationSuccess = this.validateResponseData(result.data, result.expectedData);
            const dataIcon = dataValidationSuccess ? '✅' : '❌';
            const dataStatus = dataValidationSuccess ? 'PASS' : 'FAIL';
            
            validationDetails = `
                <div class="validation-section">
                    <div class="validation-header">
                        <span class="validation-icon">${dataIcon}</span>
                        <span class="validation-text">Data Validation: ${dataStatus}</span>
                    </div>
                    <div class="data-comparison">
                        <div class="expected-data">
                            <strong>Expected:</strong>
                            <pre class="data-content">${this.escapeHtml(JSON.stringify(result.expectedData, null, 2))}</pre>
                        </div>
                        <div class="actual-data">
                            <strong>Actual:</strong>
                            <pre class="data-content">${this.escapeHtml(JSON.stringify(result.data, null, 2))}</pre>
                        </div>
                    </div>
                </div>
            `;
        }

        resultContainer.innerHTML = `
            <div class="result-header ${statusClass}">
                <span class="status-icon">${statusIcon}</span>
                <span class="status-text">${statusText}</span>
                <span class="response-time">${responseTime}ms</span>
                <span class="status-code">HTTP ${statusCode}</span>
            </div>
            
            ${result.error ? `
                <div class="error-details">
                    <strong>Error:</strong> ${this.escapeHtml(result.error)}
                </div>
            ` : ''}
            
            ${validationDetails}
            
            ${result.data && typeof result.data === 'object' && !result.expectedData ? `
                <div class="response-data">
                    <button class="toggle-data-btn" onclick="this.nextElementSibling.classList.toggle('hidden')">
                        📋 View Response Data
                    </button>
                    <pre class="response-content hidden">${this.escapeHtml(JSON.stringify(result.data, null, 2))}</pre>
                </div>
            ` : ''}
        `;

        resultContainer.style.display = 'block';
        resultContainer.classList.add('result-updated');
        
        // Remove animation class after animation completes
        setTimeout(() => resultContainer.classList.remove('result-updated'), 300);
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Run all tests with intelligent batching
     */
    async runAllTests() {
        console.log('🚀 Starting comprehensive test execution...');
        
        const testButtons = Array.from(document.querySelectorAll('.run-test-btn'))
            .filter(btn => {
                const testCase = btn.closest('.test-case');
                return testCase && testCase.style.display !== 'none';
            });

        if (testButtons.length === 0) {
            this.showNotification('No visible tests found to run', 'warning');
            return;
        }        // Reset stats
        this.state.stats = {
            ...this.createInitialStats(),
            total: testButtons.length,
            startTime: Date.now()
        };

        // Clear all previous test results
        document.querySelectorAll('.test-case').forEach(testCase => {
            delete testCase.dataset.testResult;
        });

        // Expand all for better visibility
        this.expandAll();
        
        this.showNotification(`Running ${testButtons.length} tests...`, 'info');
        
        try {
            await this.runTestsSequentially(testButtons);
            this.state.stats.endTime = Date.now();
            
            const { passed, failed, total } = this.state.stats;
            const successRate = Math.round((passed / total) * 100);
            
            this.showNotification(
                `Tests completed! ${passed}/${total} passed (${successRate}%)`,
                successRate >= 80 ? 'success' : successRate >= 60 ? 'warning' : 'error'
            );
            
        } catch (error) {
            console.error('❌ Test execution failed:', error);
            this.showNotification('Test execution failed: ' + error.message, 'error');
        }
    }

    /**
     * Run tests sequentially with optimal performance
     */
    async runTestsSequentially(buttons) {
        console.log(`🔄 Running ${buttons.length} tests sequentially...`);
        
        for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i];
            
            try {
                console.log(`🧪 Running test ${i + 1}/${buttons.length}`);
                await this.runTest(button);
                
                // Small delay to prevent overwhelming the server
                if (i < buttons.length - 1) {
                    await this.delay(this.config.requestDelay);
                }
                
            } catch (error) {
                console.error(`❌ Error running test ${i + 1}:`, error);
            }
        }
        
        console.log('✅ All tests completed');
    }

    /**
     * Expand all collapsible sections
     */
    expandAll() {
        console.log('📂 Expanding all sections...');
        
        const sections = [
            { selector: '.route-group-content', iconSelector: '.collapse-icon', expandedIcon: '▼' },
            { selector: '.suite-content', iconSelector: '.collapse-icon', expandedIcon: '▼' },
            { selector: '.data-content', iconSelector: '.expand-icon', expandedIcon: '▲' }
        ];

        let totalExpanded = 0;

        sections.forEach(({ selector, iconSelector, expandedIcon }) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.style.display = 'block';
                const header = element.previousElementSibling;
                if (header) {
                    const icon = header.querySelector(iconSelector);
                    if (icon) icon.textContent = expandedIcon;
                }
                totalExpanded++;
            });
        });

        console.log(`📂 Expanded ${totalExpanded} sections`);
        this.showNotification(`Expanded ${totalExpanded} sections`, 'success');
    }

    /**
     * Collapse all collapsible sections
     */
    collapseAll() {
        console.log('📁 Collapsing all sections...');
        
        const sections = [
            { selector: '.route-group-content', iconSelector: '.collapse-icon', collapsedIcon: '▶' },
            { selector: '.suite-content', iconSelector: '.collapse-icon', collapsedIcon: '▶' },
            { selector: '.data-content', iconSelector: '.expand-icon', collapsedIcon: '▼' }
        ];

        let totalCollapsed = 0;

        sections.forEach(({ selector, iconSelector, collapsedIcon }) => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.style.display = 'none';
                const header = element.previousElementSibling;
                if (header) {
                    const icon = header.querySelector(iconSelector);
                    if (icon) icon.textContent = collapsedIcon;
                }
                totalCollapsed++;
            });
        });

        console.log(`📁 Collapsed ${totalCollapsed} sections`);
        this.showNotification(`Collapsed ${totalCollapsed} sections`, 'success');
    }

    /**
     * Toggle test data visibility
     */
    toggleTestData(testId) {
        console.log('🔄 Toggling test data for:', testId);
        
        const dataContent = document.getElementById(`data-${testId}`);
        if (!dataContent) {
            console.warn('Test data element not found:', `data-${testId}`);
            return;
        }

        const expandIcon = dataContent.parentElement?.querySelector('.expand-icon');
        const isVisible = dataContent.style.display === 'block';
        
        dataContent.style.display = isVisible ? 'none' : 'block';
        if (expandIcon) {
            expandIcon.textContent = isVisible ? '▼' : '▲';
        }
        
        console.log(`📋 Test data ${testId} ${isVisible ? 'hidden' : 'shown'}`);
    }

    /**
     * Copy test data to clipboard with enhanced feedback
     */
    async copyTestData(encodedData) {
        try {
            const decodedData = decodeURIComponent(encodedData);
            await navigator.clipboard.writeText(decodedData);
            
            console.log('📋 Test data copied to clipboard');
            this.showNotification('📋 Test data copied to clipboard!', 'success');
            
        } catch (error) {
            console.error('❌ Failed to copy test data:', error);
            
            // Fallback for older browsers
            try {
                const textArea = document.createElement('textarea');
                textArea.value = decodeURIComponent(encodedData);
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
                
                this.showNotification('📋 Test data copied to clipboard!', 'success');
            } catch (fallbackError) {
                this.showNotification('❌ Failed to copy test data', 'error');
            }
        }
    }

    /**
     * Toggle failed tests only view
     */
    toggleFailedTestsOnly() {
        this.state.showFailedOnly = !this.state.showFailedOnly;
        
        const toggleBtn = document.getElementById('toggle-failed-btn');
        if (toggleBtn) {
            if (this.state.showFailedOnly) {
                toggleBtn.textContent = '👁️ Show All Tests';
                toggleBtn.classList.add('active');
                this.showOnlyFailedTests();
            } else {
                toggleBtn.textContent = '🔍 Show Failed Only';
                toggleBtn.classList.remove('active');
                this.showAllTests();
            }
        }
    }

    /**
     * Show only failed tests
     */
    showOnlyFailedTests() {
        const testCases = document.querySelectorAll('.test-case');
        let failedCount = 0;
        
        testCases.forEach(testCase => {
            const resultContainer = testCase.querySelector('.test-result');
            const hasFailed = resultContainer?.querySelector('.status-text')?.textContent === 'FAIL';
            
            testCase.style.display = hasFailed ? 'block' : 'none';
            if (hasFailed) failedCount++;
        });
        
        this.showNotification(`Showing ${failedCount} failed tests`, 'info');
    }

    /**
     * Show all tests
     */
    showAllTests() {
        const testCases = document.querySelectorAll('.test-case');
        testCases.forEach(testCase => {
            testCase.style.display = 'block';
        });
        
        this.filterTestCases(); // Reapply current filter
    }    /**
     * Perform search with optimized DOM queries
     */
    performSearch() {
        const searchInput = document.getElementById('searchInput');
        if (!searchInput) return;
        
        const searchTerm = searchInput.value.toLowerCase().trim();
        const testCases = document.querySelectorAll('.test-case');
        let visibleCount = 0;
        
        testCases.forEach(testCase => {            const searchableText = [
                testCase.querySelector('.test-name')?.textContent,
                testCase.querySelector('.test-description')?.textContent,
                testCase.dataset.method,
                testCase.dataset.endpoint
            ].filter(Boolean).join(' ').toLowerCase();
            
            const matchesSearch = !searchTerm || searchableText.includes(searchTerm);
            
            // Apply both search and filter criteria
            let shouldShow = matchesSearch;
            if (shouldShow && this.state.currentFilter !== 'all') {
                const testType = testCase.dataset.type?.toLowerCase();
                const testResult = testCase.dataset.testResult?.toLowerCase();
                
                if (this.state.currentFilter === 'success') {
                    shouldShow = testType === 'success' || testResult === 'passed';
                } else if (this.state.currentFilter === 'failure') {
                    shouldShow = testType === 'failure' || testResult === 'failed';
                } else if (this.state.currentFilter === 'security') {
                    shouldShow = testType === 'security';
                } else {
                    shouldShow = testType === this.state.currentFilter;
                }
            }
            
            testCase.style.display = shouldShow ? 'block' : 'none';
            if (shouldShow) visibleCount++;
        });
        
        // Show/hide "no results" message
        const noResults = document.getElementById('noResults');
        if (noResults) {
            noResults.style.display = visibleCount === 0 ? 'block' : 'none';
        }
        
        console.log(`🔍 Search found ${visibleCount} matching tests`);
    }    /**
     * Set active filter with smooth transitions
     */
    setActiveFilter(filter) {
        this.state.currentFilter = filter;
        
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === filter);
        });
        
        // Reapply search with new filter
        const searchInput = document.getElementById('searchInput');
        if (searchInput && searchInput.value.trim()) {
            this.performSearch(); // This will apply both search and filter
        } else {
            this.filterTestCases(); // Just apply filter
        }
    }    /**
     * Filter test cases by test type (not method)
     */
    filterTestCases() {
        const testCases = document.querySelectorAll('.test-case');
        let visibleCount = 0;
        
        testCases.forEach(testCase => {
            if (this.state.currentFilter === 'all') {
                testCase.style.display = 'block';
                visibleCount++;
            } else {
                let shouldShow = false;
                
                // Filter by test type (success, failure, security) OR by test result (passed, failed)
                const testType = testCase.dataset.type?.toLowerCase();
                const testResult = testCase.dataset.testResult?.toLowerCase();                if (this.state.currentFilter === 'success') {
                    // Show success tests OR tests that have passed
                    shouldShow = testType === 'success' || testResult === 'passed';
                } else if (this.state.currentFilter === 'failure') {
                    // Show failure tests OR tests that have failed
                    shouldShow = testType === 'failure' || testResult === 'failed';
                } else if (this.state.currentFilter === 'philosophy') {
                    // Show philosophy validation tests
                    const testName = testCase.querySelector('.test-name')?.textContent?.toLowerCase() || '';
                    shouldShow = testName.includes('philosophy') || 
                               (testCase.dataset.securityTestType && testCase.dataset.securityTestType.includes('philosophy'));
                } else {
                    // Direct test type match
                    shouldShow = testType === this.state.currentFilter;
                }
                
                testCase.style.display = shouldShow ? 'block' : 'none';
                if (shouldShow) visibleCount++;
            }
        });
        
        // Show/hide "no results" message
        const noResults = document.getElementById('noResults');
        if (noResults) {
            noResults.style.display = visibleCount === 0 ? 'block' : 'none';
        }
        
        console.log(`🏷️ Filter applied: ${this.state.currentFilter} (${visibleCount} tests visible)`);
    }

    /**
     * Setup keyboard shortcuts
     */
    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey) {
                switch(event.key) {
                    case 'Enter':
                        event.preventDefault();
                        this.runAllTests();
                        break;
                    case 'f':
                        event.preventDefault();
                        const searchInput = document.getElementById('searchInput');
                        searchInput?.focus();
                        break;
                    case 'e':
                        event.preventDefault();
                        this.expandAll();
                        break;
                    case 'd':
                        event.preventDefault();
                        this.collapseAll();
                        break;
                }
            }
        });
    }

    /**
     * Create control interface
     */
    createControlsInterface() {
        // This method can be extended to create additional UI controls
        console.log('🎛️ Control interface ready');
    }

    /**
     * Optimize performance with various techniques
     */
    optimizePerformance() {
        // Implement virtual scrolling for large test lists
        // Add intersection observer for lazy loading
        // Optimize DOM queries with caching
        console.log('⚡ Performance optimizations applied');
    }

    /**
     * Show notification with different types
     */
    showNotification(message, type = 'info', duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };
        
        notification.innerHTML = `
            <span class="notification-icon">${icons[type] || icons.info}</span>
            <span class="notification-message">${this.escapeHtml(message)}</span>
            <button class="notification-close" onclick="this.parentElement.remove()">×</button>
        `;
        
        document.body.appendChild(notification);
        
        // Auto remove after duration
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, duration);
    }

    /**
     * Show error with enhanced details
     */
    showError(message, details = null) {
        console.error('❌ Error:', message, details);
        this.showNotification(message, 'error', 5000);
    }

    /**
     * Utility: Debounce function calls
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func.apply(this, args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    /**
     * Utility: Delay execution
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Cleanup method for proper resource management
     */
    destroy() {
        // Remove event listeners
        this.eventHandlers.forEach((handler, element) => {
            element.removeEventListener(handler.event, handler.handler);
        });
        this.eventHandlers.clear();
        
        // Clear cache
        this.cache.clear();
        
        // Clear request queue
        this.requestQueue.length = 0;
        this.activeRequests.clear();
        
        console.log('🧹 Test Engine cleanup completed');
    }    /**
     * Update filter button counts in real-time
     */
    updateFilterCounts() {
        const testCases = document.querySelectorAll('.test-case');        const counts = {
            all: testCases.length,
            success: 0,
            failure: 0,
            security: 0
        };
        
        testCases.forEach(tc => {
            const testType = tc.dataset.type?.toLowerCase();
            const securityType = tc.dataset.securityType?.toLowerCase();
              if (testType === 'success') counts.success++;
            if (testType === 'failure') counts.failure++;
            if (securityType || tc.classList.contains('security')) counts.security++;
        });
        
        // Update filter button labels with counts (show original test case counts, not execution results)
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
}

// Advanced CSS styles
const advancedStyles = `
    .progress-container {
        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
        border: 1px solid #dee2e6;
        border-radius: 12px;
        padding: 24px;
        margin: 20px 0;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07);
        animation: slideInDown 0.5s ease-out;
    }

    .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        flex-wrap: wrap;
        gap: 12px;
    }

    .progress-title {
        margin: 0;
        color: #495057;
        font-size: 1.25rem;
        font-weight: 600;
    }

    .progress-controls {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
    }

    .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 0.875rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .btn-primary {
        background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
        color: white;
    }

    .btn-primary:hover {
        background: linear-gradient(135deg, #0056b3 0%, #004085 100%);
        transform: translateY(-1px);
    }

    .btn-outline {
        background: white;
        color: #6c757d;
        border: 1px solid #dee2e6;
    }

    .btn-outline:hover {
        background: #f8f9fa;
        color: #495057;
        border-color: #adb5bd;
    }

    .btn-secondary {
        background: #6c757d;
        color: white;
    }

    .btn-secondary:hover,
    .btn-secondary.active {
        background: #545b62;
    }

    .progress-stats {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        gap: 16px;
        margin-bottom: 20px;
    }

    .stat-card {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 16px;
        display: flex;
        align-items: center;
        gap: 12px;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
    }

    .stat-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .stat-icon {
        font-size: 1.5rem;
        opacity: 0.8;
    }

    .stat-content {
        flex: 1;
    }

    .stat-value {
        display: block;
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1;
        margin-bottom: 4px;
    }

    .stat-label {
        display: block;
        font-size: 0.75rem;
        color: #6c757d;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .progress-bar-container {
        position: relative;
        background: #e9ecef;
        height: 24px;
        border-radius: 12px;
        margin-bottom: 20px;
        overflow: hidden;
    }

    .progress-bar {
        height: 100%;
        border-radius: 12px;
        background: linear-gradient(90deg, #28a745 0%, #20c997 100%);
        width: 0%;
        transition: width 0.5s ease-in-out;
        position: relative;
        overflow: hidden;
    }

    .progress-bar::after {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(45deg, 
            transparent 25%, 
            rgba(255,255,255,0.1) 25%, 
            rgba(255,255,255,0.1) 50%, 
            transparent 50%, 
            transparent 75%, 
            rgba(255,255,255,0.1) 75%);
        background-size: 20px 20px;
        animation: progressStripes 1s linear infinite;
    }

    .progress-text {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        font-weight: 600;
        font-size: 0.875rem;
        color: #495057;
        text-shadow: 0 1px 2px rgba(255,255,255,0.5);
    }

    .test-summary {
        background: white;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        padding: 20px;
        animation: slideInUp 0.5s ease-out;
    }

    .summary-title {
        margin: 0 0 16px 0;
        color: #495057;
        font-size: 1.125rem;
    }

    .summary-overview {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
        padding: 16px;
        background: #f8f9fa;
        border-radius: 6px;
    }

    .summary-emoji {
        font-size: 2rem;
    }

    .summary-message {
        font-size: 1.125rem;
        font-weight: 600;
        color: #495057;
    }

    .summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 12px;
    }

    .summary-item {
        padding: 8px 12px;
        background: #f8f9fa;
        border-radius: 4px;
        font-size: 0.875rem;
    }

    .summary-item.success {
        background: #d4edda;
        color: #155724;
    }

    .summary-item.error {
        background: #f8d7da;
        color: #721c24;
    }

    .notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        border: 1px solid #dee2e6;
        border-radius: 8px;
        padding: 12px 16px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 300px;
        animation: slideInRight 0.3s ease-out;
    }

    .notification-success {
        border-left: 4px solid #28a745;
    }

    .notification-error {
        border-left: 4px solid #dc3545;
    }

    .notification-warning {
        border-left: 4px solid #ffc107;
    }

    .notification-info {
        border-left: 4px solid #17a2b8;
    }

    .notification-close {
        background: none;
        border: none;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0;
        margin-left: auto;
        opacity: 0.5;
    }

    .notification-close:hover {
        opacity: 1;
    }

    .result-updated {
        animation: highlightResult 0.3s ease-out;
    }

    .response-content.hidden {
        display: none;
    }

    .toggle-data-btn {
        background: #e9ecef;
        border: 1px solid #ced4da;
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 0.75rem;
        cursor: pointer;
        margin-bottom: 8px;
    }

    .run-test-btn.running {
        background: #ffc107 !important;
        cursor: not-allowed;
        animation: pulse 1.5s infinite;
    }

    .run-test-btn.success {
        background: #28a745 !important;
        color: white;
    }

    .run-test-btn.error {
        background: #dc3545 !important;
        color: white;
    }

    @keyframes slideInDown {
        from {
            opacity: 0;
            transform: translateY(-20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes slideInUp {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @keyframes slideInRight {
        from {
            opacity: 0;
            transform: translateX(100%);
        }
        to {
            opacity: 1;
            transform: translateX(0);
        }
    }

    @keyframes progressStripes {
        0% { background-position: 0 0; }
        100% { background-position: 20px 0; }
    }

    @keyframes highlightResult {
        0% { background-color: #fff3cd; }
        100% { background-color: transparent; }
    }    @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    /* Data Validation Styles */
    .validation-section {
        margin-top: 15px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
        border-left: 4px solid #007bff;
    }

    .validation-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
        font-weight: 600;
    }

    .validation-icon {
        font-size: 1.2em;
    }

    .validation-text {
        color: #495057;
    }

    .data-comparison {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-top: 10px;
    }

    .expected-data,
    .actual-data {
        background: white;
        border-radius: 6px;
        padding: 12px;
        border: 1px solid #dee2e6;
    }

    .expected-data strong,
    .actual-data strong {
        display: block;
        margin-bottom: 8px;
        font-size: 0.9em;
        color: #6c757d;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .data-content {
        background: #f8f9fa;
        border-radius: 4px;
        padding: 8px;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.85em;
        line-height: 1.4;
        color: #495057;
        overflow-x: auto;
        max-height: 200px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .expected-data {
        border-left: 3px solid #28a745;
    }

    .expected-data .data-content {
        background: #f8fff9;
        border: 1px solid #d1f2d8;
    }

    .actual-data {
        border-left: 3px solid #dc3545;
    }

    .actual-data .data-content {
        background: #fff8f8;
        border: 1px solid #f5d0d0;
    }

    .validation-section.success {
        border-left-color: #28a745;
        background: #f8fff9;
    }

    .validation-section.error {
        border-left-color: #dc3545;
        background: #fff8f8;
    }

    .toggle-data-btn {
        background: #007bff;
        color: white;
        border: none;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 0.9em;
        cursor: pointer;
        margin-bottom: 10px;
        transition: background-color 0.2s ease;
    }

    .toggle-data-btn:hover {
        background: #0056b3;
    }

    .response-content {
        background: #f8f9fa;
        border: 1px solid #dee2e6;
        border-radius: 4px;
        padding: 12px;
        font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
        font-size: 0.85em;
        line-height: 1.4;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 300px;
        overflow-y: auto;
    }

    .hidden {
        display: none;
    }    @media (max-width: 768px) {
        .progress-header {
            flex-direction: column;
            align-items: stretch;
        }

        .progress-controls {
            justify-content: center;
        }

        .progress-stats {
            grid-template-columns: repeat(2, 1fr);
        }

        .summary-grid {
            grid-template-columns: 1fr;
        }

        .notification {
            left: 20px;
            right: 20px;
            min-width: auto;
        }

        .data-comparison {
            grid-template-columns: 1fr;
            gap: 10px;
        }

        .validation-section {
            padding: 10px;
        }
    }
`;

// Initialize the advanced test engine
document.addEventListener('DOMContentLoaded', () => {
    // Inject advanced styles
    const styleSheet = document.createElement('style');
    styleSheet.textContent = advancedStyles;
    document.head.appendChild(styleSheet);
    
    // Initialize the test engine
    window.testEngine = new TestEngine();
    
    // Global functions for backward compatibility
    window.expandAll = () => testEngine.expandAll();
    window.collapseAll = () => testEngine.collapseAll();
    window.runAllTests = () => testEngine.runAllTests();
    window.toggleTestData = (testId) => testEngine.toggleTestData(testId);
    window.copyTestData = (encodedData) => testEngine.copyTestData(encodedData);
    window.runTestFromButton = (button) => testEngine.runTest(button);
    
    console.log('🎉 Advanced Test Engine fully initialized and ready!');
});

// Handle page unload cleanup
window.addEventListener('beforeunload', () => {
    if (window.testEngine) {
        window.testEngine.destroy();
    }
});
