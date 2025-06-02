/**
 * Progress Display Fixes - Minimal & Clean
 * Ensures test progress elements are properly visible
 */

(function() {
  'use strict';

  // Configuration
  const CONFIG = {
    INIT_DELAY: 200,
    DEBUG: false
  };

  // Utility logging
  function log(message, data) {
    if (CONFIG.DEBUG) {
      console.log(`[ProgressFix] ${message}`, data || '');
    }
  }

  // Ensure runTestFromButton global function exists
  function ensureRunTestFromButton() {
    if (typeof window.runTestFromButton !== 'function') {
      log('Creating runTestFromButton global function');
      
      window.runTestFromButton = function(button) {
        if (!button) {
          console.error('runTestFromButton: Button is null');
          return;
        }

        try {
          // Extract test data from button attributes
          const method = button.getAttribute('data-method');
          const endpoint = button.getAttribute('data-endpoint');
          const testDataStr = button.getAttribute('data-test-data');
          const expectedStatus = parseInt(button.getAttribute('data-expected-status'), 10);

          // Parse test data
          let testData = {};
          if (testDataStr) {
            try {
              testData = JSON.parse(decodeURIComponent(testDataStr));
            } catch (e) {
              console.warn('Failed to parse test data, using empty object');
            }
          }          // Call the optimized runTest function (only takes button parameter)
          if (typeof runTest === 'function') {
            return runTest(button);
          } else {
            console.error('runTest function not found');
            alert('Test execution failed: runTest function not available');
          }
        } catch (error) {
          console.error('Error in runTestFromButton:', error);
          alert('Test execution failed: ' + error.message);
        }
      };
    }
  }

  // Main initialization
  function initialize() {
    log('Initializing progress fixes');

    // Ensure global functions exist
    ensureRunTestFromButton();

    // Force progress container visibility if it exists
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.style.display = 'block';
      progressContainer.style.visibility = 'visible';
      progressContainer.style.opacity = '1';
      log('Progress container visibility ensured');
    }

    log('Progress fixes initialization complete');
  }

  // DOM ready handler
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      setTimeout(initialize, CONFIG.INIT_DELAY);
    });
  } else {
    setTimeout(initialize, CONFIG.INIT_DELAY);
  }

})();
