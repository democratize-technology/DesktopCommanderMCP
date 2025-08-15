# ResourceManager Architecture

## Overview

The ResourceManager provides centralized resource lifecycle management for DesktopCommanderMCP, coordinating all component cleanup with priority-based orchestration, health monitoring, and comprehensive diagnostics.

## Architecture

### Core Components

```
src/
├── interfaces/
│   └── resource-lifecycle.ts          # Interface definitions
├── resource-manager.ts                # Main ResourceManager
├── adapters/                          # Component adapters
│   ├── terminal-manager-adapter.ts    # TerminalManager integration
│   ├── transport-adapter.ts           # Transport integration
│   └── process-tools-adapter.ts       # Process tools integration
└── index.ts                          # System integration
```

### Resource Lifecycle Interface

All managed components implement the `ResourceLifecycle` interface:

```typescript
interface ResourceLifecycle {
  getResourceInfo(): ResourceInfo;
  performHealthCheck(): Promise<ResourceHealthCheck>;
  cleanup(): Promise<void>;
  forceCleanup(): Promise<void>;
  isCleanedUp(): boolean;
  updateConfiguration?(config: Record<string, any>): Promise<void>;
}
```

### Priority-Based Cleanup

Components are cleaned up in priority order during shutdown:

1. **CRITICAL (Priority 1)**: Terminal sessions and child processes
2. **TRANSPORT (Priority 2)**: Transport and I/O cleanup
3. **BACKGROUND (Priority 3)**: Background tasks and monitoring
4. **SYSTEM (Priority 4)**: System resources and logging

## Usage

### Component Registration

```typescript
import { resourceManager, CleanupPriority } from './resource-manager.js';

// Register a component
resourceManager.register(
  'component-id',
  componentInstance,
  CleanupPriority.CRITICAL,
  {
    cleanupTimeoutMs: 10000,
    isCritical: true
  }
);
```

### Health Monitoring

```typescript
// Get system health
const health = await resourceManager.getSystemHealth();
console.log(`System status: ${health.status}`);

// Listen for health events
resourceManager.on('health-critical', (event) => {
  console.error(`Critical issue in ${event.componentId}:`, event.issues);
});
```

### Graceful Shutdown

```typescript
// Graceful shutdown
await resourceManager.shutdown(true);

// Force shutdown
await resourceManager.shutdown(false);
```

## Configuration

### Monitoring Configuration

```typescript
resourceManager.updateConfig({
  enabled: true,
  healthCheckIntervalMs: 60000,
  memoryWarningThresholdMB: 100,
  memoryCriticalThresholdMB: 200,
  cleanupTimeoutMs: 10000,
  enableDetailedLogging: false
});
```

## Integration Examples

### Creating an Adapter

```typescript
export class MyComponentAdapter implements ResourceLifecycle {
  private component: MyComponent;
  private cleanedUp = false;

  constructor(component: MyComponent) {
    this.component = component;
  }

  getResourceInfo(): ResourceInfo {
    return {
      id: 'my-component',
      type: 'custom',
      description: 'My custom component',
      usage: {
        memoryMB: this.component.getMemoryUsage(),
        activeConnections: this.component.getConnectionCount()
      },
      isHealthy: this.component.isHealthy(),
      createdAt: new Date(),
      lastActivity: new Date()
    };
  }

  async performHealthCheck(): Promise<ResourceHealthCheck> {
    const issues: string[] = [];
    
    if (!this.component.isHealthy()) {
      issues.push('Component is unhealthy');
    }
    
    return {
      isHealthy: issues.length === 0,
      issues,
      lastChecked: new Date()
    };
  }

  async cleanup(): Promise<void> {
    if (!this.cleanedUp) {
      await this.component.shutdown();
      this.cleanedUp = true;
    }
  }

  async forceCleanup(): Promise<void> {
    if (!this.cleanedUp) {
      this.component.forceShutdown();
      this.cleanedUp = true;
    }
  }

  isCleanedUp(): boolean {
    return this.cleanedUp;
  }
}
```

### Registering the Adapter

```typescript
const adapter = new MyComponentAdapter(myComponent);
resourceManager.register(
  'my-component',
  adapter,
  CleanupPriority.BACKGROUND,
  { cleanupTimeoutMs: 5000 }
);
```

## Event System

### Available Events

- `component-registered`: Component successfully registered
- `component-unregistered`: Component unregistered
- `health-warning`: Component has non-critical issues
- `health-critical`: Component has critical issues
- `shutdown-started`: Shutdown process initiated
- `shutdown-completed`: Shutdown process completed
- `cleanup-timeout`: Component cleanup timed out

### Event Handling

```typescript
resourceManager.on('health-critical', (event) => {
  // Handle critical health issues
  notifyOperations(event.componentId, event.issues);
});

resourceManager.on('cleanup-timeout', (event) => {
  // Handle cleanup timeouts
  logTimeoutEvent(event.componentId, event.priority);
});
```

## Diagnostics

### Getting Diagnostic Information

```typescript
const diagnostics = await resourceManager.getDiagnostics();

console.log('System Health:', diagnostics.system);
console.log('Component Details:', diagnostics.components);
console.log('Recent Events:', diagnostics.recentEvents);
```

### System Health Response

```typescript
{
  status: 'healthy' | 'degraded' | 'critical' | 'failing',
  totalComponents: 3,
  healthyComponents: 3,
  unhealthyComponents: 0,
  systemUsage: {
    memoryMB: 150,
    activeConnections: 5,
    pendingOperations: 0
  },
  criticalIssues: [],
  warnings: [],
  lastChecked: Date,
  uptimeMs: 120000
}
```

## Best Practices

### 1. Component Design

- Implement ResourceLifecycle interface for all managed resources
- Provide meaningful resource information and health checks
- Support both graceful and force cleanup
- Handle cleanup idempotency (safe to call multiple times)

### 2. Registration

- Use appropriate cleanup priority based on component criticality
- Set reasonable cleanup timeouts based on component behavior
- Mark truly critical components as `isCritical: true`

### 3. Health Monitoring

- Implement comprehensive health checks that detect real issues
- Provide actionable recommendations for unhealthy states
- Use appropriate thresholds for warnings vs critical issues

### 4. Error Handling

- Handle cleanup errors gracefully without throwing
- Provide fallback mechanisms for force cleanup
- Log errors appropriately for debugging

### 5. Testing

- Test graceful shutdown scenarios
- Verify health check accuracy
- Test resource cleanup completeness
- Validate timeout handling

## Migration Guide

### For Existing Components

1. Create an adapter class implementing ResourceLifecycle
2. Wrap existing cleanup logic in the adapter methods
3. Register the adapter with ResourceManager
4. Remove manual cleanup from global shutdown handlers
5. Test integration thoroughly

### For New Components

1. Design component with ResourceLifecycle in mind
2. Implement interface directly or via adapter
3. Register during component initialization
4. Use ResourceManager events for monitoring

## Performance Considerations

- Health checks run every 60 seconds by default
- Cleanup operations have configurable timeouts
- Event listeners should be efficient to avoid blocking
- Resource monitoring can be disabled if not needed

## Security Considerations

- ResourceManager events may contain sensitive information
- Health check data should not expose security details
- Cleanup should properly dispose of sensitive resources
- Configuration updates should be validated

## Troubleshooting

### Common Issues

1. **Component not cleaning up**: Check adapter implementation and timeouts
2. **Health checks failing**: Verify health check logic and dependencies
3. **Shutdown hanging**: Check for deadlocks in cleanup code
4. **Memory leaks**: Ensure all resources are properly disposed

### Debug Information

```typescript
// Get registered components
const components = resourceManager.getRegisteredComponents();

// Check if shutting down
const shuttingDown = resourceManager.shuttingDown;

// Get configuration
const config = resourceManager.getConfig();
```

## Future Enhancements

- Resource usage trending and alerting
- Component dependency management
- Automatic resource limit enforcement
- Integration with external monitoring systems
- Metrics export for observability platforms