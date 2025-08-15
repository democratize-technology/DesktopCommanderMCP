#!/usr/bin/env node

/**
 * Regression Prevention Suite
 * 
 * Critical tests that specifically validate the original "compounding jank" issue
 * and other reported performance problems are permanently resolved.
 * 
 * This suite recreates the exact scenarios that caused performance degradation
 * to ensure they no longer occur after the implemented fixes.
 * 
 * Key regression test scenarios:
 * - Original "compounding jank" from repeated terminal cancellations
 * - Memory accumulation over multiple session cycles
 * - Performance degradation during extended use
 * - Resource cleanup failures under various conditions
 * - Edge cases that previously caused system instability
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

// Regression detection utilities
class RegressionDetector {
    constructor() {
        this.baselineMetrics = null;
        this.performanceHistory = [];
        this.memoryHistory = [];
        this.maxHistorySize = 100;
    }

    captureBaseline(label = 'baseline') {
        const metrics = this.getSystemMetrics();
        this.baselineMetrics = { ...metrics, label, timestamp: Date.now() };
        this.performanceHistory = [this.baselineMetrics];
        this.memoryHistory = [this.baselineMetrics];
        return this.baselineMetrics;
    }

    getSystemMetrics() {
        const memInfo = process.memoryUsage();
        const handles = process._getActiveHandles();
        const requests = process._getActiveRequests();
        
        return {
            memory: {
                rss: memInfo.rss,
                heapUsed: memInfo.heapUsed,
                heapTotal: memInfo.heapTotal,
                external: memInfo.external
            },
            handles: {
                total: handles.length,
                types: this.categorizeHandles(handles)
            },
            requests: requests.length,
            timestamp: Date.now(),
            pid: process.pid,
            uptime: process.uptime()
        };
    }

    categorizeHandles(handles) {
        const categories = {
            timers: 0,
            tcp: 0,
            pipe: 0,
            process: 0,
            fs: 0,
            other: 0
        };

        handles.forEach(handle => {
            const type = handle.constructor.name.toLowerCase();
            if (type.includes('timer') || type.includes('timeout')) {
                categories.timers++;
            } else if (type.includes('tcp')) {
                categories.tcp++;
            } else if (type.includes('pipe')) {
                categories.pipe++;
            } else if (type.includes('process') || type.includes('child')) {
                categories.process++;
            } else if (type.includes('fs') || type.includes('file')) {
                categories.fs++;
            } else {
                categories.other++;
            }
        });

        return categories;
    }

    recordMetrics(label = 'sample') {
        const metrics = this.getSystemMetrics();
        metrics.label = label;
        
        this.performanceHistory.push(metrics);
        this.memoryHistory.push(metrics);
        
        // Keep history within limits
        if (this.performanceHistory.length > this.maxHistorySize) {
            this.performanceHistory.shift();
        }
        if (this.memoryHistory.length > this.maxHistorySize) {
            this.memoryHistory.shift();
        }
        
        return metrics;
    }

    detectCompoundingJank() {
        if (this.performanceHistory.length < 10) {
            return { detected: false, reason: 'insufficient_data' };
        }

        const recent = this.performanceHistory.slice(-10);
        const baseline = this.baselineMetrics;
        
        // Check for memory growth pattern
        const memoryGrowth = recent.map(m => m.memory.heapUsed - baseline.memory.heapUsed);
        const avgGrowth = memoryGrowth.reduce((a, b) => a + b, 0) / memoryGrowth.length;
        const maxGrowth = Math.max(...memoryGrowth);
        
        // Check for handle accumulation
        const handleGrowth = recent.map(m => m.handles.total - baseline.handles.total);
        const avgHandleGrowth = handleGrowth.reduce((a, b) => a + b, 0) / handleGrowth.length;
        const maxHandleGrowth = Math.max(...handleGrowth);
        
        // Check for compounding pattern (increasing over time)
        const isCompounding = this.detectCompoundingPattern(memoryGrowth) || 
                            this.detectCompoundingPattern(handleGrowth);
        
        const analysis = {
            detected: false,
            memory: {
                avgGrowth: avgGrowth,
                maxGrowth: maxGrowth,
                concerning: avgGrowth > 50 * 1024 * 1024, // > 50MB average
                critical: maxGrowth > 100 * 1024 * 1024   // > 100MB max
            },
            handles: {
                avgGrowth: avgHandleGrowth,
                maxGrowth: maxHandleGrowth,
                concerning: avgHandleGrowth > 10,
                critical: maxHandleGrowth > 25
            },
            compounding: isCompounding,
            samples: recent.length
        };
        
        // Detect compounding jank
        analysis.detected = (
            analysis.memory.concerning ||
            analysis.handles.concerning ||
            analysis.compounding ||
            analysis.memory.critical ||
            analysis.handles.critical
        );
        
        if (analysis.detected) {
            const reasons = [];
            if (analysis.memory.critical) reasons.push('critical_memory_growth');
            if (analysis.handles.critical) reasons.push('critical_handle_growth');
            if (analysis.memory.concerning) reasons.push('concerning_memory_growth');
            if (analysis.handles.concerning) reasons.push('concerning_handle_growth');
            if (analysis.compounding) reasons.push('compounding_pattern_detected');
            
            analysis.reason = reasons.join(', ');
        }
        
        return analysis;
    }

    detectCompoundingPattern(values) {
        if (values.length < 5) return false;
        
        // Check if values are generally increasing
        let increasingCount = 0;
        for (let i = 1; i < values.length; i++) {
            if (values[i] > values[i-1]) {
                increasingCount++;
            }
        }
        
        // If more than 70% are increasing, it's likely compounding
        return (increasingCount / (values.length - 1)) > 0.7;
    }

    getPerformanceTrend() {
        if (this.performanceHistory.length < 3) {
            return { trend: 'insufficient_data' };
        }

        const baseline = this.baselineMetrics;
        const recent = this.performanceHistory.slice(-5);
        
        const memoryDeltas = recent.map(m => m.memory.heapUsed - baseline.memory.heapUsed);
        const handleDeltas = recent.map(m => m.handles.total - baseline.handles.total);
        
        return {
            trend: this.detectCompoundingJank().detected ? 'degrading' : 'stable',
            memory: {
                min: Math.min(...memoryDeltas),
                max: Math.max(...memoryDeltas),
                avg: memoryDeltas.reduce((a, b) => a + b, 0) / memoryDeltas.length
            },
            handles: {
                min: Math.min(...handleDeltas),
                max: Math.max(...handleDeltas),
                avg: handleDeltas.reduce((a, b) => a + b, 0) / handleDeltas.length
            },
            samples: recent.length
        };
    }

    generateRegressionReport() {
        const jankAnalysis = this.detectCompoundingJank();
        const trend = this.getPerformanceTrend();
        const current = this.performanceHistory[this.performanceHistory.length - 1];
        const baseline = this.baselineMetrics;
        
        return {
            regressionDetected: jankAnalysis.detected,
            compoundingJank: jankAnalysis,
            performanceTrend: trend,
            summary: {
                totalSamples: this.performanceHistory.length,
                testDuration: current.timestamp - baseline.timestamp,
                memoryGrowth: current.memory.heapUsed - baseline.memory.heapUsed,
                handleGrowth: current.handles.total - baseline.handles.total,
                requestGrowth: current.requests - baseline.requests
            },
            recommendation: jankAnalysis.detected ? 
                'REGRESSION DETECTED: Performance fixes may be incomplete' :
                'No regression detected: Performance fixes are effective'
        };
    }
}

// Test utilities for simulating original problem conditions
class OriginalIssueSimulator {
    constructor() {
        this.terminalManager = new TerminalManager();
        this.activeOperations = new Map();
        this.operationCounter = 0;
    }

    async simulateOriginalCompoundingJank(iterations = 20) {
        // This simulates the exact scenario that caused the original issue:
        // Rapid creation and cancellation of terminal operations
        
        const operations = [];
        const controllers = [];
        
        for (let i = 0; i < iterations; i++) {
            const controller = new AbortController();
            controllers.push(controller);
            
            // Create terminal operation
            const operation = this.createTerminalOperation(
                `echo "Jank test iteration ${i}"`,
                controller.signal
            );
            
            operations.push(operation);
            
            // Cancel quickly to simulate user interruption pattern
            setTimeout(() => {
                if (!controller.signal.aborted) {
                    controller.abort();
                }
            }, Math.random() * 100 + 50); // 50-150ms
            
            // Small delay between operations to simulate rapid user actions
            await new Promise(resolve => setTimeout(resolve, 30));
        }
        
        // Wait for all operations to complete or be cancelled
        const results = await Promise.allSettled(operations);
        
        return {
            total: operations.length,
            completed: results.filter(r => r.status === 'fulfilled').length,
            cancelled: results.filter(r => 
                r.status === 'rejected' && r.reason?.name === 'AbortError'
            ).length,
            errors: results.filter(r => 
                r.status === 'rejected' && r.reason?.name !== 'AbortError'
            ).length
        };
    }

    async createTerminalOperation(command, signal) {
        this.operationCounter++;
        const operationId = this.operationCounter;
        
        try {
            const result = await this.terminalManager.executeCommand(
                command,
                5000, // 5 second timeout
                true,  // use shell
                signal
            );
            
            return result;
        } catch (error) {
            throw error;
        }
    }

    async simulateExtendedUsagePattern(duration = 10000) {
        // Simulates extended usage pattern that could expose memory leaks
        const startTime = Date.now();
        const operations = [];
        let operationCount = 0;
        
        while (Date.now() - startTime < duration) {
            operationCount++;
            
            const controller = new AbortController();
            
            // Create operation
            const operation = this.createTerminalOperation(
                `echo "Extended usage ${operationCount}"`,
                controller.signal
            ).catch(error => {
                // Handle cancellation gracefully
                return { cancelled: true, error: error.message };
            });
            
            operations.push(operation);
            
            // Randomly cancel some operations to simulate real usage
            if (Math.random() < 0.4) { // 40% cancellation rate
                setTimeout(() => controller.abort(), Math.random() * 200);
            }
            
            // Vary the interval between operations
            const interval = Math.random() * 300 + 100; // 100-400ms
            await new Promise(resolve => setTimeout(resolve, interval));
        }
        
        // Wait for remaining operations
        const results = await Promise.allSettled(operations);
        
        return {
            totalOperations: operationCount,
            duration: Date.now() - startTime,
            results: results.length
        };
    }

    async simulateHighConcurrencyBurst(concurrencyLevel = 30) {
        // Simulates high concurrency scenarios that could expose resource issues
        const operations = [];
        const controllers = [];
        
        for (let i = 0; i < concurrencyLevel; i++) {
            const controller = new AbortController();
            controllers.push(controller);
            
            const operation = this.createTerminalOperation(
                `echo "Concurrency test ${i}"`,
                controller.signal
            );
            
            operations.push(operation);
        }
        
        // Let operations run for a bit
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Cancel all operations simultaneously
        controllers.forEach(controller => controller.abort());
        
        const results = await Promise.allSettled(operations);
        
        return {
            concurrencyLevel,
            results: results.length,
            cancelled: results.filter(r => 
                r.status === 'rejected' && r.reason?.name === 'AbortError'
            ).length
        };
    }
}

// Global test state
let regressionDetector = new RegressionDetector();
let issueSimulator = new OriginalIssueSimulator();
let testResults = [];
let originalConfig;

/**
 * Setup function
 */
async function setup() {
    console.log('🔧 Setting up Regression Prevention Tests...');
    
    // Capture baseline metrics
    regressionDetector.captureBaseline();
    
    // Save and configure for testing
    originalConfig = await configManager.getConfig();
    await configManager.setValue('allowedDirectories', [process.cwd()]);
    
    console.log('✓ Baseline metrics captured');
    console.log('✓ Test environment configured');
    return true;
}

/**
 * Teardown function
 */
async function teardown() {
    console.log('🧹 Cleaning up Regression Prevention Tests...');
    
    // Restore configuration
    if (originalConfig) {
        await configManager.updateConfig(originalConfig);
    }
    
    // Allow cleanup time
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✓ Configuration restored');
    console.log('✓ Cleanup completed');
}

/**
 * Test 1: Original Compounding Jank Scenario
 * Recreates the exact scenario that caused the original issue
 */
async function testOriginalCompoundingJankScenario() {
    console.log('\n📋 Test 1: Original Compounding Jank Scenario');
    console.log('  Recreating the exact conditions that caused the original issue...');
    
    let testPassed = false;
    
    try {
        const iterations = 25;
        console.log(`  Running ${iterations} rapid terminal cancellation cycles...`);
        
        // Record baseline before test
        regressionDetector.recordMetrics('before_jank_test');
        
        // Simulate the original compounding jank scenario
        const result = await issueSimulator.simulateOriginalCompoundingJank(iterations);
        
        console.log(`  Results: ${result.completed} completed, ${result.cancelled} cancelled, ${result.errors} errors`);
        
        // Record metrics after test
        regressionDetector.recordMetrics('after_jank_test');
        
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Final metrics
        regressionDetector.recordMetrics('final_jank_test');
        
        // Analyze for compounding jank
        const jankAnalysis = regressionDetector.detectCompoundingJank();
        
        console.log('  Regression Analysis:');
        console.log(`    Compounding jank detected: ${jankAnalysis.detected ? 'YES' : 'NO'}`);
        
        if (jankAnalysis.detected) {
            console.log(`    Reason: ${jankAnalysis.reason}`);
            console.log(`    Memory growth: ${(jankAnalysis.memory.avgGrowth / 1024 / 1024).toFixed(2)}MB avg`);
            console.log(`    Handle growth: ${jankAnalysis.handles.avgGrowth} avg`);
        } else {
            console.log('    No regression patterns detected');
        }
        
        // Test passes if no compounding jank is detected
        testPassed = !jankAnalysis.detected;
        
        if (testPassed) {
            console.log('✓ Original compounding jank issue RESOLVED');
            console.log('✓ Performance fixes are effective');
        } else {
            console.log('✗ REGRESSION DETECTED: Original issue has returned');
            console.log('⚠️  Performance fixes may be incomplete or broken');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Original Compounding Jank Scenario',
        passed: testPassed,
        regressionAnalysis: regressionDetector.detectCompoundingJank()
    });
    
    return testPassed;
}

/**
 * Test 2: Extended Usage Memory Stability
 * Tests for memory leaks during extended usage patterns
 */
async function testExtendedUsageMemoryStability() {
    console.log('\n📋 Test 2: Extended Usage Memory Stability');
    
    let testPassed = false;
    
    try {
        const testDuration = 15000; // 15 seconds of extended usage
        console.log(`  Running extended usage simulation for ${testDuration/1000} seconds...`);
        
        regressionDetector.recordMetrics('before_extended_usage');
        
        // Simulate extended usage pattern
        const usageResult = await issueSimulator.simulateExtendedUsagePattern(testDuration);
        
        console.log(`  Extended usage results:`);
        console.log(`    Total operations: ${usageResult.totalOperations}`);
        console.log(`    Actual duration: ${(usageResult.duration/1000).toFixed(1)}s`);
        
        // Record metrics during and after extended usage
        regressionDetector.recordMetrics('after_extended_usage');
        
        // Allow cleanup time
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        regressionDetector.recordMetrics('final_extended_usage');
        
        // Analyze memory stability
        const performanceTrend = regressionDetector.getPerformanceTrend();
        const jankAnalysis = regressionDetector.detectCompoundingJank();
        
        console.log('  Memory Stability Analysis:');
        console.log(`    Performance trend: ${performanceTrend.trend}`);
        console.log(`    Memory growth: ${(performanceTrend.memory.avg / 1024 / 1024).toFixed(2)}MB avg`);
        console.log(`    Handle growth: ${performanceTrend.handles.avg} avg`);
        console.log(`    Regression detected: ${jankAnalysis.detected ? 'YES' : 'NO'}`);
        
        // Test passes if memory remains stable during extended usage
        testPassed = (
            performanceTrend.trend === 'stable' &&
            !jankAnalysis.detected &&
            performanceTrend.memory.avg < 50 * 1024 * 1024 && // < 50MB average growth
            performanceTrend.handles.avg < 15 // < 15 handles average growth
        );
        
        if (testPassed) {
            console.log('✓ Memory remains stable during extended usage');
        } else {
            console.log('✗ Memory instability detected during extended usage');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Extended Usage Memory Stability',
        passed: testPassed,
        performanceTrend: regressionDetector.getPerformanceTrend()
    });
    
    return testPassed;
}

/**
 * Test 3: High Concurrency Resource Management
 * Tests resource management under high concurrency
 */
async function testHighConcurrencyResourceManagement() {
    console.log('\n📋 Test 3: High Concurrency Resource Management');
    
    let testPassed = false;
    
    try {
        const concurrencyLevel = 40;
        console.log(`  Testing resource management with ${concurrencyLevel} concurrent operations...`);
        
        regressionDetector.recordMetrics('before_concurrency_test');
        
        // Run high concurrency burst
        const concurrencyResult = await issueSimulator.simulateHighConcurrencyBurst(concurrencyLevel);
        
        console.log(`  Concurrency results:`);
        console.log(`    Operations created: ${concurrencyResult.concurrencyLevel}`);
        console.log(`    Operations cancelled: ${concurrencyResult.cancelled}`);
        
        regressionDetector.recordMetrics('after_concurrency_test');
        
        // Allow resource cleanup
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        regressionDetector.recordMetrics('final_concurrency_test');
        
        // Check resource cleanup effectiveness
        const jankAnalysis = regressionDetector.detectCompoundingJank();
        const metrics = regressionDetector.performanceHistory;
        const beforeTest = metrics.find(m => m.label === 'before_concurrency_test');
        const afterCleanup = metrics.find(m => m.label === 'final_concurrency_test');
        
        const memoryRecovered = beforeTest.memory.heapUsed <= afterCleanup.memory.heapUsed * 1.2; // Within 20%
        const handlesCleanedUp = afterCleanup.handles.total <= beforeTest.handles.total + 5; // Within 5 handles
        
        console.log('  Resource Management Analysis:');
        console.log(`    Memory recovery: ${memoryRecovered ? 'GOOD' : 'POOR'}`);
        console.log(`    Handle cleanup: ${handlesCleanedUp ? 'GOOD' : 'POOR'}`);
        console.log(`    Regression detected: ${jankAnalysis.detected ? 'YES' : 'NO'}`);
        
        // Test passes if resources are properly managed under high concurrency
        testPassed = (
            !jankAnalysis.detected &&
            memoryRecovered &&
            handlesCleanedUp &&
            concurrencyResult.cancelled >= concurrencyLevel * 0.8 // Most operations cancelled successfully
        );
        
        if (testPassed) {
            console.log('✓ Resource management effective under high concurrency');
        } else {
            console.log('✗ Resource management issues under high concurrency');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'High Concurrency Resource Management',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 4: Repeated Session Cycle Stability
 * Tests for issues that accumulate over multiple session cycles
 */
async function testRepeatedSessionCycleStability() {
    console.log('\n📋 Test 4: Repeated Session Cycle Stability');
    
    let testPassed = false;
    
    try {
        const cycles = 10;
        const operationsPerCycle = 8;
        
        console.log(`  Running ${cycles} session cycles with ${operationsPerCycle} operations each...`);
        
        regressionDetector.recordMetrics('before_session_cycles');
        
        for (let cycle = 0; cycle < cycles; cycle++) {
            console.log(`    Cycle ${cycle + 1}/${cycles}`);
            
            // Simulate session with multiple operations
            const operations = [];
            const controllers = [];
            
            for (let op = 0; op < operationsPerCycle; op++) {
                const controller = new AbortController();
                controllers.push(controller);
                
                const operation = issueSimulator.createTerminalOperation(
                    `echo "Cycle ${cycle} Op ${op}"`,
                    controller.signal
                );
                
                operations.push(operation);
            }
            
            // Let operations run briefly
            await new Promise(resolve => setTimeout(resolve, 200));
            
            // Cancel some operations
            controllers.forEach((controller, index) => {
                if (index % 2 === 0) { // Cancel every other operation
                    controller.abort();
                }
            });
            
            // Wait for cycle completion
            await Promise.allSettled(operations);
            
            // Record metrics after each cycle
            regressionDetector.recordMetrics(`cycle_${cycle}`);
            
            // Small break between cycles
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Final cleanup wait
        await new Promise(resolve => setTimeout(resolve, 1000));
        regressionDetector.recordMetrics('final_session_cycles');
        
        // Analyze stability across session cycles
        const jankAnalysis = regressionDetector.detectCompoundingJank();
        const performanceTrend = regressionDetector.getPerformanceTrend();
        
        console.log('  Session Cycle Stability Analysis:');
        console.log(`    Performance trend: ${performanceTrend.trend}`);
        console.log(`    Compounding detected: ${jankAnalysis.detected ? 'YES' : 'NO'}`);
        
        if (jankAnalysis.detected) {
            console.log(`    Issue type: ${jankAnalysis.reason}`);
        }
        
        // Check for accumulation patterns
        const cycleMetrics = regressionDetector.performanceHistory.filter(m => 
            m.label && m.label.startsWith('cycle_')
        );
        
        if (cycleMetrics.length >= 3) {
            const firstCycle = cycleMetrics[0];
            const lastCycle = cycleMetrics[cycleMetrics.length - 1];
            
            const memoryAccumulation = lastCycle.memory.heapUsed - firstCycle.memory.heapUsed;
            const handleAccumulation = lastCycle.handles.total - firstCycle.handles.total;
            
            console.log(`    Memory accumulation: ${(memoryAccumulation / 1024 / 1024).toFixed(2)}MB`);
            console.log(`    Handle accumulation: ${handleAccumulation}`);
            
            const noSignificantAccumulation = (
                memoryAccumulation < 30 * 1024 * 1024 && // < 30MB
                handleAccumulation < 10
            );
            
            testPassed = (
                !jankAnalysis.detected &&
                performanceTrend.trend === 'stable' &&
                noSignificantAccumulation
            );
        } else {
            testPassed = !jankAnalysis.detected && performanceTrend.trend === 'stable';
        }
        
        if (testPassed) {
            console.log('✓ System remains stable across repeated session cycles');
        } else {
            console.log('✗ Stability issues detected across session cycles');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Repeated Session Cycle Stability',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 5: Edge Case Cancellation Scenarios
 * Tests edge cases that previously caused issues
 */
async function testEdgeCaseCancellationScenarios() {
    console.log('\n📋 Test 5: Edge Case Cancellation Scenarios');
    
    let testPassed = false;
    
    try {
        console.log('  Testing various edge case cancellation scenarios...');
        
        regressionDetector.recordMetrics('before_edge_cases');
        
        const edgeCaseResults = {
            immediateCancel: 0,
            delayedCancel: 0,
            multipleCancel: 0,
            preCompletionCancel: 0
        };
        
        // Edge case 1: Immediate cancellation
        console.log('    Testing immediate cancellation...');
        for (let i = 0; i < 10; i++) {
            const controller = new AbortController();
            
            const operation = issueSimulator.createTerminalOperation(
                `echo "Immediate cancel ${i}"`,
                controller.signal
            );
            
            // Cancel immediately
            controller.abort();
            
            try {
                await operation;
            } catch (error) {
                if (error.name === 'AbortError') {
                    edgeCaseResults.immediateCancel++;
                }
            }
        }
        
        // Edge case 2: Delayed cancellation
        console.log('    Testing delayed cancellation...');
        const delayedOps = [];
        const delayedControllers = [];
        
        for (let i = 0; i < 8; i++) {
            const controller = new AbortController();
            delayedControllers.push(controller);
            
            const operation = issueSimulator.createTerminalOperation(
                `sleep 0.5 && echo "Delayed cancel ${i}"`,
                controller.signal
            );
            
            delayedOps.push(operation);
        }
        
        // Cancel after various delays
        delayedControllers.forEach((controller, index) => {
            setTimeout(() => controller.abort(), (index + 1) * 100);
        });
        
        const delayedResults = await Promise.allSettled(delayedOps);
        edgeCaseResults.delayedCancel = delayedResults.filter(r => 
            r.status === 'rejected' && r.reason?.name === 'AbortError'
        ).length;
        
        // Edge case 3: Multiple cancellation attempts
        console.log('    Testing multiple cancellation attempts...');
        for (let i = 0; i < 5; i++) {
            const controller = new AbortController();
            
            const operation = issueSimulator.createTerminalOperation(
                `echo "Multiple cancel ${i}"`,
                controller.signal
            );
            
            // Multiple abort calls (should be safe)
            setTimeout(() => controller.abort(), 50);
            setTimeout(() => controller.abort(), 60);
            setTimeout(() => controller.abort(), 70);
            
            try {
                await operation;
            } catch (error) {
                if (error.name === 'AbortError') {
                    edgeCaseResults.multipleCancel++;
                }
            }
        }
        
        // Edge case 4: Pre-completion cancellation
        console.log('    Testing pre-completion cancellation...');
        for (let i = 0; i < 6; i++) {
            const controller = new AbortController();
            
            const operation = issueSimulator.createTerminalOperation(
                `echo "Pre-completion ${i}"`,
                controller.signal
            );
            
            // Cancel just before likely completion
            setTimeout(() => controller.abort(), 80);
            
            try {
                await operation;
            } catch (error) {
                if (error.name === 'AbortError') {
                    edgeCaseResults.preCompletionCancel++;
                }
            }
        }
        
        regressionDetector.recordMetrics('after_edge_cases');
        
        // Allow cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        regressionDetector.recordMetrics('final_edge_cases');
        
        console.log('  Edge Case Results:');
        console.log(`    Immediate cancellations: ${edgeCaseResults.immediateCancel}/10`);
        console.log(`    Delayed cancellations: ${edgeCaseResults.delayedCancel}/8`);
        console.log(`    Multiple cancel attempts: ${edgeCaseResults.multipleCancel}/5`);
        console.log(`    Pre-completion cancels: ${edgeCaseResults.preCompletionCancel}/6`);
        
        // Analyze for regressions
        const jankAnalysis = regressionDetector.detectCompoundingJank();
        
        console.log('  Edge Case Analysis:');
        console.log(`    Regression detected: ${jankAnalysis.detected ? 'YES' : 'NO'}`);
        
        // Test passes if edge cases are handled without regressions
        const allEdgeCasesWorked = (
            edgeCaseResults.immediateCancel >= 8 &&
            edgeCaseResults.delayedCancel >= 6 &&
            edgeCaseResults.multipleCancel >= 4 &&
            edgeCaseResults.preCompletionCancel >= 4
        );
        
        testPassed = allEdgeCasesWorked && !jankAnalysis.detected;
        
        if (testPassed) {
            console.log('✓ Edge case cancellation scenarios handled correctly');
        } else {
            console.log('✗ Issues detected in edge case cancellation scenarios');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Edge Case Cancellation Scenarios',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Main test runner
 */
async function runRegressionPreventionTests() {
    console.log('🚀 Starting Regression Prevention Test Suite\n');
    console.log('Target: Ensure original "compounding jank" issue is permanently resolved');
    
    const startTime = Date.now();
    let setupSuccess = false;
    
    try {
        setupSuccess = await setup();
        if (!setupSuccess) {
            throw new Error('Setup failed');
        }
        
        // Run all regression prevention tests
        const testFunctions = [
            testOriginalCompoundingJankScenario,
            testExtendedUsageMemoryStability,
            testHighConcurrencyResourceManagement,
            testRepeatedSessionCycleStability,
            testEdgeCaseCancellationScenarios
        ];
        
        let passedTests = 0;
        
        for (const testFn of testFunctions) {
            try {
                const result = await testFn();
                if (result) {
                    passedTests++;
                }
                
                // Cleanup delay between tests
                await new Promise(resolve => setTimeout(resolve, 800));
            } catch (error) {
                console.error(`Test function ${testFn.name} failed:`, error.message);
            }
        }
        
        // Generate comprehensive regression report
        const finalReport = regressionDetector.generateRegressionReport();
        const duration = Date.now() - startTime;
        
        console.log('\n📊 REGRESSION PREVENTION TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total tests: ${testFunctions.length}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${testFunctions.length - passedTests}`);
        console.log(`Duration: ${(duration/1000).toFixed(1)}s`);
        
        console.log('\n🔍 REGRESSION ANALYSIS REPORT');
        console.log('-'.repeat(40));
        console.log(`Regression detected: ${finalReport.regressionDetected ? 'YES ⚠️' : 'NO ✓'}`);
        console.log(`Compounding jank: ${finalReport.compoundingJank.detected ? 'DETECTED ⚠️' : 'NOT DETECTED ✓'}`);
        console.log(`Performance trend: ${finalReport.performanceTrend.trend}`);
        console.log(`Total samples collected: ${finalReport.summary.totalSamples}`);
        console.log(`Test duration: ${(finalReport.summary.testDuration/1000).toFixed(1)}s`);
        console.log(`Memory growth: ${(finalReport.summary.memoryGrowth/1024/1024).toFixed(2)}MB`);
        console.log(`Handle growth: ${finalReport.summary.handleGrowth}`);
        console.log(`Request growth: ${finalReport.summary.requestGrowth}`);
        
        if (finalReport.compoundingJank.detected) {
            console.log('\n⚠️  COMPOUNDING JANK DETAILS');
            console.log(`Reason: ${finalReport.compoundingJank.reason}`);
            console.log(`Memory concerning: ${finalReport.compoundingJank.memory.concerning}`);
            console.log(`Handles concerning: ${finalReport.compoundingJank.handles.concerning}`);
            console.log(`Compounding pattern: ${finalReport.compoundingJank.compounding}`);
        }
        
        console.log('\n📋 DETAILED TEST RESULTS');
        testResults.forEach(result => {
            const status = result.passed ? '✓' : '✗';
            console.log(`  ${status} ${result.name}`);
        });
        
        console.log('\n🎯 FINAL ASSESSMENT');
        console.log('-'.repeat(40));
        console.log(finalReport.recommendation);
        
        // Overall success criteria
        const allTestsPassed = passedTests === testFunctions.length;
        const noRegressionDetected = !finalReport.regressionDetected;
        const originalIssueFixed = !finalReport.compoundingJank.detected;
        
        if (allTestsPassed && noRegressionDetected && originalIssueFixed) {
            console.log('\n🎉 ALL REGRESSION PREVENTION TESTS PASSED!');
            console.log('✓ Original "compounding jank" issue is RESOLVED');
            console.log('✓ No performance regressions detected');
            console.log('✓ Memory management is stable');
            console.log('✓ Resource cleanup is effective');
            console.log('✓ System maintains performance under stress');
            console.log('\n🏆 PERFORMANCE FIXES SUCCESSFULLY VALIDATED!');
            return true;
        } else {
            console.log('\n❌ CRITICAL REGRESSION ISSUES DETECTED');
            if (!allTestsPassed) {
                console.log(`❌ ${testFunctions.length - passedTests} regression test(s) failed`);
            }
            if (finalReport.regressionDetected) {
                console.log('❌ Performance regression detected');
            }
            if (finalReport.compoundingJank.detected) {
                console.log('❌ Original "compounding jank" issue has RETURNED');
            }
            console.log('\n💥 PERFORMANCE FIXES NEED IMMEDIATE ATTENTION!');
            console.log('⚠️  System may experience degraded performance under load');
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
export default runRegressionPreventionTests;

// If run directly, execute tests
if (import.meta.url === `file://${process.argv[1]}`) {
    runRegressionPreventionTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('❌ Unhandled error:', error);
        process.exit(1);
    });
}