// Add <link> to the head to load summary-styles.css
document.addEventListener('DOMContentLoaded', function() {
  // Add summary-styles.css if not already added
  if (!document.querySelector('link[href="/summary-styles.css"]')) {
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = '/summary-styles.css';
    document.head.appendChild(linkElement);
    console.log('Added summary-styles.css');
  }
  
  // Make test execution summary visible and fix any missing styles
  setTimeout(function() {
    // Fix summary-grid styling
    const summaryGrids = document.querySelectorAll('.summary-grid');
    if (summaryGrids.length) {
      console.log('Found summary-grid elements:', summaryGrids.length);
      summaryGrids.forEach(grid => {
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(3, 1fr)';
        grid.style.gap = '20px';
        grid.style.marginBottom = '20px';
      });
    }
    
    // Apply inline styles to summary items
    const summaryItems = document.querySelectorAll('.summary-item');
    summaryItems.forEach(item => {
      item.style.textAlign = 'center';
      item.style.padding = '20px';
      item.style.borderRadius = '10px';
      
      if (item.classList.contains('passed')) {
        item.style.background = '#ebfbee';
        item.style.border = '1px solid #d1fadf';
      } else if (item.classList.contains('failed')) {
        item.style.background = '#fff5f5';
        item.style.border = '1px solid #fed7d7';
      } else if (item.classList.contains('accuracy')) {
        item.style.background = '#ebf8ff';
        item.style.border = '1px solid #bee3f8';
      }
    });
    
    // Apply styles to summary numbers
    const summaryNumbers = document.querySelectorAll('.summary-number');
    summaryNumbers.forEach(number => {
      number.style.fontSize = '32px';
      number.style.fontWeight = 'bold';
      number.style.marginBottom = '5px';
      
      const parent = number.closest('.summary-item');
      if (parent) {
        if (parent.classList.contains('passed')) {
          number.style.color = '#28a745';
        } else if (parent.classList.contains('failed')) {
          number.style.color = '#dc3545';
        } else if (parent.classList.contains('accuracy')) {
          number.style.color = '#007bff';
        }
      }
    });
    
    // Apply styles to progress container
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.style.display = 'block';
    }
      // Ensure runTest function doesn't throw errors and handle parameter variants
    if (typeof runTest === 'function') {
      // Save the original function so different versions can co-exist
      window.originalRunTest = runTest;
      
      // Create a safe wrapper that handles errors
      window.runTest = function() {
        try {
          console.log('runTest called with args:', Array.from(arguments));
          
          // Add more robust parameter handling
          const args = Array.from(arguments);
          
          // Check if first arg is a DOM element (button-first signature)
          const isButtonFirst = args[0] && typeof args[0] === 'object' && args[0].tagName;
          
          if (isButtonFirst) {
            // Button-first signature: button, endpoint, method, dataStr, expectedStatus
            const [button, endpoint, method, dataStr, expectedStatus] = args;
            
            // Validate the button element has closest method
            if (!button || typeof button.closest !== 'function') {
              console.error('Invalid button element (no closest method):', button);
              throw new Error('Invalid button element');
            }
            
            return originalRunTest.apply(this, arguments);
          } else {
            // Method-first signature: method, endpoint, dataStr, expectedStatus, resultElementId, button
            return originalRunTest.apply(this, arguments);
          }
        } catch(e) {
          console.error('Error in runTest:', e);
          alert('An error occurred while running the test. Please check console for details.');
          return Promise.reject(e);
        }
      };
    }
    
  }, 500);
});
