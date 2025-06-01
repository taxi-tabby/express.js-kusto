/**
 * Additional fixes for test progress tracking and display
 */
document.addEventListener('DOMContentLoaded', function() {
  // Log init
  console.log('Progress fix script loaded');
  
  // Wait for all content to load
  setTimeout(function() {
    // Fix summary grid display if needed
    fixSummaryGridDisplay();
    
    // Ensure the runTestFromButton function exists globally
    ensureGlobalRunTestFromButton();
    
    // Ensure runTest handles all parameter formats
    ensureCompatibleRunTest();
    
    // Make progress container visible
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      console.log('Making progress container visible');
      progressContainer.style.display = 'block';
      progressContainer.style.visibility = 'visible';
      progressContainer.style.opacity = '1';
    }
  }, 1000);
});

// Fix summary grid display
function fixSummaryGridDisplay() {
  const summaryGrid = document.querySelector('.summary-grid');
  if (summaryGrid) {
    console.log('Fixing summary grid display');
    Object.assign(summaryGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: '20px',
      marginBottom: '20px',
      width: '100%',
      maxWidth: '900px',
      marginLeft: 'auto',
      marginRight: 'auto',
      visibility: 'visible',
      opacity: '1'
    });
  } else {
    console.warn('Summary grid not found');
  }
}

// Ensure runTestFromButton is available globally
function ensureGlobalRunTestFromButton() {
  // Save the original function if it exists
  const originalFn = window.runTestFromButton;
  
  // Create or override the global function safely
  console.log('Setting up safe global runTestFromButton wrapper');
  window.runTestFromButton = function(button) {
    // Safety check
    if (!button) {
      console.error('Button is null or undefined in runTestFromButton');
      return;
    }
    
    try {
      // Get parameters
      const method = button.getAttribute('data-method');
      const endpoint = button.getAttribute('data-endpoint');
      const testDataStr = button.getAttribute('data-test-data');
      const expectedStatus = parseInt(button.getAttribute('data-expected-status'), 10);
      const resultId = button.getAttribute('data-result-id');
      
      console.log('runTestFromButton wrapper with:', { method, endpoint, expectedStatus });
      
      // Parse data
      let dataObj = {};
      try {
        dataObj = JSON.parse(decodeURIComponent(testDataStr || '{}'));
      } catch (e) {
        console.warn('Failed to parse test data:', e);
      }
        // Choose the appropriate runTest function and call with correct parameter order
      if (typeof window.runTest === 'function') {
        console.log('Using window.runTest from global wrapper with button-first signature');
        return window.runTest(button, endpoint, method, dataObj, expectedStatus);
      } else if (typeof runTest === 'function') {
        console.log('Using local runTest from global wrapper with button-first signature');
        return runTest(button, endpoint, method, dataObj, expectedStatus);
      } else {
        console.error('No runTest function found!');
        alert('Test execution failed: runTest function not found');
      }
    } catch (e) {
      console.error('Error in runTestFromButton wrapper:', e);
      alert('An error occurred while running the test');
    }
  };
}

// Ensure runTest is compatible with all parameter formats
function ensureCompatibleRunTest() {
  // Only apply the wrapper if runTest exists and hasn't been wrapped already
  if (typeof window.runTest !== 'function') {
    console.warn('No global runTest function found');
    return;
  }
  
  // Check if we've already wrapped this function
  if (window.runTest._isWrapped) {
    console.log('runTest is already wrapped, skipping');
    return;
  }
  
  // Save the original function
  if (!window.originalRunTest) {
    window.originalRunTest = window.runTest;
  }
  
  // Create a safe wrapper function
  window.runTest = function() {
    console.log('Universal runTest wrapper called with:', Array.from(arguments));
    
    try {
      // Add parameter validation and normalization
      const args = Array.from(arguments);
      
      // Detect parameter format
      const isButtonFirst = args[0] && typeof args[0] === 'object' && args[0].tagName;
      const isObjectParam = args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !args[0].tagName;
      
      // Handle button-first format
      if (isButtonFirst) {
        // Button-first format: button, endpoint, method, dataStr, expectedStatus
        const button = args[0];
        
        // Add safety check for button.closest
        if (!button || typeof button.closest !== 'function') {
          console.warn('Button element missing closest method, creating fallback element');
          
          // Create a temporary button with closest method
          const tempButton = document.createElement('button');
          tempButton.closest = function(selector) {
            return document.querySelector(selector);
          };
          
          // Copy attributes if possible
          if (button) {
            for (const attr of ['data-method', 'data-endpoint', 'data-test-data', 'data-expected-status', 'data-result-id']) {
              if (button.getAttribute && button.getAttribute(attr)) {
                tempButton.setAttribute(attr, button.getAttribute(attr));
              }
            }
          }
          
          // Replace the button in arguments
          args[0] = tempButton;
        }
      }
      // Call original with normalized parameters
      return window.originalRunTest.apply(this, args);
    } catch (e) {
      console.error('Error in runTest wrapper:', e);
      // Don't alert here, just log the error
      return Promise.reject(e);
    }
  };
  
  // Mark as wrapped to avoid double-wrapping
  window.runTest._isWrapped = true;
}
