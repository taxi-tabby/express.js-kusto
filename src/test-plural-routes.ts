// Test script for demonstrating the isPlural function and pagination checks
import { TestGenerator } from './core/lib/testGenerator';

/**
 * Simple test routes to demonstrate plural detection and pagination suggestions
 */
function testPluralDetection(): void {
    console.log('Testing plural detection functionality:');
    
    // Test data
    const words = [
        'user', 'users', 
        'product', 'products',
        'category', 'categories',
        'box', 'boxes',
        'lady', 'ladies',
        'wolf', 'wolves',
        'company', 'companies',
        'sheep', // special invariant
        'child', 'children', // irregular
        'data', // irregular plural
        'means', // special invariant ending with s
        'glass', // singular ending with s
        'business' // singular ending with s
    ];
    
    // Access the private isPlural method using reflection (for testing only)
    const TestGeneratorAny = TestGenerator as any;
    const isPlural = TestGeneratorAny.isPlural.bind(TestGenerator);
    
    // Test each word
    for (const word of words) {
        console.log(`"${word}" is${isPlural(word) ? '' : ' not'} plural`);
    }
    
    console.log('\n');
}

/**
 * Mock a route for testing pagination checks
 */
function testPaginationCheck(): void {
    console.log('Testing pagination checks for plural routes:');
    
    // Mock route configurations
    const routes = [
        {
            path: '/api/users',
            method: 'GET',
            parameters: {
                query: {}
            }
        },
        {
            path: '/api/users',
            method: 'GET',
            parameters: {
                query: {
                    page: { type: 'number' },
                    limit: { type: 'number' }
                }
            }
        },
        {
            path: '/api/user',
            method: 'GET',
            parameters: {
                query: {}
            }
        },
        {
            path: '/api/products/:id',
            method: 'GET',
            parameters: {
                params: {
                    id: { type: 'number' }
                }
            }
        }
    ];
    
    // Test each route against our validator
    const TestGeneratorAny = TestGenerator as any;
    const validatePerformance = TestGeneratorAny.validatePerformancePhilosophy.bind(TestGenerator);
    
    for (const route of routes) {
        console.log(`\nCheck: ${route.method} ${route.path}`);
        const violations = validatePerformance(route);
        
        if (violations.length === 0) {
            console.log('✅ No violations found');
        } else {
            for (const violation of violations) {
                console.log(`❌ ${violation.message}`);
                console.log(`💡 ${violation.suggestion}`);
            }
        }
    }
}

// Run tests
testPluralDetection();
testPaginationCheck();
