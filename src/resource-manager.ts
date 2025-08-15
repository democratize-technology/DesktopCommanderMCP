/**
 * Centralized Resource Manager
 * 
 * Coordinates all resource lifecycle management across the entire system.
 * Provides unified resource monitoring, health checking, and graceful shutdown
 * orchestration with priority-based cleanup coordination.
 */

import { EventEmitter } from 'events';
import { 
  ResourceLifecycle, 
  ResourceRegistration, 
  ResourceInfo,
  ResourceHealthCheck,
  SystemHealthInfo, 
  ResourceMonitoringConfig,
  ResourceManagerEvents,
  DiagnosticInfo,
  CleanupPriority,
  ResourceUsage
} from './interfaces/resource-lifecycle.js';

export class ResourceManager extends EventEmitter {
  private static instance: ResourceManager;
  private components = new Map<string, ResourceRegistration>();
  private config: ResourceMonitoringConfig;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private startTime = new Date();
  private recentEvents: Array<{ timestamp: Date; level: 'info' | 'warning' | 'error'; message: string; data?: any }> = [];
  private readonly maxRecentEvents = 100;

  private constructor() {
    super();
    this.setMaxListeners(50); // Increase limit for component monitoring

    // Default configuration
    this.config = {
      enabled: true,
      healthCheckIntervalMs: 60000, // 1 minute
      memoryWarningThresholdMB: 100,
      memoryCriticalThresholdMB: 200,
      cpuWarningThresholdPercent: 70,
      cpuCriticalThresholdPercent: 90,
      enableDetailedLogging: false,
      cleanupTimeoutMs: 10000, // 10 seconds
      forceCleanupTimeoutMs: 5000 // 5 seconds
    };

    this.initializeMonitoring();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager();
    }
    return ResourceManager.instance;
  }

  /**
   * Initialize resource monitoring
   */
  private initializeMonitoring(): void {
    if (!this.config.enabled) return;

    this.healthCheckTimer = setInterval(() => {
      if (!this.isShuttingDown) {
        this.performSystemHealthCheck().catch(error => {
          this.logEvent('error', 'Health check failed', { error: error.message });
        });
      }
    }, this.config.healthCheckIntervalMs);

    this.logEvent('info', 'Resource monitoring initialized', { 
      interval: this.config.healthCheckIntervalMs 
    });
  }

  /**
   * Update monitoring configuration
   */
  public updateConfig(updates: Partial<ResourceMonitoringConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...updates };

    // Restart monitoring with new config if interval changed
    if (updates.healthCheckIntervalMs && updates.healthCheckIntervalMs !== oldConfig.healthCheckIntervalMs) {
      this.stopMonitoring();
      this.initializeMonitoring();
    }

    this.logEvent('info', 'Configuration updated', { updates });
  }

  /**
   * Register a component for resource management
   */
  public register(
    id: string, 
    component: ResourceLifecycle, 
    priority: CleanupPriority,
    options?: {
      cleanupTimeoutMs?: number;
      isCritical?: boolean;
    }
  ): void {
    if (this.isShuttingDown) {
      throw new Error('Cannot register components during shutdown');
    }

    if (this.components.has(id)) {
      this.logEvent('warning', `Component ${id} already registered, replacing`);
    }

    const registration: ResourceRegistration = {
      component,
      priority,
      cleanupTimeoutMs: options?.cleanupTimeoutMs || this.config.cleanupTimeoutMs,
      isCritical: options?.isCritical || false
    };

    this.components.set(id, registration);

    const info = component.getResourceInfo();
    this.emit('component-registered', { 
      id, 
      type: info.type, 
      priority 
    } as ResourceManagerEvents['component-registered']);

    this.logEvent('info', `Component registered: ${id}`, {
      type: info.type,
      priority,
      isCritical: registration.isCritical
    });
  }

  /**
   * Unregister a component
   */
  public unregister(id: string, reason = 'manual'): void {
    const registration = this.components.get(id);
    if (!registration) {
      this.logEvent('warning', `Attempted to unregister unknown component: ${id}`);
      return;
    }

    this.components.delete(id);
    
    this.emit('component-unregistered', { 
      id, 
      reason 
    } as ResourceManagerEvents['component-unregistered']);

    this.logEvent('info', `Component unregistered: ${id}`, { reason });
  }

  /**
   * Get system health information
   */
  public async getSystemHealth(): Promise<SystemHealthInfo> {
    const totalComponents = this.components.size;
    let healthyComponents = 0;
    let unhealthyComponents = 0;
    const criticalIssues: string[] = [];
    const warnings: string[] = [];
    const systemUsage: ResourceUsage = {
      memoryMB: 0,
      activeConnections: 0,
      pendingOperations: 0,
      customMetrics: {}
    };

    // Check each component's health
    const healthChecks = await Promise.allSettled(
      Array.from(this.components.entries()).map(async ([id, registration]) => {
        try {
          const health = await registration.component.performHealthCheck();
          const info = registration.component.getResourceInfo();
          
          if (health.isHealthy) {
            healthyComponents++;
          } else {
            unhealthyComponents++;
            if (registration.isCritical) {
              criticalIssues.push(...health.issues.map(issue => `${id}: ${issue}`));
            } else {
              warnings.push(...health.issues.map(issue => `${id}: ${issue}`));
            }
          }

          // Aggregate usage
          if (info.usage.memoryMB) systemUsage.memoryMB! += info.usage.memoryMB;
          if (info.usage.activeConnections) systemUsage.activeConnections! += info.usage.activeConnections;
          if (info.usage.pendingOperations) systemUsage.pendingOperations! += info.usage.pendingOperations;

          return { id, health, info };
        } catch (error) {
          unhealthyComponents++;
          const errorMsg = `Health check failed: ${error instanceof Error ? error.message : String(error)}`;
          criticalIssues.push(`${id}: ${errorMsg}`);
          return { id, error: errorMsg };
        }
      })
    );

    // Determine overall system status
    let status: SystemHealthInfo['status'];
    if (criticalIssues.length > 0) {
      status = 'critical';
    } else if (unhealthyComponents > totalComponents * 0.5) {
      status = 'failing';
    } else if (unhealthyComponents > 0 || warnings.length > 0) {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    return {
      status,
      totalComponents,
      healthyComponents,
      unhealthyComponents,
      systemUsage,
      criticalIssues,
      warnings,
      lastChecked: new Date(),
      uptimeMs: Date.now() - this.startTime.getTime()
    };
  }

  /**
   * Perform system-wide health check
   */
  private async performSystemHealthCheck(): Promise<void> {
    try {
      const health = await this.getSystemHealth();
      
      // Emit events for health issues
      if (health.criticalIssues.length > 0) {
        for (const issue of health.criticalIssues) {
          const [componentId] = issue.split(':');
          this.emit('health-critical', { 
            componentId, 
            issues: [issue] 
          } as ResourceManagerEvents['health-critical']);
        }
      }

      if (health.warnings.length > 0) {
        for (const warning of health.warnings) {
          const [componentId] = warning.split(':');
          this.emit('health-warning', { 
            componentId, 
            issues: [warning] 
          } as ResourceManagerEvents['health-warning']);
        }
      }

      if (this.config.enableDetailedLogging) {
        this.logEvent('info', 'Health check completed', {
          status: health.status,
          totalComponents: health.totalComponents,
          healthyComponents: health.healthyComponents,
          unhealthyComponents: health.unhealthyComponents
        });
      }
    } catch (error) {
      this.logEvent('error', 'System health check failed', { 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Graceful shutdown with priority-based cleanup
   */
  public async shutdown(graceful = true): Promise<void> {
    if (this.isShuttingDown) {
      this.logEvent('warning', 'Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    const startTime = Date.now();

    this.emit('shutdown-started', { 
      graceful, 
      totalComponents: this.components.size 
    } as ResourceManagerEvents['shutdown-started']);

    this.logEvent('info', `Starting ${graceful ? 'graceful' : 'forced'} shutdown`, {
      totalComponents: this.components.size
    });

    // Stop health monitoring
    this.stopMonitoring();

    try {
      if (graceful) {
        await this.performGracefulShutdown();
      } else {
        await this.performForceShutdown();
      }

      const duration = Date.now() - startTime;
      this.emit('shutdown-completed', { 
        success: true, 
        duration 
      } as ResourceManagerEvents['shutdown-completed']);

      this.logEvent('info', 'Shutdown completed successfully', { duration });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.emit('shutdown-completed', { 
        success: false, 
        duration 
      } as ResourceManagerEvents['shutdown-completed']);

      this.logEvent('error', 'Shutdown failed', { 
        error: error instanceof Error ? error.message : String(error),
        duration
      });
      throw error;
    }
  }

  /**
   * Perform graceful shutdown with priority ordering
   */
  private async performGracefulShutdown(): Promise<void> {
    // Group components by priority
    const priorityGroups = new Map<CleanupPriority, Array<[string, ResourceRegistration]>>();
    
    for (const [id, registration] of this.components) {
      if (!priorityGroups.has(registration.priority)) {
        priorityGroups.set(registration.priority, []);
      }
      priorityGroups.get(registration.priority)!.push([id, registration]);
    }

    // Sort priorities (lower numbers first)
    const sortedPriorities = Array.from(priorityGroups.keys()).sort((a, b) => a - b);

    // Cleanup each priority group
    for (const priority of sortedPriorities) {
      const group = priorityGroups.get(priority)!;
      this.logEvent('info', `Cleaning up priority ${priority} components`, {
        count: group.length,
        components: group.map(([id]) => id)
      });

      // Cleanup all components in this priority group in parallel
      const cleanupPromises = group.map(([id, registration]) => 
        this.cleanupComponent(id, registration, true)
      );

      await Promise.allSettled(cleanupPromises);
    }
  }

  /**
   * Perform forced shutdown
   */
  private async performForceShutdown(): Promise<void> {
    const cleanupPromises = Array.from(this.components.entries()).map(([id, registration]) => 
      this.cleanupComponent(id, registration, false)
    );

    await Promise.allSettled(cleanupPromises);
  }

  /**
   * Cleanup a single component
   */
  private async cleanupComponent(
    id: string, 
    registration: ResourceRegistration, 
    graceful: boolean
  ): Promise<void> {
    try {
      const timeoutMs = graceful 
        ? registration.cleanupTimeoutMs || this.config.cleanupTimeoutMs
        : this.config.forceCleanupTimeoutMs;

      await this.withTimeout(
        graceful 
          ? registration.component.cleanup()
          : registration.component.forceCleanup(),
        timeoutMs,
        `${graceful ? 'Graceful' : 'Force'} cleanup timeout for component ${id}`
      );

      this.logEvent('info', `Component ${id} cleaned up successfully`, { graceful });
    } catch (error) {
      this.emit('cleanup-timeout', { 
        componentId: id, 
        priority: registration.priority 
      } as ResourceManagerEvents['cleanup-timeout']);

      this.logEvent('error', `Failed to cleanup component ${id}`, {
        error: error instanceof Error ? error.message : String(error),
        graceful
      });

      // If graceful cleanup failed, try force cleanup
      if (graceful) {
        try {
          await this.withTimeout(
            registration.component.forceCleanup(),
            this.config.forceCleanupTimeoutMs,
            `Force cleanup timeout for component ${id}`
          );
          this.logEvent('info', `Component ${id} force cleaned up after graceful failure`);
        } catch (forceError) {
          this.logEvent('error', `Force cleanup also failed for component ${id}`, {
            error: forceError instanceof Error ? forceError.message : String(forceError)
          });
        }
      }
    } finally {
      this.components.delete(id);
    }
  }

  /**
   * Helper to run operation with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * Get diagnostic information
   */
  public async getDiagnostics(): Promise<DiagnosticInfo> {
    const systemHealth = await this.getSystemHealth();
    
    const components = await Promise.allSettled(
      Array.from(this.components.entries()).map(async ([id, registration]) => {
        try {
          const info = registration.component.getResourceInfo();
          const health = await registration.component.performHealthCheck();
          
          return {
            id,
            info,
            health,
            registration: {
              priority: registration.priority,
              cleanupTimeoutMs: registration.cleanupTimeoutMs,
              isCritical: registration.isCritical
            }
          };
        } catch (error) {
          return {
            id,
            info: {
              id,
              type: 'unknown' as const,
              description: 'Failed to get info',
              usage: {},
              isHealthy: false,
              createdAt: new Date(),
              lastActivity: new Date()
            },
            health: {
              isHealthy: false,
              issues: [`Failed to get health: ${error instanceof Error ? error.message : String(error)}`],
              lastChecked: new Date()
            },
            registration: {
              priority: registration.priority,
              cleanupTimeoutMs: registration.cleanupTimeoutMs,
              isCritical: registration.isCritical
            }
          };
        }
      })
    );

    return {
      system: systemHealth,
      components: components
        .filter(result => result.status === 'fulfilled')
        .map(result => (result as PromiseFulfilledResult<any>).value),
      recentEvents: [...this.recentEvents].reverse() // Most recent first
    };
  }

  /**
   * Stop monitoring
   */
  private stopMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Log an event
   */
  private logEvent(level: 'info' | 'warning' | 'error', message: string, data?: any): void {
    const event = {
      timestamp: new Date(),
      level,
      message,
      data
    };

    this.recentEvents.push(event);
    
    // Keep only the most recent events
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.splice(0, this.recentEvents.length - this.maxRecentEvents);
    }

    // Also log to console if detailed logging is enabled
    if (this.config.enableDetailedLogging) {
      const logMethod = level === 'error' ? console.error : level === 'warning' ? console.warn : console.log;
      logMethod(`[ResourceManager] ${message}`, data ? JSON.stringify(data) : '');
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): ResourceMonitoringConfig {
    return { ...this.config };
  }

  /**
   * Check if system is shutting down
   */
  public get shuttingDown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Get list of registered component IDs
   */
  public getRegisteredComponents(): string[] {
    return Array.from(this.components.keys());
  }
}

// Export singleton instance
export const resourceManager = ResourceManager.getInstance();