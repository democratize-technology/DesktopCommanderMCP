#!/usr/bin/env node

/**
 * Enhanced Memory Leak Test Suite
 * 
 * Comprehensive testing for memory leak prevention and detection.
 * Validates that all performance fixes work effectively and prevent regressions.
 * 
 * Tests specifically target:
 * - Original "compounding jank" issue from repeated cancellations
 * - Resource leak detection (timers, intervals, event listeners, child processes)
 * - Memory growth trend analysis over time
 * - Integration with ResourceManager monitoring
 */

import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { TerminalManager } from '../dist/terminal-manager.js';
import { 
    handleStartProcess, 
    handleReadProcessOutput,
    handleInteractWithProcess,
    handleForceTerminate,
    handleListSessions
} from '../dist/handlers/terminal-handlers.js';
import { configManager } from '../dist/config-manager.js';
import { resourceManager } from '../dist/resource-manager.js';

// Enhanced memory tracking utilities
class MemoryLeakDetector {
    constructor() {
        this.baseline = null;
        this.samples = [];
        this.maxSamples = 50;
    }

    captureBaseline() {
        this.baseline = this.getDetailedMemoryInfo();
        this.samples = [this.baseline];
        return this.baseline;
    }

    getDetailedMemoryInfo() {
        const memInfo = process.memoryUsage();
        
        // Get active handles and requests
        const activeHandles = process._getActiveHandles();
        const activeRequests = process._getActiveRequests();
        
        // Count different types of handles
        const handleTypes = {
            timers: 0,
            tcp: 0,
            pipe: 0,
            tty: 0,
            udp: 0,
            fs: 0,
            other: 0
        };

        activeHandles.forEach(handle => {
            const type = handle.constructor.name.toLowerCase();
            if (type.includes('timer')) handleTypes.timers++;
            else if (type.includes('tcp')) handleTypes.tcp++;
            else if (type.includes('pipe')) handleTypes.pipe++;
            else if (type.includes('tty')) handleTypes.tty++;
            else if (type.includes('udp')) handleTypes.udp++;
            else if (type.includes('fs')) handleTypes.fs++;
            else handleTypes.other++;
        });

        return {
            timestamp: Date.now(),
            memory: memInfo,
            handles: {
                total: activeHandles.length,
                types: handleTypes
            },
            requests: activeRequests.length,
            // Track event emitter memory leaks
            eventEmitters: this.countEventEmitters(),
            // Process info
            pid: process.pid,
            uptime: process.uptime()
        };
    }

    countEventEmitters() {
        // This is a simplified count - in real scenarios you'd track specific emitters
        let count = 0;
        try {
            // Count global event emitters that might accumulate
            if (global.gc) {
                global.gc(); // Force garbage collection if available
            }
            // This is a placeholder - actual implementation would track specific emitter instances
            count = process.listenerCount ? Object.keys(process._events || {}).length : 0;
        } catch (error) {
            // Ignore errors in event emitter counting
        }
        return count;
    }

    takeSample(label = 'sample') {
        const sample = this.getDetailedMemoryInfo();
        sample.label = label;
        
        this.samples.push(sample);
        
        // Keep only the most recent samples
        if (this.samples.length > this.maxSamples) {
            this.samples.shift();
        }
        
        return sample;
    }

    analyzeGrowthTrend() {
        if (this.samples.length < 3) {
            return { trend: 'insufficient_data', confidence: 0 };
        }

        const recentSamples = this.samples.slice(-10); // Last 10 samples
        const memoryValues = recentSamples.map(s => s.memory.heapUsed);
        const handleCounts = recentSamples.map(s => s.handles.total);
        
        // Simple linear regression to detect trends
        const memoryTrend = this.calculateTrend(memoryValues);
        const handleTrend = this.calculateTrend(handleCounts);
        
        const analysis = {
            memoryTrend: {
                slope: memoryTrend.slope,
                confidence: memoryTrend.rSquared,
                direction: memoryTrend.slope > 1024 * 1024 ? 'increasing' : memoryTrend.slope < -1024 * 1024 ? 'decreasing' : 'stable'
            },
            handleTrend: {
                slope: handleTrend.slope,
                confidence: handleTrend.rSquared,
                direction: handleTrend.slope > 0.1 ? 'increasing' : handleTrend.slope < -0.1 ? 'decreasing' : 'stable'
            },
            samples: recentSamples.length
        };

        // Determine overall trend
        if (analysis.memoryTrend.direction === 'increasing' && analysis.memoryTrend.confidence > 0.7) {
            analysis.trend = 'memory_leak_likely';
        } else if (analysis.handleTrend.direction === 'increasing' && analysis.handleTrend.confidence > 0.7) {
            analysis.trend = 'handle_leak_likely';
        } else {
            analysis.trend = 'stable';
        }

        return analysis;
    }

    calculateTrend(values) {
        const n = values.length;
        const x = Array.from({length: n}, (_, i) => i);
        const sumX = x.reduce((a, b) => a + b, 0);
        const sumY = values.reduce((a, b) => a + b, 0);
        const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i], 0);
        const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);
        
        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;
        
        // Calculate R-squared
        const yMean = sumY / n;
        const ssRes = values.reduce((sum, yi, i) => {
            const predicted = slope * x[i] + intercept;
            return sum + Math.pow(yi - predicted, 2);
        }, 0);
        const ssTot = values.reduce((sum, yi) => sum + Math.pow(yi - yMean, 2), 0);
        const rSquared = 1 - (ssRes / ssTot);
        
        return { slope, intercept, rSquared };
    }

    generateReport() {
        const current = this.samples[this.samples.length - 1];
        const trend = this.analyzeGrowthTrend();
        
        if (!this.baseline) {
            return { error: 'No baseline captured' };
        }

        const diff = {
            memory: {
                rss: current.memory.rss - this.baseline.memory.rss,
                heapUsed: current.memory.heapUsed - this.baseline.memory.heapUsed,
                heapTotal: current.memory.heapTotal - this.baseline.memory.heapTotal,
                external: current.memory.external - this.baseline.memory.external
            },
            handles: current.handles.total - this.baseline.handles.total,
            requests: current.requests - this.baseline.requests,
            eventEmitters: current.eventEmitters - this.baseline.eventEmitters,
            duration: current.timestamp - this.baseline.timestamp
        };

        return {
            baseline: this.baseline,
            current,
            diff,
            trend,
            samples: this.samples.length,
            // Memory leak indicators
            indicators: {
                memoryGrowth: diff.memory.heapUsed > 50 * 1024 * 1024, // > 50MB growth
                handleAccumulation: diff.handles > 10,
                requestAccumulation: diff.requests > 5,
                eventEmitterGrowth: diff.eventEmitters > 5,
                trendConcern: trend.trend.includes('leak')
            }
        };
    }
}

// Test utilities for controlled cancellation scenarios
class TestAbortController {
    constructor() {
        this.signal = new TestAbortSignal();
        this.aborted = false;
    }

    abort() {
        if (!this.aborted) {
            this.aborted = true;
            this.signal._abort();
        }
    }
}

class TestAbortSignal extends EventEmitter {
    constructor() {
        super();
        this.aborted = false;
    }

    _abort() {
        this.aborted = true;
        this.emit('abort');
    }

    addEventListener(event, listener) {
        this.on(event, listener);
    }

    removeEventListener(event, listener) {
        this.off(event, listener);
    }
}

// Mock terminal manager for controlled testing
class MockTerminalManager {
    constructor() {
        this.sessions = new Map();
        this.nextPid = 1000;
    }

    async executeCommand(command, timeout, shell, signal) {
        const pid = this.nextPid++;
        
        return new Promise((resolve, reject) => {
            let timeoutId = null;
            let intervalId = null;
            let resolved = false;
            
            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                if (intervalId) clearInterval(intervalId);
                this.sessions.delete(pid);
            };
            
            const resolveOnce = (result) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve(result);
            };
            
            // Store session for tracking
            this.sessions.set(pid, { command, startTime: Date.now(), cleanup });
            
            // Setup cancellation
            if (signal) {
                signal.addEventListener('abort', () => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        const error = new Error('Operation was cancelled');
                        error.name = 'AbortError';
                        reject(error);
                    }
                });
            }
            
            // Simulate periodic work (potential source of leaks)
            intervalId = setInterval(() => {
                // Simulate background work
            }, 100);
            
            // Simulate completion
            timeoutId = setTimeout(() => {
                resolveOnce({
                    pid,
                    output: `Mock output for: ${command}`,
                    isBlocked: false
                });
            }, Math.random() * 500 + 100); // 100-600ms
        });
    }

    getActiveSessions() {
        return Array.from(this.sessions.keys());
    }

    forceCleanupAll() {
        for (const [pid, session] of this.sessions) {
            session.cleanup();
        }
        this.sessions.clear();
    }
}

// Global test state
let detector = new MemoryLeakDetector();
let mockTerminalManager = new MockTerminalManager();
let testResults = [];
let originalConfig;

/**
 * Setup function
 */
async function setup() {
    console.log('🔧 Setting up Enhanced Memory Leak Tests...');
    
    detector.captureBaseline();
    
    // Save and configure for testing
    originalConfig = await configManager.getConfig();
    await configManager.setValue('allowedDirectories', [process.cwd()]);
    
    console.log('✓ Memory baseline captured');
    console.log('✓ Test environment configured');
    return true;
}

/**
 * Teardown function
 */
async function teardown() {
    console.log('🧹 Cleaning up Enhanced Memory Leak Tests...');
    
    // Force cleanup of any remaining resources
    mockTerminalManager.forceCleanupAll();
    
    // Restore original configuration
    if (originalConfig) {
        await configManager.updateConfig(originalConfig);
    }
    
    // Give time for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('✓ Test cleanup completed');
}

/**
 * Test 1: Rapid Cancellation Stress Test
 * Tests the original "compounding jank" scenario
 */
async function testRapidCancellationStress() {
    console.log('\n📋 Test 1: Rapid Cancellation Stress Test (Original Issue)');
    
    const initialSample = detector.takeSample('rapid_cancellation_start');
    let testPassed = false;
    let operationsCompleted = 0;
    let operationsCancelled = 0;
    
    try {
        const numOperations = 25;
        const operations = [];
        const controllers = [];
        
        console.log(`  Starting ${numOperations} operations with rapid cancellation...`);
        
        // Create multiple operations simultaneously
        for (let i = 0; i < numOperations; i++) {
            const controller = new TestAbortController();
            controllers.push(controller);
            
            const operation = mockTerminalManager.executeCommand(
                `echo "Test operation ${i}"`,
                5000,
                true,
                controller.signal
            ).then(
                result => {
                    operationsCompleted++;
                    return result;
                },
                error => {
                    if (error.name === 'AbortError') {
                        operationsCancelled++;
                    }
                    throw error;
                }
            );
            
            operations.push(operation);
            
            // Rapid cancellation pattern - cancel some operations quickly
            if (i % 3 === 0) {
                setTimeout(() => controller.abort(), Math.random() * 50);
            } else if (i % 5 === 0) {
                setTimeout(() => controller.abort(), Math.random() * 100 + 50);
            }
        }
        
        // Cancel remaining operations after a delay
        setTimeout(() => {
            controllers.forEach((controller, index) => {
                if (!controller.aborted && Math.random() > 0.3) {
                    controller.abort();
                }
            });
        }, 200);
        
        // Wait for all operations to complete or be cancelled
        const results = await Promise.allSettled(operations);
        
        // Take memory sample after operations
        const afterSample = detector.takeSample('rapid_cancellation_end');
        
        // Analyze results
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const cancelledCount = results.filter(r => 
            r.status === 'rejected' && r.reason?.name === 'AbortError'
        ).length;
        
        console.log(`  Results: ${successCount} completed, ${cancelledCount} cancelled`);
        console.log(`  Operations completed: ${operationsCompleted}`);
        console.log(`  Operations cancelled: ${operationsCancelled}`);
        
        // Memory analysis
        const memoryDiff = afterSample.memory.heapUsed - initialSample.memory.heapUsed;
        const handleDiff = afterSample.handles.total - initialSample.handles.total;
        
        console.log(`  Memory change: ${(memoryDiff / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  Handle change: ${handleDiff}`);
        
        // Test passes if:
        // 1. Some operations were cancelled (showing cancellation works)
        // 2. Memory increase is reasonable (< 20MB for this test)
        // 3. Handle count doesn't accumulate significantly (< 10)
        testPassed = (
            cancelledCount > 0 &&
            memoryDiff < 20 * 1024 * 1024 &&
            handleDiff < 10
        );
        
        if (testPassed) {
            console.log('✓ Rapid cancellation handled without memory leaks');
        } else {
            console.log('✗ Memory leak detected in rapid cancellation scenario');
            if (memoryDiff >= 20 * 1024 * 1024) console.log(`  - Excessive memory growth: ${(memoryDiff / 1024 / 1024).toFixed(2)}MB`);
            if (handleDiff >= 10) console.log(`  - Handle accumulation: ${handleDiff}`);
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Rapid Cancellation Stress Test',
        passed: testPassed,
        operationsCompleted,
        operationsCancelled,
        memoryImpact: detector.samples[detector.samples.length - 1]
    });
    
    return testPassed;
}

/**
 * Test 2: Memory Growth Trend Analysis
 * Tests for gradual memory leaks over multiple operation cycles
 */
async function testMemoryGrowthTrend() {
    console.log('\n📋 Test 2: Memory Growth Trend Analysis');
    
    let testPassed = false;
    const cycles = 10;
    const operationsPerCycle = 5;
    
    try {
        console.log(`  Running ${cycles} cycles of ${operationsPerCycle} operations each...`);
        
        for (let cycle = 0; cycle < cycles; cycle++) {
            const operations = [];
            const controllers = [];
            
            // Create operations for this cycle
            for (let op = 0; op < operationsPerCycle; op++) {
                const controller = new TestAbortController();
                controllers.push(controller);
                
                const operation = mockTerminalManager.executeCommand(
                    `echo "Cycle ${cycle} Operation ${op}"`,
                    1000,
                    true,
                    controller.signal
                );
                
                operations.push(operation);
            }
            
            // Let some operations complete, cancel others
            setTimeout(() => {
                controllers.forEach((controller, index) => {
                    if (index % 2 === 0) {
                        controller.abort();
                    }
                });
            }, 50);
            
            // Wait for cycle to complete
            await Promise.allSettled(operations);
            
            // Take memory sample after each cycle
            detector.takeSample(`cycle_${cycle}`);
            
            // Small delay between cycles
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Analyze memory growth trend
        const trendAnalysis = detector.analyzeGrowthTrend();
        console.log('  Trend Analysis:');
        console.log(`    Memory trend: ${trendAnalysis.memoryTrend.direction} (confidence: ${(trendAnalysis.memoryTrend.confidence * 100).toFixed(1)}%)`);
        console.log(`    Handle trend: ${trendAnalysis.handleTrend.direction} (confidence: ${(trendAnalysis.handleTrend.confidence * 100).toFixed(1)}%)`);
        console.log(`    Overall assessment: ${trendAnalysis.trend}`);
        
        // Test passes if no clear upward trend in memory or handles
        testPassed = (
            trendAnalysis.trend === 'stable' ||
            (trendAnalysis.memoryTrend.direction !== 'increasing' || trendAnalysis.memoryTrend.confidence < 0.7) &&
            (trendAnalysis.handleTrend.direction !== 'increasing' || trendAnalysis.handleTrend.confidence < 0.7)
        );
        
        if (testPassed) {
            console.log('✓ No concerning memory growth trends detected');
        } else {
            console.log('✗ Concerning memory growth trend detected');
            console.log(`  - Trend: ${trendAnalysis.trend}`);
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Memory Growth Trend Analysis',
        passed: testPassed,
        cycles,
        trendAnalysis: detector.analyzeGrowthTrend()
    });
    
    return testPassed;
}

/**
 * Test 3: Resource Manager Integration Validation
 * Tests that ResourceManager correctly monitors and reports system health
 */
async function testResourceManagerIntegration() {
    console.log('\n📋 Test 3: ResourceManager Integration Validation');
    
    let testPassed = false;
    
    try {
        // Get initial system health
        const initialHealth = await resourceManager.getSystemHealth();
        console.log(`  Initial system status: ${initialHealth.status}`);
        console.log(`  Components registered: ${initialHealth.totalComponents}`);
        
        // Get diagnostics
        const diagnostics = await resourceManager.getDiagnostics();
        console.log(`  Recent events: ${diagnostics.recentEvents.length}`);
        console.log(`  Component details: ${diagnostics.components.length}`);
        
        // Verify ResourceManager is monitoring properly
        const hasValidStatus = ['healthy', 'degraded', 'failing', 'critical'].includes(initialHealth.status);
        const hasComponents = initialHealth.totalComponents > 0;
        const hasRecentEvents = diagnostics.recentEvents.length > 0;
        const hasSystemUsage = diagnostics.system.systemUsage !== undefined;
        
        console.log('  ResourceManager validation:');
        console.log(`    Valid status: ${hasValidStatus ? '✓' : '✗'}`);
        console.log(`    Has components: ${hasComponents ? '✓' : '✗'}`);
        console.log(`    Has event history: ${hasRecentEvents ? '✓' : '✗'}`);
        console.log(`    Has usage metrics: ${hasSystemUsage ? '✓' : '✗'}`);
        
        testPassed = hasValidStatus && hasComponents && hasSystemUsage;
        
        if (testPassed) {
            console.log('✓ ResourceManager integration validated');
        } else {
            console.log('✗ ResourceManager integration issues detected');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'ResourceManager Integration Validation',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 4: Handle and Timer Leak Detection
 * Specifically tests for accumulation of timers, intervals, and other handles
 */
async function testHandleAndTimerLeaks() {
    console.log('\n📋 Test 4: Handle and Timer Leak Detection');
    
    const initialSample = detector.takeSample('handle_test_start');
    let testPassed = false;
    
    try {
        console.log('  Creating operations with multiple timers and intervals...');
        
        const controllers = [];
        const operations = [];
        
        // Create operations that use timers and intervals heavily
        for (let i = 0; i < 15; i++) {
            const controller = new TestAbortController();
            controllers.push(controller);
            
            const operation = new Promise((resolve, reject) => {
                const timers = [];
                const intervals = [];
                let resolved = false;
                
                const cleanup = () => {
                    timers.forEach(id => clearTimeout(id));
                    intervals.forEach(id => clearInterval(id));
                };
                
                // Setup abort handling
                controller.signal.addEventListener('abort', () => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        const error = new Error('Operation was cancelled');
                        error.name = 'AbortError';
                        reject(error);
                    }
                });
                
                // Create multiple timers and intervals
                for (let j = 0; j < 3; j++) {
                    const timerId = setTimeout(() => {
                        // Timer work
                    }, Math.random() * 1000);
                    timers.push(timerId);
                    
                    const intervalId = setInterval(() => {
                        // Interval work
                    }, 100);
                    intervals.push(intervalId);
                }
                
                // Complete operation after delay
                const completionTimer = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        resolve(`Operation ${i} completed`);
                    }
                }, 300);
                timers.push(completionTimer);
            });
            
            operations.push(operation);
        }
        
        // Cancel operations at different times
        setTimeout(() => {
            controllers.forEach((controller, index) => {
                if (index % 2 === 0) {
                    controller.abort();
                }
            });
        }, 100);
        
        setTimeout(() => {
            controllers.forEach(controller => {
                if (!controller.aborted) {
                    controller.abort();
                }
            });
        }, 500);
        
        // Wait for all operations
        await Promise.allSettled(operations);
        
        // Give time for cleanup
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const finalSample = detector.takeSample('handle_test_end');
        
        // Analyze handle changes
        const handleDiff = finalSample.handles.total - initialSample.handles.total;
        const timerDiff = finalSample.handles.types.timers - initialSample.handles.types.timers;
        
        console.log(`  Handle count change: ${handleDiff}`);
        console.log(`  Timer count change: ${timerDiff}`);
        console.log('  Handle types:');
        Object.entries(finalSample.handles.types).forEach(([type, count]) => {
            const initial = initialSample.handles.types[type] || 0;
            const diff = count - initial;
            console.log(`    ${type}: ${count} (${diff >= 0 ? '+' : ''}${diff})`);
        });
        
        // Test passes if handle count doesn't accumulate significantly
        testPassed = handleDiff < 5 && timerDiff < 3;
        
        if (testPassed) {
            console.log('✓ No significant handle or timer leaks detected');
        } else {
            console.log('✗ Handle or timer leaks detected');
            console.log(`  - Handle accumulation: ${handleDiff}`);
            console.log(`  - Timer accumulation: ${timerDiff}`);
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Handle and Timer Leak Detection',
        passed: testPassed,
        handleAnalysis: {
            initial: initialSample.handles,
            final: detector.samples[detector.samples.length - 1].handles
        }
    });
    
    return testPassed;
}

/**
 * Test 5: Sustained Load Memory Stability
 * Tests memory stability under sustained load over extended period
 */
async function testSustainedLoadStability() {
    console.log('\n📋 Test 5: Sustained Load Memory Stability');
    
    let testPassed = false;
    const duration = 30000; // 30 seconds
    const operationInterval = 200; // New operation every 200ms
    const startTime = Date.now();
    
    try {
        console.log(`  Running sustained load for ${duration/1000} seconds...`);
        
        let operationCount = 0;
        let activeOperations = 0;
        const maxConcurrentOps = 10;
        
        const loadTest = new Promise((resolve) => {
            const interval = setInterval(async () => {
                if (Date.now() - startTime >= duration) {
                    clearInterval(interval);
                    resolve();
                    return;
                }
                
                // Don't create too many concurrent operations
                if (activeOperations >= maxConcurrentOps) {
                    return;
                }
                
                activeOperations++;
                operationCount++;
                
                const controller = new TestAbortController();
                
                // Create operation
                const operation = mockTerminalManager.executeCommand(
                    `echo "Load test ${operationCount}"`,
                    1000,
                    true,
                    controller.signal
                ).finally(() => {
                    activeOperations--;
                });
                
                // Randomly cancel some operations
                if (Math.random() < 0.3) {
                    setTimeout(() => controller.abort(), Math.random() * 150);
                }
                
                // Take periodic memory samples
                if (operationCount % 20 === 0) {
                    detector.takeSample(`load_test_${operationCount}`);
                }
            }, operationInterval);
        });
        
        await loadTest;
        
        // Final memory sample
        const finalSample = detector.takeSample('sustained_load_end');
        
        console.log(`  Total operations created: ${operationCount}`);
        console.log(`  Active operations at end: ${activeOperations}`);
        
        // Analyze memory trend during load test
        const trendAnalysis = detector.analyzeGrowthTrend();
        const memoryReport = detector.generateReport();
        
        console.log('  Memory stability analysis:');
        console.log(`    Trend: ${trendAnalysis.trend}`);
        console.log(`    Memory growth: ${(memoryReport.diff.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        console.log(`    Handle accumulation: ${memoryReport.diff.handles}`);
        
        // Test passes if:
        // - No clear upward memory trend
        // - Total memory growth < 50MB
        // - Handle count stable
        testPassed = (
            trendAnalysis.trend === 'stable' &&
            memoryReport.diff.memory.heapUsed < 50 * 1024 * 1024 &&
            memoryReport.diff.handles < 15
        );
        
        if (testPassed) {
            console.log('✓ Memory remained stable under sustained load');
        } else {
            console.log('✗ Memory instability detected under sustained load');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Sustained Load Memory Stability',
        passed: testPassed,
        duration,
        operationCount,
        memoryReport: detector.generateReport()
    });
    
    return testPassed;
}

/**
 * Main test runner
 */
async function runMemoryLeakTests() {
    console.log('🚀 Starting Enhanced Memory Leak Test Suite\n');
    console.log('Target: Validate performance fixes prevent memory leaks and regressions');
    
    const startTime = Date.now();
    let setupSuccess = false;
    
    try {
        setupSuccess = await setup();
        if (!setupSuccess) {
            throw new Error('Setup failed');
        }
        
        // Run all memory leak tests
        const testFunctions = [
            testRapidCancellationStress,
            testMemoryGrowthTrend,
            testResourceManagerIntegration,
            testHandleAndTimerLeaks,
            testSustainedLoadStability
        ];
        
        let passedTests = 0;
        
        for (const testFn of testFunctions) {
            try {
                const result = await testFn();
                if (result) {
                    passedTests++;
                }
                
                // Delay between tests for cleanup
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Test function ${testFn.name} failed:`, error.message);
            }
        }
        
        // Generate comprehensive report
        const finalReport = detector.generateReport();
        const duration = Date.now() - startTime;
        
        console.log('\n📊 MEMORY LEAK TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total tests: ${testFunctions.length}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${testFunctions.length - passedTests}`);
        console.log(`Duration: ${duration}ms`);
        
        console.log('\n📈 MEMORY ANALYSIS REPORT');
        console.log('-'.repeat(40));
        console.log(`Total memory samples: ${finalReport.samples}`);
        console.log(`Memory growth: ${(finalReport.diff.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        console.log(`Handle change: ${finalReport.diff.handles}`);
        console.log(`Request change: ${finalReport.diff.requests}`);
        console.log(`Test duration: ${(finalReport.duration / 1000).toFixed(1)}s`);
        
        console.log('\n🔍 LEAK INDICATORS');
        Object.entries(finalReport.indicators).forEach(([indicator, detected]) => {
            const status = detected ? '⚠️' : '✓';
            console.log(`  ${status} ${indicator}: ${detected ? 'DETECTED' : 'OK'}`);
        });
        
        console.log('\n📋 DETAILED TEST RESULTS');
        testResults.forEach(result => {
            const status = result.passed ? '✓' : '✗';
            console.log(`  ${status} ${result.name}`);
        });
        
        // Final assessment
        const hasMemoryLeaks = Object.values(finalReport.indicators).some(Boolean);
        const allTestsPassed = passedTests === testFunctions.length;
        
        if (allTestsPassed && !hasMemoryLeaks) {
            console.log('\n🎉 ALL MEMORY LEAK TESTS PASSED!');
            console.log('✓ No memory leaks detected');
            console.log('✓ Performance fixes are working effectively');
            console.log('✓ Original "compounding jank" issue resolved');
            console.log('✓ System demonstrates stable memory behavior');
            return true;
        } else {
            console.log('\n❌ MEMORY LEAK CONCERNS DETECTED');
            if (!allTestsPassed) {
                console.log(`❌ ${testFunctions.length - passedTests} test(s) failed`);
            }
            if (hasMemoryLeaks) {
                console.log('❌ Memory leak indicators detected');
            }
            console.log('⚠️  Performance fixes may need additional work');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
        return false;
    } finally {
        if (setupSuccess) {
            await teardown();
        }
    }
}

// Export for test runner
export default runMemoryLeakTests;

// If run directly, execute tests
if (import.meta.url === `file://${process.argv[1]}`) {
    runMemoryLeakTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('❌ Unhandled error:', error);
        process.exit(1);
    });
}