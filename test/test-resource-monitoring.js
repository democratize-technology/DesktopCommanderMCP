#!/usr/bin/env node

/**
 * ResourceManager Monitoring Tests
 * 
 * Comprehensive testing of ResourceManager health monitoring, diagnostics,
 * and resource coordination capabilities. Validates that the ResourceManager
 * provides accurate system health information and effective resource management.
 * 
 * Key test areas:
 * - Health check accuracy and reliability
 * - Diagnostic information completeness
 * - Resource usage tracking
 * - Component registration and coordination
 * - Event monitoring and alerting
 * - Configuration management
 */

import { EventEmitter } from 'events';
import { resourceManager } from '../dist/resource-manager.js';
import { configManager } from '../dist/config-manager.js';

// Mock component for testing ResourceManager integration
class MockResourceComponent extends EventEmitter {
    constructor(id, type = 'mock', options = {}) {
        super();
        this.id = id;
        this.type = type;
        this.isHealthy = options.isHealthy !== false;
        this.usage = options.usage || {};
        this.issues = options.issues || [];
        this.createdAt = new Date();
        this.lastActivity = new Date();
        this.cleanupCalled = false;
        this.forceCleanupCalled = false;
        
        // Simulate resource usage
        this.memoryUsage = options.memoryUsage || Math.floor(Math.random() * 50 + 10); // 10-60MB
        this.connections = options.connections || Math.floor(Math.random() * 5);
        this.pendingOps = options.pendingOps || Math.floor(Math.random() * 3);
    }

    getResourceInfo() {
        return {
            id: this.id,
            type: this.type,
            description: `Mock ${this.type} component ${this.id}`,
            usage: {
                memoryMB: this.memoryUsage,
                activeConnections: this.connections,
                pendingOperations: this.pendingOps,
                customMetrics: {
                    testMetric: Math.random() * 100
                }
            },
            isHealthy: this.isHealthy,
            createdAt: this.createdAt,
            lastActivity: this.lastActivity
        };
    }

    async performHealthCheck() {
        // Update last activity
        this.lastActivity = new Date();
        
        return {
            isHealthy: this.isHealthy,
            issues: [...this.issues],
            lastChecked: new Date(),
            metrics: {
                responseTime: Math.random() * 100,
                errorRate: this.isHealthy ? 0 : Math.random() * 0.1
            }
        };
    }

    async cleanup() {
        this.cleanupCalled = true;
        // Simulate cleanup time
        await new Promise(resolve => setTimeout(resolve, 100));
        this.emit('cleanup-completed');
    }

    async forceCleanup() {
        this.forceCleanupCalled = true;
        // Force cleanup is faster
        await new Promise(resolve => setTimeout(resolve, 50));
        this.emit('force-cleanup-completed');
    }

    // Test utilities
    setHealth(isHealthy, issues = []) {
        this.isHealthy = isHealthy;
        this.issues = issues;
    }

    updateUsage(usage) {
        Object.assign(this.usage, usage);
        if (usage.memoryMB) this.memoryUsage = usage.memoryMB;
        if (usage.activeConnections) this.connections = usage.activeConnections;
        if (usage.pendingOperations) this.pendingOps = usage.pendingOperations;
    }
}

// Test utilities
let testComponents = [];
let testResults = [];
let originalConfig;
let eventLog = [];

// Event logging utility
function logEvent(event, data) {
    eventLog.push({
        timestamp: Date.now(),
        event,
        data
    });
}

/**
 * Setup function
 */
async function setup() {
    console.log('🔧 Setting up ResourceManager Monitoring Tests...');
    
    // Clear event log
    eventLog = [];
    
    // Save original config
    originalConfig = await configManager.getConfig();
    
    // Setup event listeners for ResourceManager
    resourceManager.on('component-registered', (data) => logEvent('component-registered', data));
    resourceManager.on('component-unregistered', (data) => logEvent('component-unregistered', data));
    resourceManager.on('health-critical', (data) => logEvent('health-critical', data));
    resourceManager.on('health-warning', (data) => logEvent('health-warning', data));
    resourceManager.on('cleanup-timeout', (data) => logEvent('cleanup-timeout', data));
    resourceManager.on('shutdown-started', (data) => logEvent('shutdown-started', data));
    resourceManager.on('shutdown-completed', (data) => logEvent('shutdown-completed', data));
    
    console.log('✓ Event listeners configured');
    console.log('✓ Test environment prepared');
    return true;
}

/**
 * Teardown function
 */
async function teardown() {
    console.log('🧹 Cleaning up ResourceManager Monitoring Tests...');
    
    // Unregister all test components
    testComponents.forEach(component => {
        try {
            resourceManager.unregister(component.id, 'test_cleanup');
        } catch (error) {
            // Ignore cleanup errors
        }
    });
    
    testComponents = [];
    
    // Remove event listeners
    resourceManager.removeAllListeners();
    
    // Restore original config
    if (originalConfig) {
        await configManager.updateConfig(originalConfig);
    }
    
    console.log('✓ Test components unregistered');
    console.log('✓ Event listeners removed');
    console.log('✓ Configuration restored');
}

/**
 * Test 1: Component Registration and Management
 */
async function testComponentRegistrationManagement() {
    console.log('\n📋 Test 1: Component Registration and Management');
    
    let testPassed = false;
    
    try {
        const initialHealth = await resourceManager.getSystemHealth();
        const initialComponentCount = initialHealth.totalComponents;
        
        // Create and register test components
        const components = [
            new MockResourceComponent('test-comp-1', 'terminal', { isHealthy: true }),
            new MockResourceComponent('test-comp-2', 'process', { isHealthy: true }),
            new MockResourceComponent('test-comp-3', 'config', { isHealthy: false, issues: ['Test issue'] })
        ];
        
        console.log('  Registering test components...');
        
        // Register components with different priorities
        resourceManager.register('test-comp-1', components[0], 1, { isCritical: true });
        resourceManager.register('test-comp-2', components[1], 2, { isCritical: false });
        resourceManager.register('test-comp-3', components[2], 3, { isCritical: false });
        
        testComponents = components;
        
        // Verify registration events
        const registrationEvents = eventLog.filter(e => e.event === 'component-registered');
        console.log(`  Registration events: ${registrationEvents.length}`);
        
        // Get updated system health
        const updatedHealth = await resourceManager.getSystemHealth();
        
        console.log(`  Components before: ${initialComponentCount}`);
        console.log(`  Components after: ${updatedHealth.totalComponents}`);
        console.log(`  Healthy components: ${updatedHealth.healthyComponents}`);
        console.log(`  Unhealthy components: ${updatedHealth.unhealthyComponents}`);
        
        // Verify component counts
        const expectedTotal = initialComponentCount + 3;
        const componentsAdded = updatedHealth.totalComponents === expectedTotal;
        const healthCounts = updatedHealth.healthyComponents >= 2 && updatedHealth.unhealthyComponents >= 1;
        const registrationEventsCorrect = registrationEvents.length === 3;
        
        console.log('  Registration validation:');
        console.log(`    Components added: ${componentsAdded ? '✓' : '✗'}`);
        console.log(`    Health counts correct: ${healthCounts ? '✓' : '✗'}`);
        console.log(`    Registration events: ${registrationEventsCorrect ? '✓' : '✗'}`);
        
        // Test component replacement
        console.log('  Testing component replacement...');
        const replacementComponent = new MockResourceComponent('test-comp-1', 'terminal', { isHealthy: true });
        resourceManager.register('test-comp-1', replacementComponent, 1, { isCritical: true });
        
        // Should still have same number of components
        const afterReplacement = await resourceManager.getSystemHealth();
        const replacementWorked = afterReplacement.totalComponents === expectedTotal;
        
        console.log(`    Replacement maintained count: ${replacementWorked ? '✓' : '✗'}`);
        
        // Test unregistration
        console.log('  Testing component unregistration...');
        resourceManager.unregister('test-comp-3', 'test_removal');
        
        const afterUnregister = await resourceManager.getSystemHealth();
        const unregistrationWorked = afterUnregister.totalComponents === (expectedTotal - 1);
        
        console.log(`    Unregistration worked: ${unregistrationWorked ? '✓' : '✗'}`);
        
        // Check unregistration events
        const unregistrationEvents = eventLog.filter(e => e.event === 'component-unregistered');
        const unregEventCorrect = unregistrationEvents.length >= 1;
        
        console.log(`    Unregistration events: ${unregEventCorrect ? '✓' : '✗'}`);
        
        testPassed = (
            componentsAdded &&
            healthCounts &&
            registrationEventsCorrect &&
            replacementWorked &&
            unregistrationWorked &&
            unregEventCorrect
        );
        
        if (testPassed) {
            console.log('✓ Component registration and management working correctly');
        } else {
            console.log('✗ Issues detected in component registration and management');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Component Registration and Management',
        passed: testPassed,
        eventCount: eventLog.length
    });
    
    return testPassed;
}

/**
 * Test 2: Health Check Accuracy and Reliability
 */
async function testHealthCheckAccuracy() {
    console.log('\n📋 Test 2: Health Check Accuracy and Reliability');
    
    let testPassed = false;
    
    try {
        // Create components with different health states
        const healthyComponent = new MockResourceComponent('health-test-1', 'healthy', { 
            isHealthy: true,
            memoryUsage: 25,
            connections: 2
        });
        
        const unhealthyComponent = new MockResourceComponent('health-test-2', 'unhealthy', { 
            isHealthy: false,
            issues: ['Connection timeout', 'High memory usage'],
            memoryUsage: 150,
            connections: 10
        });
        
        const criticalComponent = new MockResourceComponent('health-test-3', 'critical', { 
            isHealthy: false,
            issues: ['Service unavailable'],
            memoryUsage: 200
        });
        
        console.log('  Registering components with different health states...');
        
        // Register components
        resourceManager.register('health-test-1', healthyComponent, 1, { isCritical: false });
        resourceManager.register('health-test-2', unhealthyComponent, 2, { isCritical: false });
        resourceManager.register('health-test-3', criticalComponent, 3, { isCritical: true });
        
        testComponents.push(healthyComponent, unhealthyComponent, criticalComponent);
        
        // Get initial health state
        let systemHealth = await resourceManager.getSystemHealth();
        
        console.log(`  System status: ${systemHealth.status}`);
        console.log(`  Critical issues: ${systemHealth.criticalIssues.length}`);
        console.log(`  Warnings: ${systemHealth.warnings.length}`);
        console.log(`  System memory usage: ${systemHealth.systemUsage.memoryMB}MB`);
        
        // Verify critical issues are detected
        const hasCriticalIssues = systemHealth.criticalIssues.length > 0;
        const hasWarnings = systemHealth.warnings.length > 0;
        const statusReflectsIssues = systemHealth.status === 'critical' || systemHealth.status === 'failing';
        
        console.log('  Health detection validation:');
        console.log(`    Critical issues detected: ${hasCriticalIssues ? '✓' : '✗'}`);
        console.log(`    Warnings detected: ${hasWarnings ? '✓' : '✗'}`);
        console.log(`    Status reflects issues: ${statusReflectsIssues ? '✓' : '✗'}`);
        
        // Test health state changes
        console.log('  Testing health state changes...');
        
        // Fix the critical component
        criticalComponent.setHealth(true, []);
        unhealthyComponent.setHealth(true, []);
        
        // Wait a moment for health check
        await new Promise(resolve => setTimeout(resolve, 100));
        
        systemHealth = await resourceManager.getSystemHealth();
        
        const healthImproved = (
            systemHealth.criticalIssues.length === 0 &&
            (systemHealth.status === 'healthy' || systemHealth.status === 'degraded')
        );
        
        console.log(`    Health improvement detected: ${healthImproved ? '✓' : '✗'}`);
        
        // Test system usage aggregation
        const expectedMemory = 25 + 150 + 200; // Before health changes
        const memoryReasonable = systemHealth.systemUsage.memoryMB > 0;
        const connectionsTracked = systemHealth.systemUsage.activeConnections >= 0;
        
        console.log('  Usage tracking validation:');
        console.log(`    Memory usage tracked: ${memoryReasonable ? '✓' : '✗'}`);
        console.log(`    Connections tracked: ${connectionsTracked ? '✓' : '✗'}`);
        
        // Test health check reliability (multiple calls)
        console.log('  Testing health check reliability...');
        const healthChecks = [];
        for (let i = 0; i < 5; i++) {
            healthChecks.push(await resourceManager.getSystemHealth());
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        const consistentResults = healthChecks.every(health => 
            health.totalComponents === healthChecks[0].totalComponents &&
            health.status === healthChecks[0].status
        );
        
        console.log(`    Consistent results: ${consistentResults ? '✓' : '✗'}`);
        
        testPassed = (
            hasCriticalIssues &&
            statusReflectsIssues &&
            healthImproved &&
            memoryReasonable &&
            connectionsTracked &&
            consistentResults
        );
        
        if (testPassed) {
            console.log('✓ Health check accuracy and reliability validated');
        } else {
            console.log('✗ Issues detected in health check accuracy');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Health Check Accuracy and Reliability',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 3: Diagnostic Information Completeness
 */
async function testDiagnosticCompleteness() {
    console.log('\n📋 Test 3: Diagnostic Information Completeness');
    
    let testPassed = false;
    
    try {
        console.log('  Gathering comprehensive diagnostics...');
        
        const diagnostics = await resourceManager.getDiagnostics();
        
        // Validate diagnostic structure
        const hasSystemHealth = diagnostics.system && typeof diagnostics.system === 'object';
        const hasComponents = Array.isArray(diagnostics.components);
        const hasRecentEvents = Array.isArray(diagnostics.recentEvents);
        
        console.log('  Diagnostic structure validation:');
        console.log(`    System health included: ${hasSystemHealth ? '✓' : '✗'}`);
        console.log(`    Components included: ${hasComponents ? '✓' : '✗'}`);
        console.log(`    Recent events included: ${hasRecentEvents ? '✓' : '✗'}`);
        
        // Validate system health details
        const systemHealth = diagnostics.system;
        const hasValidStatus = ['healthy', 'degraded', 'failing', 'critical'].includes(systemHealth.status);
        const hasComponentCounts = (
            typeof systemHealth.totalComponents === 'number' &&
            typeof systemHealth.healthyComponents === 'number' &&
            typeof systemHealth.unhealthyComponents === 'number'
        );
        const hasUsageData = systemHealth.systemUsage && typeof systemHealth.systemUsage === 'object';
        const hasTimestamps = systemHealth.lastChecked instanceof Date && systemHealth.uptimeMs > 0;
        
        console.log('  System health details:');
        console.log(`    Valid status: ${hasValidStatus ? '✓' : '✗'} (${systemHealth.status})`);
        console.log(`    Component counts: ${hasComponentCounts ? '✓' : '✗'}`);
        console.log(`    Usage data: ${hasUsageData ? '✓' : '✗'}`);
        console.log(`    Timestamps: ${hasTimestamps ? '✓' : '✗'}`);
        
        // Validate component details
        const componentDetails = diagnostics.components;
        const hasComponentDetails = componentDetails.length > 0;
        
        if (hasComponentDetails) {
            const firstComponent = componentDetails[0];
            const hasComponentStructure = (
                firstComponent.id &&
                firstComponent.info &&
                firstComponent.health &&
                firstComponent.registration
            );
            
            const hasResourceInfo = (
                firstComponent.info.type &&
                firstComponent.info.description &&
                firstComponent.info.usage &&
                firstComponent.info.createdAt &&
                firstComponent.info.lastActivity
            );
            
            const hasHealthInfo = (
                typeof firstComponent.health.isHealthy === 'boolean' &&
                Array.isArray(firstComponent.health.issues) &&
                firstComponent.health.lastChecked instanceof Date
            );
            
            const hasRegistrationInfo = (
                typeof firstComponent.registration.priority === 'number' &&
                typeof firstComponent.registration.cleanupTimeoutMs === 'number' &&
                typeof firstComponent.registration.isCritical === 'boolean'
            );
            
            console.log('  Component details:');
            console.log(`    Component structure: ${hasComponentStructure ? '✓' : '✗'}`);
            console.log(`    Resource info complete: ${hasResourceInfo ? '✓' : '✗'}`);
            console.log(`    Health info complete: ${hasHealthInfo ? '✓' : '✗'}`);
            console.log(`    Registration info complete: ${hasRegistrationInfo ? '✓' : '✗'}`);
        }
        
        // Validate recent events
        const recentEvents = diagnostics.recentEvents;
        const hasEventStructure = recentEvents.length > 0 && recentEvents.every(event =>
            event.timestamp &&
            event.level &&
            event.message &&
            ['info', 'warning', 'error'].includes(event.level)
        );
        
        console.log('  Event history:');
        console.log(`    Event structure valid: ${hasEventStructure ? '✓' : '✗'}`);
        console.log(`    Total events: ${recentEvents.length}`);
        
        // Event level distribution
        const eventLevels = recentEvents.reduce((acc, event) => {
            acc[event.level] = (acc[event.level] || 0) + 1;
            return acc;
        }, {});
        
        console.log(`    Info: ${eventLevels.info || 0}, Warning: ${eventLevels.warning || 0}, Error: ${eventLevels.error || 0}`);
        
        // Test configuration access
        console.log('  Testing configuration access...');
        const config = resourceManager.getConfig();
        const hasValidConfig = (
            typeof config.enabled === 'boolean' &&
            typeof config.healthCheckIntervalMs === 'number' &&
            typeof config.memoryWarningThresholdMB === 'number'
        );
        
        console.log(`    Configuration accessible: ${hasValidConfig ? '✓' : '✗'}`);
        
        testPassed = (
            hasSystemHealth &&
            hasComponents &&
            hasRecentEvents &&
            hasValidStatus &&
            hasComponentCounts &&
            hasUsageData &&
            hasTimestamps &&
            hasEventStructure &&
            hasValidConfig
        );
        
        if (testPassed) {
            console.log('✓ Diagnostic information is comprehensive and complete');
        } else {
            console.log('✗ Issues detected in diagnostic information completeness');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Diagnostic Information Completeness',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Test 4: Event Monitoring and Alerting
 */
async function testEventMonitoringAlerting() {
    console.log('\n📋 Test 4: Event Monitoring and Alerting');
    
    let testPassed = false;
    
    try {
        // Clear previous events
        eventLog = [];
        
        // Create components that will trigger different events
        const problematicComponent = new MockResourceComponent('event-test-1', 'problematic', {
            isHealthy: false,
            issues: ['Critical failure detected'],
            memoryUsage: 500 // High memory usage
        });
        
        console.log('  Registering problematic component to trigger events...');
        
        // Register problematic component as critical
        resourceManager.register('event-test-1', problematicComponent, 1, { 
            isCritical: true,
            cleanupTimeoutMs: 100
        });
        
        testComponents.push(problematicComponent);
        
        // Wait for health check to detect issues
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Trigger health check
        await resourceManager.getSystemHealth();
        
        // Check for critical health events
        const criticalEvents = eventLog.filter(e => e.event === 'health-critical');
        const warningEvents = eventLog.filter(e => e.event === 'health-warning');
        
        console.log(`  Critical events: ${criticalEvents.length}`);
        console.log(`  Warning events: ${warningEvents.length}`);
        
        const criticalEventsTriggered = criticalEvents.length > 0;
        
        console.log('  Event triggering validation:');
        console.log(`    Critical events triggered: ${criticalEventsTriggered ? '✓' : '✗'}`);
        
        // Test configuration change events
        console.log('  Testing configuration change monitoring...');
        
        const initialEventCount = eventLog.length;
        
        // Update ResourceManager configuration
        resourceManager.updateConfig({
            healthCheckIntervalMs: 30000,
            memoryWarningThresholdMB: 150
        });
        
        await new Promise(resolve => setTimeout(resolve, 200));
        
        const configEventsTriggered = eventLog.length > initialEventCount;
        
        console.log(`    Configuration events triggered: ${configEventsTriggered ? '✓' : '✗'}`);
        
        // Test component lifecycle events
        console.log('  Testing component lifecycle events...');
        
        const lifecycleEventsBefore = eventLog.filter(e => 
            e.event === 'component-registered' || e.event === 'component-unregistered'
        ).length;
        
        // Add and remove a component
        const tempComponent = new MockResourceComponent('temp-comp', 'temporary');
        resourceManager.register('temp-comp', tempComponent, 5);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        resourceManager.unregister('temp-comp', 'test_lifecycle');
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const lifecycleEventsAfter = eventLog.filter(e => 
            e.event === 'component-registered' || e.event === 'component-unregistered'
        ).length;
        
        const lifecycleEventsCorrect = lifecycleEventsAfter >= lifecycleEventsBefore + 2;
        
        console.log(`    Lifecycle events correct: ${lifecycleEventsCorrect ? '✓' : '✗'}`);
        
        // Test event data completeness
        console.log('  Validating event data completeness...');
        
        const eventsWithData = eventLog.filter(e => e.data && typeof e.data === 'object');
        const eventDataComplete = eventsWithData.length > 0;
        
        console.log(`    Events with data: ${eventsWithData.length}/${eventLog.length}`);
        console.log(`    Event data completeness: ${eventDataComplete ? '✓' : '✗'}`);
        
        // Test event timestamps
        const eventsWithTimestamps = eventLog.filter(e => 
            e.timestamp && typeof e.timestamp === 'number'
        );
        const timestampsCorrect = eventsWithTimestamps.length === eventLog.length;
        
        console.log(`    Event timestamps correct: ${timestampsCorrect ? '✓' : '✗'}`);
        
        // Event ordering validation
        const eventsInOrder = eventLog.every((event, index) => {
            if (index === 0) return true;
            return event.timestamp >= eventLog[index - 1].timestamp;
        });
        
        console.log(`    Events in chronological order: ${eventsInOrder ? '✓' : '✗'}`);
        
        testPassed = (
            criticalEventsTriggered &&
            configEventsTriggered &&
            lifecycleEventsCorrect &&
            eventDataComplete &&
            timestampsCorrect &&
            eventsInOrder
        );
        
        if (testPassed) {
            console.log('✓ Event monitoring and alerting working correctly');
        } else {
            console.log('✗ Issues detected in event monitoring and alerting');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Event Monitoring and Alerting',
        passed: testPassed,
        totalEvents: eventLog.length
    });
    
    return testPassed;
}

/**
 * Test 5: Resource Coordination During Shutdown
 */
async function testResourceCoordinationShutdown() {
    console.log('\n📋 Test 5: Resource Coordination During Shutdown');
    
    let testPassed = false;
    
    try {
        // Create components with different priorities for shutdown testing
        const highPriorityComponent = new MockResourceComponent('shutdown-test-1', 'high-priority');
        const mediumPriorityComponent = new MockResourceComponent('shutdown-test-2', 'medium-priority');
        const lowPriorityComponent = new MockResourceComponent('shutdown-test-3', 'low-priority');
        
        console.log('  Registering components with different shutdown priorities...');
        
        // Register with different priorities (lower number = higher priority)
        resourceManager.register('shutdown-test-1', highPriorityComponent, 1, { isCritical: true });
        resourceManager.register('shutdown-test-2', mediumPriorityComponent, 5, { isCritical: false });
        resourceManager.register('shutdown-test-3', lowPriorityComponent, 10, { isCritical: false });
        
        testComponents.push(highPriorityComponent, mediumPriorityComponent, lowPriorityComponent);
        
        // Clear shutdown-related events
        eventLog = eventLog.filter(e => !e.event.includes('shutdown') && !e.event.includes('cleanup'));
        
        console.log('  Testing graceful shutdown coordination...');
        
        // Note: We can't actually test shutdown as it would shut down the ResourceManager
        // Instead, we test the shutdown preparation and coordination logic
        
        // Check if shutdown is properly rejected when already in progress
        const isShuttingDown = resourceManager.shuttingDown;
        console.log(`    Initial shutdown state: ${isShuttingDown ? 'shutting down' : 'active'}`);
        
        // Verify component registration during shutdown would be rejected
        if (!isShuttingDown) {
            try {
                const testComponent = new MockResourceComponent('should-fail', 'test');
                resourceManager.register('should-fail', testComponent, 1);
                
                // If we reach here, registration succeeded (which is expected when not shutting down)
                resourceManager.unregister('should-fail', 'cleanup');
                console.log('    Registration during normal operation: ✓');
            } catch (error) {
                console.log('    Registration during normal operation: ✗');
            }
        }
        
        // Test component cleanup capabilities
        console.log('  Testing individual component cleanup...');
        
        const cleanupTestComponent = new MockResourceComponent('cleanup-test', 'cleanup');
        resourceManager.register('cleanup-test', cleanupTestComponent, 1);
        
        // Unregister to trigger cleanup
        resourceManager.unregister('cleanup-test', 'test_cleanup');
        
        // Wait for cleanup
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Test resource manager state consistency
        console.log('  Testing ResourceManager state consistency...');
        
        const registeredComponents = resourceManager.getRegisteredComponents();
        const systemHealth = await resourceManager.getSystemHealth();
        
        const componentCountConsistent = registeredComponents.length === systemHealth.totalComponents;
        console.log(`    Component count consistency: ${componentCountConsistent ? '✓' : '✗'}`);
        
        // Test configuration management during operation
        console.log('  Testing configuration management...');
        
        const originalConfig = resourceManager.getConfig();
        const testConfig = {
            healthCheckIntervalMs: 45000,
            memoryWarningThresholdMB: 125,
            enableDetailedLogging: true
        };
        
        resourceManager.updateConfig(testConfig);
        const updatedConfig = resourceManager.getConfig();
        
        const configUpdateWorked = (
            updatedConfig.healthCheckIntervalMs === testConfig.healthCheckIntervalMs &&
            updatedConfig.memoryWarningThresholdMB === testConfig.memoryWarningThresholdMB &&
            updatedConfig.enableDetailedLogging === testConfig.enableDetailedLogging
        );
        
        console.log(`    Configuration updates: ${configUpdateWorked ? '✓' : '✗'}`);
        
        // Restore original config
        resourceManager.updateConfig(originalConfig);
        
        // Test concurrent health checks
        console.log('  Testing concurrent health check handling...');
        
        const concurrentHealthChecks = await Promise.all([
            resourceManager.getSystemHealth(),
            resourceManager.getSystemHealth(),
            resourceManager.getSystemHealth()
        ]);
        
        const healthChecksConsistent = concurrentHealthChecks.every(health =>
            health.totalComponents === concurrentHealthChecks[0].totalComponents &&
            health.status === concurrentHealthChecks[0].status
        );
        
        console.log(`    Concurrent health checks consistent: ${healthChecksConsistent ? '✓' : '✗'}`);
        
        testPassed = (
            componentCountConsistent &&
            configUpdateWorked &&
            healthChecksConsistent
        );
        
        if (testPassed) {
            console.log('✓ Resource coordination and management working correctly');
        } else {
            console.log('✗ Issues detected in resource coordination');
        }
        
    } catch (error) {
        console.error('✗ Test failed with error:', error.message);
        testPassed = false;
    }
    
    testResults.push({
        name: 'Resource Coordination During Shutdown',
        passed: testPassed
    });
    
    return testPassed;
}

/**
 * Main test runner
 */
async function runResourceMonitoringTests() {
    console.log('🚀 Starting ResourceManager Monitoring Tests\n');
    console.log('Target: Validate ResourceManager health monitoring and coordination');
    
    const startTime = Date.now();
    let setupSuccess = false;
    
    try {
        setupSuccess = await setup();
        if (!setupSuccess) {
            throw new Error('Setup failed');
        }
        
        // Run all ResourceManager monitoring tests
        const testFunctions = [
            testComponentRegistrationManagement,
            testHealthCheckAccuracy,
            testDiagnosticCompleteness,
            testEventMonitoringAlerting,
            testResourceCoordinationShutdown
        ];
        
        let passedTests = 0;
        
        for (const testFn of testFunctions) {
            try {
                const result = await testFn();
                if (result) {
                    passedTests++;
                }
                
                // Delay between tests for cleanup
                await new Promise(resolve => setTimeout(resolve, 300));
            } catch (error) {
                console.error(`Test function ${testFn.name} failed:`, error.message);
            }
        }
        
        // Generate comprehensive monitoring report
        const finalHealth = await resourceManager.getSystemHealth();
        const finalDiagnostics = await resourceManager.getDiagnostics();
        const duration = Date.now() - startTime;
        
        console.log('\n📊 RESOURCE MONITORING TEST SUMMARY');
        console.log('='.repeat(60));
        console.log(`Total tests: ${testFunctions.length}`);
        console.log(`Passed: ${passedTests}`);
        console.log(`Failed: ${testFunctions.length - passedTests}`);
        console.log(`Duration: ${duration}ms`);
        
        console.log('\n🏥 SYSTEM HEALTH STATUS');
        console.log('-'.repeat(40));
        console.log(`Overall status: ${finalHealth.status}`);
        console.log(`Total components: ${finalHealth.totalComponents}`);
        console.log(`Healthy: ${finalHealth.healthyComponents}`);
        console.log(`Unhealthy: ${finalHealth.unhealthyComponents}`);
        console.log(`System uptime: ${(finalHealth.uptimeMs / 1000).toFixed(1)}s`);
        console.log(`Memory usage: ${finalHealth.systemUsage.memoryMB}MB`);
        console.log(`Active connections: ${finalHealth.systemUsage.activeConnections}`);
        console.log(`Pending operations: ${finalHealth.systemUsage.pendingOperations}`);
        
        console.log('\n📊 MONITORING METRICS');
        console.log('-'.repeat(40));
        console.log(`Events logged: ${eventLog.length}`);
        console.log(`Diagnostic components: ${finalDiagnostics.components.length}`);
        console.log(`Recent events: ${finalDiagnostics.recentEvents.length}`);
        
        // Event breakdown
        const eventTypes = eventLog.reduce((acc, event) => {
            acc[event.event] = (acc[event.event] || 0) + 1;
            return acc;
        }, {});
        
        console.log('\n📝 EVENT BREAKDOWN');
        Object.entries(eventTypes).forEach(([event, count]) => {
            console.log(`  ${event}: ${count}`);
        });
        
        console.log('\n📋 DETAILED TEST RESULTS');
        testResults.forEach(result => {
            const status = result.passed ? '✓' : '✗';
            console.log(`  ${status} ${result.name}`);
        });
        
        // Final assessment
        const allTestsPassed = passedTests === testFunctions.length;
        const systemHealthy = finalHealth.status === 'healthy' || finalHealth.status === 'degraded';
        const monitoringWorking = (
            eventLog.length > 0 &&
            finalDiagnostics.components.length > 0 &&
            finalDiagnostics.recentEvents.length > 0
        );
        
        if (allTestsPassed && systemHealthy && monitoringWorking) {
            console.log('\n🎉 ALL RESOURCE MONITORING TESTS PASSED!');
            console.log('✓ ResourceManager health monitoring is accurate');
            console.log('✓ Component registration and coordination working');
            console.log('✓ Event monitoring and alerting functional');
            console.log('✓ Diagnostic information is comprehensive');
            console.log('✓ System maintains healthy operational status');
            return true;
        } else {
            console.log('\n❌ RESOURCE MONITORING ISSUES DETECTED');
            if (!allTestsPassed) {
                console.log(`❌ ${testFunctions.length - passedTests} test(s) failed`);
            }
            if (!systemHealthy) {
                console.log('❌ System health issues detected');
            }
            if (!monitoringWorking) {
                console.log('❌ Monitoring functionality issues detected');
            }
            console.log('⚠️  ResourceManager may need additional configuration or fixes');
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
export default runResourceMonitoringTests;

// If run directly, execute tests
if (import.meta.url === `file://${process.argv[1]}`) {
    runResourceMonitoringTests().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('❌ Unhandled error:', error);
        process.exit(1);
    });
}