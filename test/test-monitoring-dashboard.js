#!/usr/bin/env node

/**
 * Memory Monitoring Dashboard Utilities
 * 
 * Real-time monitoring and visualization tools for tracking system performance
 * and memory usage. Provides dashboard-style reporting and continuous monitoring
 * capabilities to validate performance fixes over time.
 * 
 * Features:
 * - Real-time memory and resource tracking
 * - Performance trend visualization
 * - Resource usage alerts and thresholds
 * - Dashboard-style reporting
 * - Continuous monitoring mode
 * - Historical data analysis
 */

import { EventEmitter } from 'events';
import { resourceManager } from '../dist/resource-manager.js';
import { configManager } from '../dist/config-manager.js';

// Real-time monitoring dashboard
class MonitoringDashboard extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = {
            updateInterval: options.updateInterval || 1000, // 1 second
            maxHistory: options.maxHistory || 300, // 5 minutes at 1s intervals
            alertThresholds: {
                memoryMB: options.memoryMB || 200,
                handles: options.handles || 50,
                memoryGrowthRate: options.memoryGrowthRate || 10, // MB/minute
                handleGrowthRate: options.handleGrowthRate || 5   // handles/minute
            },
            ...options
        };
        
        this.isRunning = false;
        this.intervalId = null;
        this.history = [];
        this.alerts = [];
        this.startTime = Date.now();
        this.updateCount = 0;
    }

    start() {
        if (this.isRunning) {
            console.log('Dashboard is already running');
            return;
        }

        console.log('🚀 Starting Memory Monitoring Dashboard...');
        console.log(`  Update interval: ${this.options.updateInterval}ms`);
        console.log(`  History size: ${this.options.maxHistory} samples`);
        console.log(`  Memory threshold: ${this.options.alertThresholds.memoryMB}MB`);
        console.log(`  Handle threshold: ${this.options.alertThresholds.handles}`);
        
        this.isRunning = true;
        this.startTime = Date.now();
        this.updateCount = 0;
        
        // Take initial sample
        this.takeSample();
        
        // Start monitoring loop
        this.intervalId = setInterval(() => {
            this.takeSample();
            this.updateCount++;
            
            // Emit dashboard update
            this.emit('update', this.getCurrentState());
            
            // Check for alerts
            this.checkAlerts();
            
        }, this.options.updateInterval);
        
        this.emit('started');
        console.log('✓ Dashboard monitoring started');
    }

    stop() {
        if (!this.isRunning) {
            console.log('Dashboard is not running');
            return;
        }

        console.log('🛑 Stopping Memory Monitoring Dashboard...');
        
        this.isRunning = false;
        
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        
        this.emit('stopped', this.generateFinalReport());
        console.log('✓ Dashboard monitoring stopped');
    }

    async takeSample() {
        try {
            const timestamp = Date.now();
            const memInfo = process.memoryUsage();
            const handles = process._getActiveHandles();
            const requests = process._getActiveRequests();
            
            // Get ResourceManager health if available
            let systemHealth = null;
            try {
                systemHealth = await resourceManager.getSystemHealth();
            } catch (error) {
                // ResourceManager might not be available
            }

            const sample = {
                timestamp,
                uptime: timestamp - this.startTime,
                memory: {
                    rss: memInfo.rss,
                    heapUsed: memInfo.heapUsed,
                    heapTotal: memInfo.heapTotal,
                    external: memInfo.external,
                    heapUsedMB: memInfo.heapUsed / 1024 / 1024
                },
                handles: {
                    total: handles.length,
                    types: this.categorizeHandles(handles)
                },
                requests: requests.length,
                system: systemHealth ? {
                    status: systemHealth.status,
                    totalComponents: systemHealth.totalComponents,
                    healthyComponents: systemHealth.healthyComponents,
                    memoryMB: systemHealth.systemUsage.memoryMB || 0,
                    activeConnections: systemHealth.systemUsage.activeConnections || 0
                } : null,
                processInfo: {
                    pid: process.pid,
                    cpuUsage: process.cpuUsage(),
                    uptime: process.uptime()
                }
            };

            // Add derived metrics
            if (this.history.length > 0) {
                const previous = this.history[this.history.length - 1];
                const timeDelta = (timestamp - previous.timestamp) / 1000; // seconds
                
                sample.rates = {
                    memoryGrowthMBPerSec: (sample.memory.heapUsedMB - previous.memory.heapUsedMB) / timeDelta,
                    handleGrowthPerSec: (sample.handles.total - previous.handles.total) / timeDelta,
                    requestGrowthPerSec: (sample.requests - previous.requests) / timeDelta
                };
            } else {
                sample.rates = {
                    memoryGrowthMBPerSec: 0,
                    handleGrowthPerSec: 0,
                    requestGrowthPerSec: 0
                };
            }

            this.history.push(sample);
            
            // Maintain history size
            if (this.history.length > this.options.maxHistory) {
                this.history.shift();
            }

            return sample;
        } catch (error) {
            console.error('Error taking monitoring sample:', error.message);
            return null;
        }
    }

    categorizeHandles(handles) {
        const categories = {
            timers: 0,
            tcp: 0,
            pipe: 0,
            process: 0,
            fs: 0,
            tty: 0,
            other: 0
        };

        handles.forEach(handle => {
            const type = handle.constructor.name.toLowerCase();
            if (type.includes('timer') || type.includes('timeout') || type.includes('interval')) {
                categories.timers++;
            } else if (type.includes('tcp')) {
                categories.tcp++;
            } else if (type.includes('pipe')) {
                categories.pipe++;
            } else if (type.includes('process') || type.includes('child')) {
                categories.process++;
            } else if (type.includes('fs') || type.includes('file')) {
                categories.fs++;
            } else if (type.includes('tty')) {
                categories.tty++;
            } else {
                categories.other++;
            }
        });

        return categories;
    }

    checkAlerts() {
        if (this.history.length === 0) return;

        const current = this.history[this.history.length - 1];
        const alerts = [];

        // Memory threshold alert
        if (current.memory.heapUsedMB > this.options.alertThresholds.memoryMB) {
            alerts.push({
                type: 'memory_threshold',
                severity: 'warning',
                message: `Memory usage ${current.memory.heapUsedMB.toFixed(2)}MB exceeds threshold ${this.options.alertThresholds.memoryMB}MB`,
                value: current.memory.heapUsedMB,
                threshold: this.options.alertThresholds.memoryMB,
                timestamp: current.timestamp
            });
        }

        // Handle threshold alert
        if (current.handles.total > this.options.alertThresholds.handles) {
            alerts.push({
                type: 'handle_threshold',
                severity: 'warning',
                message: `Handle count ${current.handles.total} exceeds threshold ${this.options.alertThresholds.handles}`,
                value: current.handles.total,
                threshold: this.options.alertThresholds.handles,
                timestamp: current.timestamp
            });
        }

        // Growth rate alerts (check over last minute)
        if (this.history.length >= 60) { // At least 1 minute of data
            const oneMinuteAgo = this.history[this.history.length - 61];
            const memoryGrowthMBPerMin = (current.memory.heapUsedMB - oneMinuteAgo.memory.heapUsedMB);
            const handleGrowthPerMin = current.handles.total - oneMinuteAgo.handles.total;

            if (memoryGrowthMBPerMin > this.options.alertThresholds.memoryGrowthRate) {
                alerts.push({
                    type: 'memory_growth_rate',
                    severity: 'critical',
                    message: `Memory growth rate ${memoryGrowthMBPerMin.toFixed(2)}MB/min exceeds threshold ${this.options.alertThresholds.memoryGrowthRate}MB/min`,
                    value: memoryGrowthMBPerMin,
                    threshold: this.options.alertThresholds.memoryGrowthRate,
                    timestamp: current.timestamp
                });
            }

            if (handleGrowthPerMin > this.options.alertThresholds.handleGrowthRate) {
                alerts.push({
                    type: 'handle_growth_rate',
                    severity: 'critical',
                    message: `Handle growth rate ${handleGrowthPerMin}/min exceeds threshold ${this.options.alertThresholds.handleGrowthRate}/min`,
                    value: handleGrowthPerMin,
                    threshold: this.options.alertThresholds.handleGrowthRate,
                    timestamp: current.timestamp
                });
            }
        }

        // Emit alerts
        alerts.forEach(alert => {
            this.alerts.push(alert);
            this.emit('alert', alert);
        });

        // Keep alert history manageable
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(-50);
        }
    }

    getCurrentState() {
        if (this.history.length === 0) return null;

        const current = this.history[this.history.length - 1];
        const stats = this.calculateStats();
        
        return {
            current,
            stats,
            isRunning: this.isRunning,
            updateCount: this.updateCount,
            alertCount: this.alerts.length,
            uptime: Date.now() - this.startTime
        };
    }

    calculateStats() {
        if (this.history.length === 0) return null;

        const memoryValues = this.history.map(h => h.memory.heapUsedMB);
        const handleValues = this.history.map(h => h.handles.total);
        const requestValues = this.history.map(h => h.requests);

        return {
            memory: {
                current: memoryValues[memoryValues.length - 1],
                min: Math.min(...memoryValues),
                max: Math.max(...memoryValues),
                avg: memoryValues.reduce((a, b) => a + b, 0) / memoryValues.length,
                trend: this.calculateTrend(memoryValues)
            },
            handles: {
                current: handleValues[handleValues.length - 1],
                min: Math.min(...handleValues),
                max: Math.max(...handleValues),
                avg: handleValues.reduce((a, b) => a + b, 0) / handleValues.length,
                trend: this.calculateTrend(handleValues)
            },
            requests: {
                current: requestValues[requestValues.length - 1],
                min: Math.min(...requestValues),
                max: Math.max(...requestValues),
                avg: requestValues.reduce((a, b) => a + b, 0) / requestValues.length,
                trend: this.calculateTrend(requestValues)
            },
            samples: this.history.length
        };
    }

    calculateTrend(values) {
        if (values.length < 2) return 'stable';

        const recentSamples = Math.min(values.length, 30); // Last 30 samples
        const recent = values.slice(-recentSamples);
        
        const first = recent[0];
        const last = recent[recent.length - 1];
        const change = last - first;
        const changePercent = first > 0 ? (change / first) * 100 : 0;

        if (changePercent > 5) return 'increasing';
        if (changePercent < -5) return 'decreasing';
        return 'stable';
    }

    displayDashboard() {
        if (!this.isRunning || this.history.length === 0) {
            console.log('Dashboard not running or no data available');
            return;
        }

        const state = this.getCurrentState();
        const current = state.current;
        const stats = state.stats;

        // Clear screen and move cursor to top
        process.stdout.write('\x1b[2J\x1b[H');

        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│              MEMORY MONITORING DASHBOARD                   │');
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log(`│ Status: ${this.isRunning ? 'RUNNING ✓' : 'STOPPED ✗'}                 Uptime: ${this.formatUptime(state.uptime)} │`);
        console.log(`│ Updates: ${state.updateCount.toString().padStart(6)}                 Alerts: ${state.alertCount.toString().padStart(3)} │`);
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log('│ MEMORY USAGE                                                │');
        console.log(`│   Current: ${current.memory.heapUsedMB.toFixed(2).padStart(8)} MB          Trend: ${stats.memory.trend.padEnd(10)} │`);
        console.log(`│   Average: ${stats.memory.avg.toFixed(2).padStart(8)} MB          Range: ${stats.memory.min.toFixed(1)}-${stats.memory.max.toFixed(1)} MB │`);
        console.log(`│   RSS:     ${(current.memory.rss / 1024 / 1024).toFixed(2).padStart(8)} MB          External: ${(current.memory.external / 1024 / 1024).toFixed(2)} MB │`);
        console.log('├─────────────────────────────────────────────────────────────┤');
        console.log('│ HANDLE USAGE                                                │');
        console.log(`│   Total:   ${current.handles.total.toString().padStart(8)}              Trend: ${stats.handles.trend.padEnd(10)} │`);
        console.log(`│   Timers:  ${current.handles.types.timers.toString().padStart(8)}              TCP: ${current.handles.types.tcp.toString().padStart(6)} │`);
        console.log(`│   Process: ${current.handles.types.process.toString().padStart(8)}              FS: ${current.handles.types.fs.toString().padStart(7)} │`);
        console.log('├─────────────────────────────────────────────────────────────┤');

        if (current.system) {
            console.log('│ SYSTEM HEALTH                                               │');
            console.log(`│   Status:     ${current.system.status.padEnd(12)}    Components: ${current.system.totalComponents.toString().padStart(3)} │`);
            console.log(`│   Healthy:    ${current.system.healthyComponents.toString().padStart(3)}                Connections: ${current.system.activeConnections.toString().padStart(3)} │`);
            console.log('├─────────────────────────────────────────────────────────────┤');
        }

        console.log('│ GROWTH RATES (per second)                                   │');
        console.log(`│   Memory:  ${current.rates.memoryGrowthMBPerSec.toFixed(3).padStart(8)} MB/s        Handles: ${current.rates.handleGrowthPerSec.toFixed(1).padStart(4)}/s │`);
        console.log(`│   Requests: ${current.rates.requestGrowthPerSec.toFixed(1).padStart(7)}/s                                │`);
        
        if (this.alerts.length > 0) {
            console.log('├─────────────────────────────────────────────────────────────┤');
            console.log('│ RECENT ALERTS                                               │');
            const recentAlerts = this.alerts.slice(-3);
            recentAlerts.forEach(alert => {
                const time = new Date(alert.timestamp).toLocaleTimeString();
                const severity = alert.severity === 'critical' ? '🔴' : '🟡';
                const message = alert.message.substring(0, 45);
                console.log(`│ ${severity} ${time} ${message.padEnd(45)} │`);
            });
        }
        
        console.log('└─────────────────────────────────────────────────────────────┘');
        console.log(`Last update: ${new Date().toLocaleTimeString()}                    Press Ctrl+C to stop`);
    }

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    generateFinalReport() {
        if (this.history.length === 0) {
            return { error: 'No monitoring data collected' };
        }

        const stats = this.calculateStats();
        const duration = Date.now() - this.startTime;
        const first = this.history[0];
        const last = this.history[this.history.length - 1];

        return {
            summary: {
                duration,
                samples: this.history.length,
                alerts: this.alerts.length,
                updateInterval: this.options.updateInterval
            },
            memory: {
                initial: first.memory.heapUsedMB,
                final: last.memory.heapUsedMB,
                growth: last.memory.heapUsedMB - first.memory.heapUsedMB,
                ...stats.memory
            },
            handles: {
                initial: first.handles.total,
                final: last.handles.total,
                growth: last.handles.total - first.handles.total,
                ...stats.handles
            },
            performance: {
                avgMemoryGrowthRate: this.calculateAverageGrowthRate('memory'),
                avgHandleGrowthRate: this.calculateAverageGrowthRate('handles'),
                memoryStability: stats.memory.trend === 'stable',
                handleStability: stats.handles.trend === 'stable'
            },
            alerts: {
                total: this.alerts.length,
                byType: this.groupAlertsByType(),
                bySeverity: this.groupAlertsBySeverity()
            },
            recommendations: this.generateRecommendations(stats)
        };
    }

    calculateAverageGrowthRate(metric) {
        if (this.history.length < 2) return 0;

        const values = metric === 'memory' 
            ? this.history.map(h => h.memory.heapUsedMB)
            : this.history.map(h => h.handles.total);

        const growthRates = [];
        for (let i = 1; i < this.history.length; i++) {
            const timeDelta = (this.history[i].timestamp - this.history[i-1].timestamp) / 1000;
            const valueDelta = values[i] - values[i-1];
            growthRates.push(valueDelta / timeDelta);
        }

        return growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
    }

    groupAlertsByType() {
        return this.alerts.reduce((acc, alert) => {
            acc[alert.type] = (acc[alert.type] || 0) + 1;
            return acc;
        }, {});
    }

    groupAlertsBySeverity() {
        return this.alerts.reduce((acc, alert) => {
            acc[alert.severity] = (acc[alert.severity] || 0) + 1;
            return acc;
        }, {});
    }

    generateRecommendations(stats) {
        const recommendations = [];

        if (stats.memory.trend === 'increasing') {
            recommendations.push('Memory usage is trending upward - investigate potential memory leaks');
        }

        if (stats.handles.trend === 'increasing') {
            recommendations.push('Handle count is trending upward - check for resource cleanup issues');
        }

        if (stats.memory.max > 500) {
            recommendations.push('Peak memory usage exceeded 500MB - consider memory optimization');
        }

        if (stats.handles.max > 100) {
            recommendations.push('Peak handle count exceeded 100 - review resource management');
        }

        const criticalAlerts = this.alerts.filter(a => a.severity === 'critical').length;
        if (criticalAlerts > 0) {
            recommendations.push(`${criticalAlerts} critical alerts detected - immediate attention required`);
        }

        if (recommendations.length === 0) {
            recommendations.push('System performance is stable - no immediate actions required');
        }

        return recommendations;
    }

    exportData(format = 'json') {
        const data = {
            metadata: {
                exportTime: new Date().toISOString(),
                monitoringDuration: Date.now() - this.startTime,
                samples: this.history.length,
                options: this.options
            },
            history: this.history,
            alerts: this.alerts,
            finalReport: this.generateFinalReport()
        };

        if (format === 'csv') {
            return this.convertToCSV(data);
        }

        return JSON.stringify(data, null, 2);
    }

    convertToCSV(data) {
        const headers = [
            'timestamp', 'uptime', 'memoryMB', 'handles', 'requests',
            'memoryGrowthRate', 'handleGrowthRate', 'systemStatus'
        ];

        const rows = data.history.map(sample => [
            new Date(sample.timestamp).toISOString(),
            sample.uptime,
            sample.memory.heapUsedMB.toFixed(2),
            sample.handles.total,
            sample.requests,
            sample.rates.memoryGrowthMBPerSec.toFixed(3),
            sample.rates.handleGrowthPerSec.toFixed(1),
            sample.system ? sample.system.status : 'unknown'
        ]);

        return [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    }
}

// Test utilities and main function
let dashboard = null;
let testResults = [];

/**
 * Test 1: Basic Dashboard Functionality
 */
async function testBasicDashboardFunctionality() {
    console.log('\n📋 Test 1: Basic Dashboard Functionality');
    
    let testPassed = false;
    
    try {
        // Create dashboard instance
        dashboard = new MonitoringDashboard({
            updateInterval: 500, // Faster for testing
            maxHistory: 10,
            alertThresholds: {
                memoryMB: 100,
                handles: 30
            }
        });
        
        let updateCount = 0;
        let alertCount = 0;
        
        // Set up event listeners
        dashboard.on('update', () => {
            updateCount++;
        });
        
        dashboard.on('alert', (alert) => {
            alertCount++;
            console.log(`    Alert: ${alert.message}`);
        });
        
        // Start monitoring
        dashboard.start();
        
        // Let it run for a few seconds
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Get current state
        const state = dashboard.getCurrentState();
        
        console.log(`  Dashboard running: ${dashboard.isRunning}`);
        console.log(`  Updates received: ${updateCount}`);
        console.log(`  Samples collected: ${state.stats.samples}`);
        console.log(`  Current memory: ${state.current.memory.heapUsedMB.toFixed(2)}MB`);
        console.log(`  Current handles: ${state.current.handles.total}`);
        
        // Stop monitoring
        dashboard.stop();
        
        // Validate functionality
        const basicFunctionalityWorks = (
            updateCount >= 5 && // Should have received multiple updates
            state.stats.samples >= 5 && // Should have collected samples
            state.current.memory.heapUsedMB > 0 && // Should have memory data
            state.current.handles.total > 0 && // Should have handle data
            !dashboard.isRunning // Should be stopped
        );
        
        testPassed = basicFunctionalityWorks;
        
        if (testPassed) {
            console.log('✓ Basic dashboard functionality working correctly');
        } else {
            console.log('✗ Issues detected in basic dashboard functionality');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Basic Dashboard Functionality',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 2: Alert System Validation
 */
async function testAlertSystemValidation() {
    console.log('\n📋 Test 2: Alert System Validation');
    
    let testPassed = false;
    
    try {
        // Create dashboard with low thresholds to trigger alerts
        const alertDashboard = new MonitoringDashboard({
            updateInterval: 200,
            maxHistory: 20,
            alertThresholds: {
                memoryMB: 1, // Very low threshold to trigger alerts
                handles: 5,  // Very low threshold
                memoryGrowthRate: 0.1,
                handleGrowthRate: 1
            }
        });
        
        const alerts = [];
        
        alertDashboard.on('alert', (alert) => {
            alerts.push(alert);
            console.log(`    ${alert.severity.toUpperCase()}: ${alert.type}`);
        });
        
        // Start monitoring
        alertDashboard.start();
        
        // Create some memory pressure to trigger alerts
        const largeDatas = [];
        for (let i = 0; i < 5; i++) {
            const largeData = new Array(100000).fill(`data-${i}`);
            largeDatas.push(largeData);
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Wait for alerts to be generated
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Stop monitoring
        alertDashboard.stop();
        
        // Analyze alerts
        const memoryAlerts = alerts.filter(a => a.type.includes('memory'));
        const handleAlerts = alerts.filter(a => a.type.includes('handle'));
        const criticalAlerts = alerts.filter(a => a.severity === 'critical');
        const warningAlerts = alerts.filter(a => a.severity === 'warning');
        
        console.log(`  Total alerts generated: ${alerts.length}`);
        console.log(`  Memory alerts: ${memoryAlerts.length}`);
        console.log(`  Handle alerts: ${handleAlerts.length}`);
        console.log(`  Critical alerts: ${criticalAlerts.length}`);
        console.log(`  Warning alerts: ${warningAlerts.length}`);
        
        // Validate alert system
        const alertSystemWorks = (
            alerts.length > 0 && // Should have generated alerts
            memoryAlerts.length > 0 && // Should have memory alerts
            alerts.every(a => a.timestamp && a.message && a.type && a.severity) // All alerts should have required fields
        );
        
        testPassed = alertSystemWorks;
        
        if (testPassed) {
            console.log('✓ Alert system validation successful');
        } else {
            console.log('✗ Issues detected in alert system');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Alert System Validation',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 3: Data Export and Reporting
 */
async function testDataExportReporting() {
    console.log('\n📋 Test 3: Data Export and Reporting');
    
    let testPassed = false;
    
    try {
        // Create dashboard for data collection
        const exportDashboard = new MonitoringDashboard({
            updateInterval: 200,
            maxHistory: 15
        });
        
        // Start monitoring
        exportDashboard.start();
        
        // Let it collect data
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Generate final report
        const finalReport = exportDashboard.generateFinalReport();
        
        console.log('  Final Report Validation:');
        console.log(`    Duration: ${(finalReport.summary.duration/1000).toFixed(1)}s`);
        console.log(`    Samples: ${finalReport.summary.samples}`);
        console.log(`    Memory growth: ${finalReport.memory.growth.toFixed(2)}MB`);
        console.log(`    Handle growth: ${finalReport.handles.growth}`);
        console.log(`    Memory stability: ${finalReport.performance.memoryStability ? 'STABLE' : 'UNSTABLE'}`);
        console.log(`    Recommendations: ${finalReport.recommendations.length}`);
        
        // Test data export
        const jsonExport = exportDashboard.exportData('json');
        const csvExport = exportDashboard.exportData('csv');
        
        console.log('  Export Validation:');
        console.log(`    JSON export size: ${jsonExport.length} characters`);
        console.log(`    CSV export lines: ${csvExport.split('\n').length}`);
        
        // Stop monitoring
        exportDashboard.stop();
        
        // Validate reporting
        const reportingWorks = (
            finalReport.summary && finalReport.memory && finalReport.handles && // Required sections
            finalReport.performance && finalReport.alerts && finalReport.recommendations && // All sections present
            finalReport.summary.samples > 0 && // Has data
            jsonExport.length > 100 && // JSON export has content
            csvExport.includes('timestamp,uptime,memoryMB') && // CSV has headers
            finalReport.recommendations.length > 0 // Has recommendations
        );
        
        testPassed = reportingWorks;
        
        if (testPassed) {
            console.log('✓ Data export and reporting working correctly');
        } else {
            console.log('✗ Issues detected in data export and reporting');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Data Export and Reporting',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 4: Performance Under Load
 */
async function testPerformanceUnderLoad() {
    console.log('\n📋 Test 4: Performance Under Load');
    
    let testPassed = false;
    
    try {
        // Create dashboard with fast updates
        const loadDashboard = new MonitoringDashboard({
            updateInterval: 100, // Very fast updates
            maxHistory: 50
        });
        
        let updateCount = 0;
        let maxUpdateTime = 0;
        const updateTimes = [];
        
        loadDashboard.on('update', () => {
            updateCount++;
        });
        
        // Start monitoring
        const startTime = Date.now();
        loadDashboard.start();
        
        // Create artificial load while monitoring
        const loadTasks = [];
        for (let i = 0; i < 10; i++) {
            loadTasks.push(
                new Promise(resolve => {
                    const data = [];
                    const interval = setInterval(() => {
                        data.push(new Array(1000).fill(Math.random()));
                        if (data.length > 100) {
                            data.splice(0, 50); // Keep memory manageable
                        }
                    }, 50);
                    
                    setTimeout(() => {
                        clearInterval(interval);
                        resolve();
                    }, 3000);
                })
            );
        }
        
        // Wait for load tasks to complete
        await Promise.all(loadTasks);
        
        const endTime = Date.now();
        const totalTime = endTime - startTime;
        
        // Stop monitoring
        loadDashboard.stop();
        
        const state = loadDashboard.getCurrentState();
        
        console.log('  Performance Under Load Results:');
        console.log(`    Total runtime: ${(totalTime/1000).toFixed(1)}s`);
        console.log(`    Updates processed: ${updateCount}`);
        console.log(`    Samples collected: ${state.stats.samples}`);
        console.log(`    Average update rate: ${(updateCount/(totalTime/1000)).toFixed(1)} updates/sec`);
        console.log(`    Memory trend: ${state.stats.memory.trend}`);
        console.log(`    Handle trend: ${state.stats.handles.trend}`);
        
        // Validate performance
        const performanceGood = (
            updateCount >= 25 && // Should have processed many updates
            state.stats.samples >= 25 && // Should have collected samples
            updateCount/(totalTime/1000) >= 8 && // Should maintain reasonable update rate
            loadDashboard.alerts.length < 20 // Shouldn't have excessive alerts
        );
        
        testPassed = performanceGood;
        
        if (testPassed) {
            console.log('✓ Dashboard maintains good performance under load');
        } else {
            console.log('✗ Performance issues detected under load');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Performance Under Load',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 5: Interactive Dashboard Display
 */
async function testInteractiveDashboardDisplay() {
    console.log('\n📋 Test 5: Interactive Dashboard Display');
    
    let testPassed = false;
    
    try {
        console.log('  Testing dashboard display output...');
        
        // Create dashboard for display testing
        const displayDashboard = new MonitoringDashboard({
            updateInterval: 1000,
            maxHistory: 10
        });
        
        // Start monitoring
        displayDashboard.start();
        
        // Let it collect some data
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Test display method (capture output)
        console.log('  Sample dashboard display:');
        console.log('  ┌─── Dashboard Display Test ───┐');
        
        // Display dashboard once
        displayDashboard.displayDashboard();
        
        console.log('  └──────────────────────────────┘');
        
        // Stop monitoring
        displayDashboard.stop();
        
        // Validate that display method works without errors
        const state = displayDashboard.getCurrentState();
        const hasData = state && state.stats.samples > 0;
        
        testPassed = hasData; // If we get here without errors and have data, display is working
        
        if (testPassed) {
            console.log('✓ Interactive dashboard display working correctly');
        } else {
            console.log('✗ Issues detected in dashboard display');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Interactive Dashboard Display',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Continuous monitoring mode (for manual testing)
 */
async function runContinuousMonitoring(duration = 30000) {
    console.log(`\n🔄 Running continuous monitoring for ${duration/1000} seconds...`);
    console.log('Press Ctrl+C to stop early\n');
    
    const continuousDashboard = new MonitoringDashboard({
        updateInterval: 1000,
        maxHistory: 60,
        alertThresholds: {
            memoryMB: 150,
            handles: 40,
            memoryGrowthRate: 5,
            handleGrowthRate: 3
        }
    });
    
    // Setup display update
    let displayInterval;
    
    continuousDashboard.on('started', () => {
        displayInterval = setInterval(() => {
            continuousDashboard.displayDashboard();
        }, 2000); // Update display every 2 seconds
    });
    
    continuousDashboard.on('stopped', (finalReport) => {
        if (displayInterval) {
            clearInterval(displayInterval);
        }
        
        console.log('\n📊 CONTINUOUS MONITORING FINAL REPORT');
        console.log('='.repeat(50));
        console.log(`Duration: ${(finalReport.summary.duration/1000).toFixed(1)}s`);
        console.log(`Samples: ${finalReport.summary.samples}`);
        console.log(`Memory: ${finalReport.memory.initial.toFixed(2)}MB → ${finalReport.memory.final.toFixed(2)}MB (${finalReport.memory.growth >= 0 ? '+' : ''}${finalReport.memory.growth.toFixed(2)}MB)`);
        console.log(`Handles: ${finalReport.handles.initial} → ${finalReport.handles.final} (${finalReport.handles.growth >= 0 ? '+' : ''}${finalReport.handles.growth})`);
        console.log(`Alerts: ${finalReport.alerts.total}`);
        console.log(`Memory Stable: ${finalReport.performance.memoryStability ? 'YES' : 'NO'}`);
        console.log(`Handle Stable: ${finalReport.performance.handleStability ? 'YES' : 'NO'}`);
        
        console.log('\nRecommendations:');
        finalReport.recommendations.forEach(rec => {
            console.log(`  • ${rec}`);
        });
    });
    
    continuousDashboard.on('alert', (alert) => {
        // Alerts are shown in the dashboard display
    });
    
    // Handle Ctrl+C
    const originalHandler = process.listeners('SIGINT').slice();
    process.removeAllListeners('SIGINT');
    process.on('SIGINT', () => {
        console.log('\n\nStopping continuous monitoring...');
        continuousDashboard.stop();
        
        // Restore original handlers
        process.removeAllListeners('SIGINT');
        originalHandler.forEach(handler => process.on('SIGINT', handler));
    });
    
    // Start monitoring
    continuousDashboard.start();
    
    // Stop after duration
    setTimeout(() => {
        if (continuousDashboard.isRunning) {
            continuousDashboard.stop();
        }
    }, duration);
    
    // Wait for completion
    return new Promise(resolve => {
        continuousDashboard.on('stopped', resolve);
    });
}

/**
 * Main test runner
 */
async function runMonitoringDashboardTests() {
    console.log('🚀 Starting Memory Monitoring Dashboard Tests\n');
    console.log('Target: Validate dashboard monitoring and visualization capabilities');
    
    const startTime = Date.now();
    
    try {
        // Run all dashboard tests
        const testFunctions = [
            testBasicDashboardFunctionality,
            testAlertSystemValidation,
            testDataExportReporting,
            testPerformanceUnderLoad,
            testInteractiveDashboardDisplay
        ];
        
        let passedTests = 0;
        
        for (const testFn of testFunctions) {
            try {
                const result = await testFn();
                if (result) {
                    passedTests++;
                }
                
                // Cleanup delay between tests
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`Test function ${testFn.name} failed:`, error.message);
            }
        }
        
        const duration = Date.now() - startTime;
        
        console.log('\n📊 MONITORING DASHBOARD TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total tests: ${testFunctions.length}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${testFunctions.length - passedTests}`);
        console.log(`Duration: ${(duration/1000).toFixed(1)}s`);
        
        console.log('\n📋 DETAILED TEST RESULTS');
        testResults.forEach(result => {
            const status = result.passed ? '✓' : '✗';
            console.log(`  ${status} ${result.name}`);
        });
        
        // Final assessment
        const allTestsPassed = passedTests === testFunctions.length;
        
        if (allTestsPassed) {
            console.log('\n🎉 ALL MONITORING DASHBOARD TESTS PASSED!');
            console.log('✓ Dashboard functionality is working correctly');
            console.log('✓ Alert system is operational');
            console.log('✓ Data export and reporting functional');
            console.log('✓ Performance remains good under load');
            console.log('✓ Interactive display is working');
            console.log('\n💡 Dashboard is ready for continuous monitoring');
            return true;
        } else {
            console.log('\n❌ MONITORING DASHBOARD ISSUES DETECTED');
            console.log(`❌ ${testFunctions.length - passedTests} test(s) failed`);
            console.log('⚠️  Dashboard may need fixes before production use');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Test execution failed:', error.message);
        return false;
    }
}

// Export utilities
export { MonitoringDashboard, runContinuousMonitoring };
export default runMonitoringDashboardTests;

// If run directly, execute tests or continuous monitoring
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2);
    
    if (args.includes('--continuous') || args.includes('-c')) {
        const duration = args.includes('--duration') ? 
            parseInt(args[args.indexOf('--duration') + 1]) * 1000 : 
            30000;
        
        runContinuousMonitoring(duration).then(() => {
            console.log('Continuous monitoring completed');
            process.exit(0);
        }).catch(error => {
            console.error('❌ Continuous monitoring failed:', error);
            process.exit(1);
        });
    } else {
        runMonitoringDashboardTests().then(success => {
            process.exit(success ? 0 : 1);
        }).catch(error => {
            console.error('❌ Unhandled error:', error);
            process.exit(1);
        });
    }
}