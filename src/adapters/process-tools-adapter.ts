/**
 * Process Tools Resource Adapter
 * 
 * Adapts the existing ResourceManager pattern from improved-process-tools.ts
 * to work with the centralized ResourceManager system.
 */

import { 
  ResourceLifecycle, 
  ResourceInfo, 
  ResourceHealthCheck,
  ResourceUsage 
} from '../interfaces/resource-lifecycle.js';

export class ProcessToolsAdapter implements ResourceLifecycle {
  private activeResourceManagers = new Set<any>();
  private cleanedUp = false;
  private createdAt: Date;
  private lastActivity: Date;

  constructor() {
    this.createdAt = new Date();
    this.lastActivity = new Date();
  }

  /**
   * Register a ResourceManager instance from process tools
   */
  registerResourceManager(resourceManager: any): void {
    if (this.cleanedUp) {
      throw new Error('Cannot register resources after cleanup');
    }

    this.activeResourceManagers.add(resourceManager);
    this.lastActivity = new Date();
  }

  /**
   * Unregister a ResourceManager instance
   */
  unregisterResourceManager(resourceManager: any): void {
    this.activeResourceManagers.delete(resourceManager);
    this.lastActivity = new Date();
  }

  /**
   * Get current resource information
   */
  getResourceInfo(): ResourceInfo {
    const totalManagers = this.activeResourceManagers.size;
    let totalTimers = 0;
    let totalIntervals = 0;
    let totalListeners = 0;

    // Count resources from all active managers
    for (const manager of this.activeResourceManagers) {
      try {
        if (manager.timers && manager.timers.size) {
          totalTimers += manager.timers.size;
        }
        if (manager.intervals && manager.intervals.size) {
          totalIntervals += manager.intervals.size;
        }
        if (manager.listeners && manager.listeners.size) {
          totalListeners += manager.listeners.size;
        }
      } catch (error) {
        // Ignore errors accessing private properties
      }
    }

    const usage: ResourceUsage = {
      activeConnections: totalManagers,
      pendingOperations: totalTimers + totalIntervals,
      customMetrics: {
        totalManagers,
        totalTimers,
        totalIntervals,
        totalListeners,
        disposedManagers: Array.from(this.activeResourceManagers).filter(m => {
          try {
            return m.disposed === true;
          } catch {
            return false;
          }
        }).length
      }
    };

    return {
      id: 'process-tools',
      type: 'process',
      description: `Process tools resource management with ${totalManagers} active managers`,
      usage,
      isHealthy: !this.cleanedUp && totalManagers >= 0,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity
    };
  }

  /**
   * Perform health check on process tools resources
   */
  async performHealthCheck(): Promise<ResourceHealthCheck> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      if (this.cleanedUp) {
        issues.push('Process tools adapter has been cleaned up');
        return {
          isHealthy: false,
          issues,
          lastChecked: new Date()
        };
      }

      let disposedCount = 0;
      let healthyCount = 0;
      let totalResources = 0;

      // Check each active resource manager
      for (const manager of this.activeResourceManagers) {
        try {
          // Check if manager is disposed
          const isDisposed = manager.disposed === true;
          if (isDisposed) {
            disposedCount++;
          } else {
            healthyCount++;
          }

          // Count total resources
          if (manager.timers) totalResources += manager.timers.size;
          if (manager.intervals) totalResources += manager.intervals.size;
          if (manager.listeners) totalResources += manager.listeners.size;

        } catch (error) {
          issues.push(`Error checking resource manager: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Check for potential resource leaks
      if (totalResources > 100) {
        issues.push(`High resource count detected: ${totalResources} active resources`);
        recommendations.push('Monitor for potential resource leaks and cleanup unused resources');
      }

      // Check for disposed managers that should be removed
      if (disposedCount > 0) {
        issues.push(`${disposedCount} disposed resource managers still registered`);
        recommendations.push('Clean up disposed resource managers to free memory');
      }

      // Check resource manager activity
      const inactiveTime = Date.now() - this.lastActivity.getTime();
      if (inactiveTime > 300000) { // 5 minutes
        issues.push(`No resource manager activity for ${Math.round(inactiveTime / 1000)}s`);
        recommendations.push('Verify process tools are functioning correctly');
      }

      const isHealthy = issues.length === 0;

      return {
        isHealthy,
        issues,
        recommendations: recommendations.length > 0 ? recommendations : undefined,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        isHealthy: false,
        issues: [`Health check failed: ${error instanceof Error ? error.message : String(error)}`],
        recommendations: ['Check process tools configuration'],
        lastChecked: new Date()
      };
    }
  }

  /**
   * Graceful cleanup - cleanup all registered resource managers
   */
  async cleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    try {
      const cleanupPromises: Promise<void>[] = [];

      // Cleanup all active resource managers
      for (const manager of this.activeResourceManagers) {
        const cleanupPromise = new Promise<void>((resolve) => {
          try {
            if (typeof manager.cleanup === 'function') {
              manager.cleanup();
            }
            resolve();
          } catch (error) {
            console.error('Error cleaning up resource manager:', error);
            resolve(); // Continue cleanup even if one fails
          }
        });
        cleanupPromises.push(cleanupPromise);
      }

      // Wait for all cleanups with timeout
      await Promise.race([
        Promise.all(cleanupPromises),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cleanup timeout')), 5000)
        )
      ]);

      this.activeResourceManagers.clear();
      this.cleanedUp = true;
    } catch (error) {
      throw new Error(`Process tools cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Force cleanup - aggressively cleanup all resources
   */
  async forceCleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    try {
      // Force cleanup all resource managers without waiting
      for (const manager of this.activeResourceManagers) {
        try {
          if (typeof manager.cleanup === 'function') {
            manager.cleanup();
          }
        } catch (error) {
          // Ignore errors during force cleanup
        }
      }

      this.activeResourceManagers.clear();
      this.cleanedUp = true;
    } catch (error) {
      // Always mark as cleaned up for force cleanup
      this.cleanedUp = true;
      console.error('Force cleanup failed for process tools:', error);
    }
  }

  /**
   * Check if cleanup has been completed
   */
  isCleanedUp(): boolean {
    return this.cleanedUp;
  }

  /**
   * Process tools don't support runtime configuration updates
   */
  async updateConfiguration(config: Record<string, any>): Promise<void> {
    // Process tools configuration is handled per-operation and cannot be changed globally
    throw new Error('Process tools configuration cannot be updated at runtime');
  }

  /**
   * Get active resource manager count
   */
  getActiveManagerCount(): number {
    return this.activeResourceManagers.size;
  }

  /**
   * Clean up disposed resource managers
   */
  cleanupDisposedManagers(): number {
    let removedCount = 0;
    
    for (const manager of this.activeResourceManagers) {
      try {
        if (manager.disposed === true) {
          this.activeResourceManagers.delete(manager);
          removedCount++;
        }
      } catch (error) {
        // Ignore errors checking disposed state
      }
    }

    if (removedCount > 0) {
      this.lastActivity = new Date();
    }

    return removedCount;
  }
}