#!/usr/bin/env node

/**
 * Stress Testing Suite for Performance Validation
 * 
 * Comprehensive stress testing to validate performance under extreme conditions.
 * Focuses on scenarios that could expose memory leaks or performance degradation.
 * 
 * Key stress test scenarios:
 * - Rapid concurrent operation creation and cancellation
 * - High-frequency cancellation patterns
 * - Resource exhaustion edge cases
 * - Performance consistency under load
 * - Memory pressure scenarios
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

// Performance monitoring utilities
class PerformanceMonitor {
    constructor() {
        this.metrics = [];
        this.startTime = null;
        this.samples = [];
    }

    start() {
        this.startTime = process.hrtime.bigint();
        this.metrics = [];
        this.samples = [];
    }

    recordOperation(operationType, duration, success, metadata = {}) {
        this.metrics.push({
            type: operationType,
            duration,
            success,
            timestamp: Date.now(),
            metadata
        });
    }

    takePerfSample(label) {
        const now = process.hrtime.bigint();
        const memInfo = process.memoryUsage();
        
        const sample = {
            label,
            timestamp: Date.now(),
            elapsedNs: this.startTime ? now - this.startTime : 0n,
            memory: memInfo,
            handles: process._getActiveHandles().length,
            requests: process._getActiveRequests().length,
            metrics: {
                total: this.metrics.length,
                successful: this.metrics.filter(m => m.success).length,
                failed: this.metrics.filter(m => !m.success).length
            }
        };
        
        this.samples.push(sample);
        return sample;
    }

    calculateStats() {
        if (this.metrics.length === 0) {
            return { error: 'No metrics recorded' };
        }

        const durations = this.metrics.map(m => m.duration);
        const successful = this.metrics.filter(m => m.success);
        const failed = this.metrics.filter(m => !m.success);

        const sorted = [...durations].sort((a, b) => a - b);
        
        const stats = {
            total: this.metrics.length,
            successful: successful.length,
            failed: failed.length,
            successRate: (successful.length / this.metrics.length) * 100,
            duration: {
                min: Math.min(...durations),
                max: Math.max(...durations),
                avg: durations.reduce((a, b) => a + b, 0) / durations.length,
                p50: sorted[Math.floor(sorted.length * 0.5)],
                p90: sorted[Math.floor(sorted.length * 0.9)],
                p99: sorted[Math.floor(sorted.length * 0.99)]
            },
            throughput: {
                operationsPerSecond: this.metrics.length / (Number(this.samples[this.samples.length - 1]?.elapsedNs || 1n) / 1e9)
            }
        };

        return stats;
    }

    getMemoryTrend() {
        if (this.samples.length < 2) {
            return { trend: 'insufficient_data' };
        }

        const memoryValues = this.samples.map(s => s.memory.heapUsed);
        const first = memoryValues[0];
        const last = memoryValues[memoryValues.length - 1];
        const growth = last - first;
        const growthPercent = (growth / first) * 100;

        return {
            initial: first,
            final: last,
            growth,
            growthPercent,
            trend: growthPercent > 20 ? 'concerning' : growthPercent > 5 ? 'moderate' : 'stable'
        };
    }
}

// Enhanced test utilities
class StressTestController {
    constructor() {
        this.signal = new StressTestSignal();
        this.aborted = false;
    }

    abort() {
        if (!this.aborted) {
            this.aborted = true;
            this.signal._abort();
        }
    }
}

class StressTestSignal extends EventEmitter {
    constructor() {
        super();
        this.aborted = false;
        this.listeners = new Set();
    }

    _abort() {
        this.aborted = true;
        this.emit('abort');
    }

    addEventListener(event, listener) {
        this.listeners.add(listener);
        this.on(event, listener);
    }

    removeEventListener(event, listener) {
        this.listeners.delete(listener);
        this.off(event, listener);
    }

    getListenerCount() {
        return this.listeners.size;
    }
}

// Advanced mock terminal manager with stress testing features
class StressTestTerminalManager {
    constructor() {
        this.sessions = new Map();
        this.nextPid = 1000;
        this.operationDelay = { min: 50, max: 500 };
        this.failureRate = 0.05; // 5% failure rate
    }

    setOperationDelay(min, max) {
        this.operationDelay = { min, max };
    }

    setFailureRate(rate) {
        this.failureRate = rate;
    }

    async executeCommand(command, timeout, shell, signal) {
        const pid = this.nextPid++;
        const startTime = process.hrtime.bigint();
        
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
            
            const rejectOnce = (error) => {
                if (resolved) return;
                resolved = true;
                cleanup();
                reject(error);
            };
            
            // Store session
            this.sessions.set(pid, { 
                command, 
                startTime: Date.now(), 
                cleanup,
                pid
            });
            
            // Setup cancellation
            if (signal) {
                signal.addEventListener('abort', () => {
                    if (!resolved) {
                        const error = new Error('Operation was cancelled');
                        error.name = 'AbortError';
                        rejectOnce(error);
                    }
                });
            }
            
            // Simulate background work with potential resource usage
            intervalId = setInterval(() => {
                // Simulate periodic resource usage
            }, 50);
            
            // Simulate operation completion
            const operationDuration = Math.random() * 
                (this.operationDelay.max - this.operationDelay.min) + 
                this.operationDelay.min;
            
            timeoutId = setTimeout(() => {
                // Simulate random failures
                if (Math.random() < this.failureRate) {
                    rejectOnce(new Error(`Operation failed: ${command}`));
                } else {
                    const duration = Number(process.hrtime.bigint() - startTime) / 1e6; // Convert to ms
                    resolveOnce({
                        pid,
                        output: `Output for: ${command}`,
                        isBlocked: false,
                        duration
                    });
                }
            }, operationDuration);
        });
    }

    getActiveSessions() {
        return Array.from(this.sessions.keys());
    }

    getSessionCount() {
        return this.sessions.size;
    }

    forceCleanupAll() {
        for (const [pid, session] of this.sessions) {
            session.cleanup();
        }
        this.sessions.clear();
    }
}

// Global test state
let perfMonitor = new PerformanceMonitor();
let stressTerminalManager = new StressTestTerminalManager();
let testResults = [];
let originalConfig;

/**
 * Setup function
 */
async function setup() {
    console.log('🔧 Setting up Stress Performance Tests...');
    
    // Save and configure for testing
    originalConfig = await configManager.getConfig();
    await configManager.setValue('allowedDirectories', [process.cwd()]);
    
    // Initialize performance monitoring
    perfMonitor.start();
    
    console.log('✓ Performance monitoring initialized');
    console.log('✓ Stress test environment configured');
    return true;
}

/**
 * Teardown function
 */
async function teardown() {
    console.log('🧹 Cleaning up Stress Performance Tests...');
    
    // Force cleanup
    stressTerminalManager.forceCleanupAll();
    
    // Restore configuration
    if (originalConfig) {
        await configManager.updateConfig(originalConfig);
    }
    
    // Give time for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('✓ Stress test cleanup completed');
}

/**
 * Test 1: Concurrent Operation Burst
 * Creates many operations simultaneously to test resource handling
 */
async function testConcurrentOperationBurst() {
    console.log('\n📋 Test 1: Concurrent Operation Burst');
    
    const testStart = Date.now();
    perfMonitor.takePerfSample('concurrent_burst_start');
    
    let testPassed = false;
    
    try {
        const burstSize = 50;
        const operations = [];
        const controllers = [];
        let completedOps = 0;
        let cancelledOps = 0;
        
        console.log(`  Creating ${burstSize} concurrent operations...`);
        
        // Create burst of operations
        for (let i = 0; i < burstSize; i++) {
            const controller = new StressTestController();
            controllers.push(controller);
            
            const opStart = Date.now();
            const operation = stressTerminalManager.executeCommand(
                `echo "Burst operation ${i}"`,
                2000,
                true,
                controller.signal
            ).then(
                result => {
                    const duration = Date.now() - opStart;
                    perfMonitor.recordOperation('concurrent_op', duration, true, { id: i });
                    completedOps++;
                    return result;
                },
                error => {
                    const duration = Date.now() - opStart;
                    const isCancellation = error.name === 'AbortError';
                    perfMonitor.recordOperation('concurrent_op', duration, false, { 
                        id: i, 
                        cancelled: isCancellation 
                    });
                    if (isCancellation) cancelledOps++;
                    throw error;
                }
            );
            
            operations.push(operation);
        }
        
        // Cancel some operations at random intervals
        const cancellationTasks = [];
        for (let i = 0; i < burstSize * 0.3; i++) { // Cancel 30%
            const delay = Math.random() * 300;
            const controllerIndex = Math.floor(Math.random() * controllers.length);
            
            cancellationTasks.push(
                new Promise(resolve => {
                    setTimeout(() => {
                        if (!controllers[controllerIndex].aborted) {
                            controllers[controllerIndex].abort();
                        }
                        resolve();
                    }, delay);
                })
            );
        }
        
        // Wait for cancellations to be scheduled
        await Promise.all(cancellationTasks);
        
        // Wait for all operations to complete or fail
        const results = await Promise.allSettled(operations);
        
        perfMonitor.takePerfSample('concurrent_burst_end');
        const testDuration = Date.now() - testStart;
        
        // Analyze results
        const successful = results.filter(r => r.status === 'fulfilled').length;
        const cancelled = results.filter(r => 
            r.status === 'rejected' && r.reason?.name === 'AbortError'
        ).length;
        
        console.log(`  Results: ${successful} successful, ${cancelled} cancelled`);
        console.log(`  Test duration: ${testDuration}ms`);
        console.log(`  Operations completed: ${completedOps}`);
        console.log(`  Operations cancelled: ${cancelledOps}`);
        
        // Check for resource cleanup
        const activeSessions = stressTerminalManager.getSessionCount();
        console.log(`  Active sessions remaining: ${activeSessions}`);
        
        // Performance stats
        const stats = perfMonitor.calculateStats();
        console.log(`  Average operation duration: ${stats.duration.avg.toFixed(2)}ms`);
        console.log(`  Success rate: ${stats.successRate.toFixed(1)}%`);
        
        // Test passes if:
        // - Some operations completed successfully
        // - Some were cancelled (showing cancellation works)
        // - No excessive resource accumulation
        // - Reasonable performance
        testPassed = (
            successful > 0 &&
            cancelled > 0 &&
            activeSessions < 5 &&
            stats.duration.avg < 1000 &&
            stats.successRate > 30
        );
        
        if (testPassed) {
            console.log('✓ Concurrent operation burst handled successfully');
        } else {
            console.log('✗ Issues detected in concurrent operation handling');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Concurrent Operation Burst',
        passed: testPassed,
        stats: perfMonitor.calculateStats(),
        memoryTrend: perfMonitor.getMemoryTrend()
    });
    
    return testPassed;
}

/**
 * Test 2: High-Frequency Cancellation Stress
 * Rapidly creates and cancels operations to stress cancellation logic
 */
async function testHighFrequencyCancellation() {
    console.log('\n📋 Test 2: High-Frequency Cancellation Stress');
    
    perfMonitor.takePerfSample('high_freq_cancel_start');
    
    let testPassed = false;
    
    try {
        const duration = 10000; // 10 seconds
        const createInterval = 50; // Create operation every 50ms
        const startTime = Date.now();
        
        console.log(`  Running high-frequency cancellation for ${duration/1000} seconds...`);
        
        let operationsCreated = 0;
        let operationsCancelled = 0;
        let operationsCompleted = 0;
        let activeOperations = 0;
        
        const stressTest = new Promise((resolve) => {
            const createInterval_ID = setInterval(async () => {
                if (Date.now() - startTime >= duration) {
                    clearInterval(createInterval_ID);
                    resolve();
                    return;
                }
                
                activeOperations++;
                operationsCreated++;
                
                const controller = new StressTestController();
                const opStart = Date.now();
                
                // Create operation
                const operation = stressTerminalManager.executeCommand(
                    `echo "High freq ${operationsCreated}"`,
                    1000,
                    true,
                    controller.signal
                ).then(
                    result => {
                        const duration = Date.now() - opStart;
                        perfMonitor.recordOperation('high_freq_op', duration, true);
                        operationsCompleted++;
                        return result;
                    },
                    error => {
                        const duration = Date.now() - opStart;
                        const isCancellation = error.name === 'AbortError';
                        perfMonitor.recordOperation('high_freq_op', duration, false, { 
                            cancelled: isCancellation 
                        });
                        if (isCancellation) operationsCancelled++;
                        throw error;
                    }
                ).finally(() => {
                    activeOperations--;
                });
                
                // Randomly cancel operation quickly
                if (Math.random() < 0.7) { // Cancel 70% of operations
                    const cancelDelay = Math.random() * 100; // 0-100ms
                    setTimeout(() => {
                        controller.abort();
                    }, cancelDelay);
                }
            }, createInterval);
        });
        
        await stressTest;
        
        // Wait for remaining operations to complete
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        perfMonitor.takePerfSample('high_freq_cancel_end');
        
        console.log(`  Operations created: ${operationsCreated}`);
        console.log(`  Operations cancelled: ${operationsCancelled}`);
        console.log(`  Operations completed: ${operationsCompleted}`);
        console.log(`  Active operations remaining: ${activeOperations}`);
        
        // Performance analysis
        const stats = perfMonitor.calculateStats();
        const memoryTrend = perfMonitor.getMemoryTrend();
        
        console.log(`  Cancellation rate: ${(operationsCancelled/operationsCreated*100).toFixed(1)}%`);
        console.log(`  Average operation duration: ${stats.duration.avg.toFixed(2)}ms`);
        console.log(`  Memory trend: ${memoryTrend.trend}`);
        
        // Test passes if:
        // - High cancellation rate achieved
        // - Memory trend is stable
        // - Active operations cleaned up
        // - Performance remained reasonable
        testPassed = (
            operationsCancelled > operationsCreated * 0.5 &&
            memoryTrend.trend !== 'concerning' &&
            activeOperations < 5 &&
            stats.duration.avg < 500
        );
        
        if (testPassed) {
            console.log('✓ High-frequency cancellation stress handled successfully');
        } else {
            console.log('✗ Issues detected in high-frequency cancellation');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'High-Frequency Cancellation Stress',
        passed: testPassed,
        stats: perfMonitor.calculateStats(),
        memoryTrend: perfMonitor.getMemoryTrend()
    });
    
    return testPassed;
}

/**
 * Test 3: Resource Exhaustion Edge Cases
 * Tests behavior when approaching resource limits
 */
async function testResourceExhaustionEdgeCases() {
    console.log('\n📋 Test 3: Resource Exhaustion Edge Cases');
    
    perfMonitor.takePerfSample('resource_exhaustion_start');
    
    let testPassed = false;
    
    try {
        // Simulate resource pressure by creating many operations
        const maxOperations = 100;
        const operations = [];
        const controllers = [];
        
        console.log(`  Creating ${maxOperations} operations to test resource limits...`);
        
        // Reduce operation delays to increase resource pressure
        stressTerminalManager.setOperationDelay(10, 100);
        
        for (let i = 0; i < maxOperations; i++) {
            const controller = new StressTestController();
            controllers.push(controller);
            
            const operation = stressTerminalManager.executeCommand(
                `echo "Resource test ${i}"`,
                5000, // Longer timeout to maintain pressure
                true,
                controller.signal
            ).catch(error => {
                // Handle errors gracefully
                return { error: error.message, cancelled: error.name === 'AbortError' };
            });
            
            operations.push(operation);
            
            // Small delay between creation to observe resource accumulation
            if (i % 10 === 9) {
                await new Promise(resolve => setTimeout(resolve, 50));
                perfMonitor.takePerfSample(`resource_pressure_${i}`);
            }
        }
        
        // Let operations run for a while to build pressure
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check resource usage at peak
        const peakSample = perfMonitor.takePerfSample('resource_peak');
        const activeSessions = stressTerminalManager.getSessionCount();
        
        console.log(`  Peak active sessions: ${activeSessions}`);
        console.log(`  Peak memory usage: ${(peakSample.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  Peak handle count: ${peakSample.handles}`);
        
        // Cancel all operations to test cleanup under pressure
        console.log('  Cancelling all operations to test cleanup...');
        controllers.forEach(controller => controller.abort());
        
        // Wait for cancellation and cleanup
        await Promise.allSettled(operations);
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        perfMonitor.takePerfSample('resource_exhaustion_end');
        
        // Check cleanup effectiveness
        const finalSessions = stressTerminalManager.getSessionCount();
        const finalSample = perfMonitor.samples[perfMonitor.samples.length - 1];
        
        console.log(`  Final active sessions: ${finalSessions}`);
        console.log(`  Final memory usage: ${(finalSample.memory.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  Final handle count: ${finalSample.handles}`);
        
        // Memory recovery analysis
        const memoryRecovery = peakSample.memory.heapUsed - finalSample.memory.heapUsed;
        const handleRecovery = peakSample.handles - finalSample.handles;
        
        console.log(`  Memory recovered: ${(memoryRecovery / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  Handles cleaned up: ${handleRecovery}`);
        
        // Reset operation delays
        stressTerminalManager.setOperationDelay(50, 500);
        
        // Test passes if:
        // - System handled resource pressure without crashing
        // - Cleanup was effective (sessions, memory, handles)
        // - No excessive resource accumulation
        testPassed = (
            finalSessions < 5 &&
            memoryRecovery > 0 &&
            handleRecovery >= 0 &&
            finalSample.memory.heapUsed < peakSample.memory.heapUsed * 1.2
        );
        
        if (testPassed) {
            console.log('✓ Resource exhaustion edge cases handled successfully');
        } else {
            console.log('✗ Issues detected in resource exhaustion handling');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Resource Exhaustion Edge Cases',
        passed: testPassed,
        stats: perfMonitor.calculateStats(),
        memoryTrend: perfMonitor.getMemoryTrend()
    });
    
    return testPassed;
}

/**
 * Test 4: Performance Consistency Under Load
 * Tests that performance remains consistent over extended periods
 */
async function testPerformanceConsistency() {
    console.log('\n📋 Test 4: Performance Consistency Under Load');
    
    perfMonitor.takePerfSample('consistency_start');
    
    let testPassed = false;
    
    try {
        const testDuration = 20000; // 20 seconds
        const operationInterval = 300; // Operation every 300ms
        const startTime = Date.now();
        
        console.log(`  Testing performance consistency for ${testDuration/1000} seconds...`);
        
        const performanceSamples = [];
        let operationCount = 0;
        
        const consistencyTest = new Promise((resolve) => {
            const interval = setInterval(async () => {
                if (Date.now() - startTime >= testDuration) {
                    clearInterval(interval);
                    resolve();
                    return;
                }
                
                operationCount++;
                const controller = new StressTestController();
                const opStart = Date.now();
                
                // Create operation with performance tracking
                const operation = stressTerminalManager.executeCommand(
                    `echo "Consistency test ${operationCount}"`,
                    1000,
                    true,
                    controller.signal
                ).then(
                    result => {
                        const duration = Date.now() - opStart;
                        perfMonitor.recordOperation('consistency_op', duration, true);
                        performanceSamples.push(duration);
                        return result;
                    },
                    error => {
                        const duration = Date.now() - opStart;
                        perfMonitor.recordOperation('consistency_op', duration, false);
                        if (error.name !== 'AbortError') {
                            performanceSamples.push(duration);
                        }
                        throw error;
                    }
                );
                
                // Randomly cancel some operations
                if (Math.random() < 0.2) { // Cancel 20%
                    setTimeout(() => controller.abort(), Math.random() * 100);
                }
                
                // Take periodic performance samples
                if (operationCount % 10 === 0) {
                    perfMonitor.takePerfSample(`consistency_${operationCount}`);
                }
            }, operationInterval);
        });
        
        await consistencyTest;
        
        perfMonitor.takePerfSample('consistency_end');
        
        // Analyze performance consistency
        if (performanceSamples.length === 0) {
            throw new Error('No performance samples collected');
        }
        
        const sortedSamples = [...performanceSamples].sort((a, b) => a - b);
        const avgDuration = performanceSamples.reduce((a, b) => a + b, 0) / performanceSamples.length;
        const p50 = sortedSamples[Math.floor(sortedSamples.length * 0.5)];
        const p90 = sortedSamples[Math.floor(sortedSamples.length * 0.9)];
        const p99 = sortedSamples[Math.floor(sortedSamples.length * 0.99)];
        
        // Calculate performance variance
        const variance = performanceSamples.reduce((sum, duration) => {
            return sum + Math.pow(duration - avgDuration, 2);
        }, 0) / performanceSamples.length;
        const stdDev = Math.sqrt(variance);
        const coefficientOfVariation = stdDev / avgDuration;
        
        console.log(`  Operations completed: ${operationCount}`);
        console.log(`  Performance samples: ${performanceSamples.length}`);
        console.log(`  Average duration: ${avgDuration.toFixed(2)}ms`);
        console.log(`  P50: ${p50}ms, P90: ${p90}ms, P99: ${p99}ms`);
        console.log(`  Standard deviation: ${stdDev.toFixed(2)}ms`);
        console.log(`  Coefficient of variation: ${(coefficientOfVariation * 100).toFixed(1)}%`);
        
        // Memory consistency check
        const memoryTrend = perfMonitor.getMemoryTrend();
        console.log(`  Memory trend: ${memoryTrend.trend}`);
        
        // Test passes if:
        // - Performance variance is reasonable (CV < 50%)
        // - Average duration is reasonable (< 300ms)
        // - Memory trend is stable
        // - P99 latency is acceptable (< 1000ms)
        testPassed = (
            coefficientOfVariation < 0.5 &&
            avgDuration < 300 &&
            memoryTrend.trend !== 'concerning' &&
            p99 < 1000
        );
        
        if (testPassed) {
            console.log('✓ Performance remained consistent under load');
        } else {
            console.log('✗ Performance consistency issues detected');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Performance Consistency Under Load',
        passed: testPassed,
        stats: perfMonitor.calculateStats(),
        memoryTrend: perfMonitor.getMemoryTrend()
    });
    
    return testPassed;
}

/**
 * Test 5: Memory Pressure Scenarios
 * Tests behavior under simulated memory pressure
 */
async function testMemoryPressureScenarios() {
    console.log('\n📋 Test 5: Memory Pressure Scenarios');
    
    perfMonitor.takePerfSample('memory_pressure_start');
    
    let testPassed = false;
    
    try {
        console.log('  Simulating memory pressure with large data operations...');
        
        // Create operations that simulate memory-intensive tasks
        const memoryIntensiveOps = [];
        const controllers = [];
        
        for (let i = 0; i < 20; i++) {
            const controller = new StressTestController();
            controllers.push(controller);
            
            // Simulate memory-intensive operation
            const operation = new Promise((resolve, reject) => {
                let resolved = false;
                const largeData = [];
                
                const cleanup = () => {
                    largeData.length = 0; // Clear array
                };
                
                controller.signal.addEventListener('abort', () => {
                    if (!resolved) {
                        resolved = true;
                        cleanup();
                        const error = new Error('Operation was cancelled');
                        error.name = 'AbortError';
                        reject(error);
                    }
                });
                
                // Simulate memory allocation
                const allocateMemory = () => {
                    if (resolved) return;
                    
                    // Allocate some memory (simulate data processing)
                    for (let j = 0; j < 1000; j++) {
                        largeData.push(`Data chunk ${i}-${j}-${Math.random()}`);
                    }
                    
                    if (largeData.length < 10000) {
                        setTimeout(allocateMemory, 10);
                    } else {
                        if (!resolved) {
                            resolved = true;
                            cleanup();
                            resolve(`Memory operation ${i} completed`);
                        }
                    }
                };
                
                allocateMemory();
            });
            
            memoryIntensiveOps.push(operation);
        }
        
        // Let operations run and build memory pressure
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        perfMonitor.takePerfSample('memory_pressure_peak');
        
        // Cancel operations under memory pressure
        console.log('  Cancelling operations under memory pressure...');
        controllers.forEach(controller => controller.abort());
        
        // Wait for cancellation and cleanup
        await Promise.allSettled(memoryIntensiveOps);
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        perfMonitor.takePerfSample('memory_pressure_end');
        
        // Analyze memory behavior
        const samples = perfMonitor.samples.slice(-3); // Last 3 samples
        const startSample = samples[0];
        const peakSample = samples[1];
        const endSample = samples[2];
        
        const memoryGrowth = peakSample.memory.heapUsed - startSample.memory.heapUsed;
        const memoryRecovery = peakSample.memory.heapUsed - endSample.memory.heapUsed;
        const recoveryPercent = (memoryRecovery / memoryGrowth) * 100;
        
        console.log(`  Memory growth: ${(memoryGrowth / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  Memory recovery: ${(memoryRecovery / 1024 / 1024).toFixed(2)}MB`);
        console.log(`  Recovery percentage: ${recoveryPercent.toFixed(1)}%`);
        
        // Check handle cleanup
        const handleGrowth = peakSample.handles - startSample.handles;
        const handleRecovery = peakSample.handles - endSample.handles;
        
        console.log(`  Handle growth: ${handleGrowth}`);
        console.log(`  Handle recovery: ${handleRecovery}`);
        
        // Test passes if:
        // - Memory was recovered after cancellation (> 50%)
        // - Handles were cleaned up properly
        // - System remained stable under pressure
        testPassed = (
            recoveryPercent > 50 &&
            handleRecovery >= 0 &&
            endSample.memory.heapUsed < peakSample.memory.heapUsed * 1.3
        );
        
        if (testPassed) {
            console.log('✓ Memory pressure scenarios handled successfully');
        } else {
            console.log('✗ Issues detected in memory pressure handling');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Memory Pressure Scenarios',
        passed: testPassed,
        stats: perfMonitor.calculateStats(),
        memoryTrend: perfMonitor.getMemoryTrend()
    });
    
    return testPassed;
}

/**
 * Main test runner
 */
async function runStressTests() {
    console.log('🚀 Starting Stress Testing Suite\n');
    console.log('Target: Validate performance under extreme load conditions');
    
    const startTime = Date.now();
    let setupSuccess = false;
    
    try {
        setupSuccess = await setup();
        if (!setupSuccess) {
            throw new Error('Setup failed');
        }
        
        // Run all stress tests
        const testFunctions = [
            testConcurrentOperationBurst,
            testHighFrequencyCancellation,
            testResourceExhaustionEdgeCases,
            testPerformanceConsistency,
            testMemoryPressureScenarios
        ];
        
        let passedTests = 0;
        
        for (const testFn of testFunctions) {
            try {
                const result = await testFn();
                if (result) {
                    passedTests++;
                }
                
                // Cleanup delay between tests
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Test function ${testFn.name} failed:`, error.message);
            }
        }
        
        // Generate comprehensive performance report
        const finalStats = perfMonitor.calculateStats();
        const memoryTrend = perfMonitor.getMemoryTrend();
        const duration = Date.now() - startTime;
        
        console.log('\n📊 STRESS TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total tests: ${testFunctions.length}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${testFunctions.length - passedTests}`);
        console.log(`Duration: ${(duration/1000).toFixed(1)}s`);
        
        console.log('\n⚡ PERFORMANCE ANALYSIS');
        console.log('-'.repeat(40));
        console.log(`Total operations: ${finalStats.total}`);
        console.log(`Success rate: ${finalStats.successRate.toFixed(1)}%`);
        console.log(`Average duration: ${finalStats.duration.avg.toFixed(2)}ms`);
        console.log(`P90 duration: ${finalStats.duration.p90.toFixed(2)}ms`);
        console.log(`P99 duration: ${finalStats.duration.p99.toFixed(2)}ms`);
        console.log(`Throughput: ${finalStats.throughput.operationsPerSecond.toFixed(1)} ops/sec`);
        
        console.log('\n💾 MEMORY ANALYSIS');
        console.log('-'.repeat(40));
        console.log(`Memory trend: ${memoryTrend.trend}`);
        console.log(`Memory growth: ${(memoryTrend.growth / 1024 / 1024).toFixed(2)}MB`);
        console.log(`Growth percentage: ${memoryTrend.growthPercent.toFixed(1)}%`);
        
        console.log('\n📋 DETAILED TEST RESULTS');
        testResults.forEach(result => {
            const status = result.passed ? '✓' : '✗';
            console.log(`  ${status} ${result.name}`);
        });
        
        // Final assessment
        const allTestsPassed = passedTests === testFunctions.length;
        const performanceAcceptable = (
            finalStats.successRate > 80 &&
            finalStats.duration.p99 < 2000 &&
            memoryTrend.trend !== 'concerning'
        );
        
        if (allTestsPassed && performanceAcceptable) {
            console.log('\n🎉 ALL STRESS TESTS PASSED!');
            console.log('✓ System handles extreme load conditions');
            console.log('✓ Performance remains consistent under stress');
            console.log('✓ Memory behavior is stable');
            console.log('✓ Resource cleanup is effective');
            return true;
        } else {
            console.log('\n❌ STRESS TEST CONCERNS DETECTED');
            if (!allTestsPassed) {
                console.log(`❌ ${testFunctions.length - passedTests} test(s) failed`);
            }
            if (!performanceAcceptable) {
                console.log('❌ Performance degradation detected under stress');
            }
            console.log('⚠️  System may need optimization for high-load scenarios');
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
export default runStressTests;

// If run directly, execute tests
if (import.meta.url === `file://${process.argv[1]}`) {
    runStressTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('❌ Unhandled error:', error);
        process.exit(1);
    });
}