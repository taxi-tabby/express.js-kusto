// Debug script to ensure Test Execution Summary is visible
document.addEventListener('DOMContentLoaded', function() {
    // Make sure the progress container is visible
    setTimeout(function() {
        const progressContainer = document.getElementById('progress-container');
        if (progressContainer) {
            console.log('Force showing progress container');
            progressContainer.style.display = 'block';
            
            // Ensure stats are visible
            const statsContainer = progressContainer.querySelector('.stats-container');
            if (statsContainer) {
                statsContainer.style.display = 'grid';
                statsContainer.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
                statsContainer.style.gap = '15px';
                statsContainer.style.marginTop = '20px';
            }
            
            // Ensure stat items are styled properly
            const statItems = progressContainer.querySelectorAll('.stat-item');
            statItems.forEach(item => {
                item.style.background = '#f8f9fa';
                item.style.borderRadius = '8px';
                item.style.padding = '12px';
                item.style.textAlign = 'center';
                item.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            });
            
            // Ensure stat values are visible
            const statValues = progressContainer.querySelectorAll('.stat-value');
            statValues.forEach(value => {
                value.style.fontSize = '24px';
                value.style.fontWeight = 'bold';
                
                if (value.classList.contains('stat-passed')) {
                    value.style.color = '#28a745';
                } else if (value.classList.contains('stat-failed')) {
                    value.style.color = '#dc3545';
                }
            });
        } else {
            console.error('Progress container not found');
        }
        
        // Log all elements with IDs for debugging
        const elementsWithIds = document.querySelectorAll('[id]');
        console.log('Elements with IDs:', Array.from(elementsWithIds).map(el => el.id));
    }, 500);
});
