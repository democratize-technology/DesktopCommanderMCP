/**
 * Terminal Manager Resource Adapter
 * 
 * Adapts the existing TerminalManager to work with the centralized ResourceManager
 * while preserving all existing functionality and interfaces.
 */

import { 
  ResourceLifecycle, 
  ResourceInfo, 
  ResourceHealthCheck,
  ResourceUsage 
} from '../interfaces/resource-lifecycle.js';
import { TerminalManager } from '../terminal-manager.js';

export class TerminalManagerAdapter implements ResourceLifecycle {
  private terminalManager: TerminalManager;
  private cleanedUp = false;

  constructor(terminalManager: TerminalManager) {
    this.terminalManager = terminalManager;
  }

  /**
   * Get current resource information for the TerminalManager
   */
  getResourceInfo(): ResourceInfo {
    const diagnostics = this.terminalManager.getDiagnostics();
    const sessions = this.terminalManager.listActiveSessions();
    const config = this.terminalManager.getSessionConfig();

    const usage: ResourceUsage = {
      memoryMB: diagnostics.memoryUsageMB,
      activeConnections: diagnostics.activeSessions,
      pendingOperations: 0, // Terminal manager doesn't track pending ops
      customMetrics: {
        completedSessions: diagnostics.completedSessions,
        oldestSessionAge: diagnostics.oldestSessionAge,
        unhealthySessions: diagnostics.unhealthySessions,
        maxActiveSessions: config.maxActiveSessions,
        maxCompletedSessions: config.maxCompletedSessions
      }
    };

    return {
      id: 'terminal-manager',
      type: 'terminal',
      description: `Terminal session manager with ${diagnostics.activeSessions} active sessions`,
      usage,
      isHealthy: diagnostics.unhealthySessions === 0 && diagnostics.resourcePressure !== 'critical',
      createdAt: new Date(Date.now() - 300000), // Approximate - manager exists for ~5 min
      lastActivity: new Date() // Always active when sessions exist
    };
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<ResourceHealthCheck> {
    const issues: string[] = [];
    const recommendations: string[] = [];
    
    try {
      const diagnostics = this.terminalManager.getDiagnostics();
      const sessionHealth = this.terminalManager.getSessionHealth();
      const config = this.terminalManager.getSessionConfig();

      // Check for unhealthy sessions
      if (diagnostics.unhealthySessions > 0) {
        issues.push(`${diagnostics.unhealthySessions} unhealthy sessions detected`);
        recommendations.push('Review session health and consider terminating unhealthy sessions');
      }

      // Check resource pressure
      if (diagnostics.resourcePressure === 'critical') {
        issues.push('Critical resource pressure - at session limits');
        recommendations.push('Consider increasing session limits or cleaning up old sessions');
      } else if (diagnostics.resourcePressure === 'high') {
        issues.push('High resource pressure - approaching session limits');
        recommendations.push('Monitor session usage and prepare for cleanup');
      }

      // Check memory usage
      if (diagnostics.memoryUsageMB > config.memoryCriticalThresholdMB) {
        issues.push(`Memory usage ${diagnostics.memoryUsageMB}MB exceeds critical threshold ${config.memoryCriticalThresholdMB}MB`);
        recommendations.push('Terminate high-memory sessions or increase memory limits');
      } else if (diagnostics.memoryUsageMB > config.memoryWarningThresholdMB) {
        issues.push(`Memory usage ${diagnostics.memoryUsageMB}MB exceeds warning threshold ${config.memoryWarningThresholdMB}MB`);
        recommendations.push('Monitor memory usage and consider cleanup');
      }

      // Check for very old sessions
      const maxReasonableAge = config.sessionTimeoutMs * 0.8;
      if (diagnostics.oldestSessionAge > maxReasonableAge) {
        issues.push(`Oldest session age ${Math.round(diagnostics.oldestSessionAge / 1000)}s approaches timeout`);
        recommendations.push('Review long-running sessions for necessary cleanup');
      }

      // Check session-specific health issues
      for (const session of sessionHealth) {
        if (!session.isHealthy && session.issues.length > 0) {
          issues.push(`Session ${session.pid}: ${session.issues.join(', ')}`);
        }
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
        recommendations: ['Restart terminal manager if issues persist'],
        lastChecked: new Date()
      };
    }
  }

  /**
   * Graceful cleanup - delegate to existing TerminalManager cleanup
   */
  async cleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    try {
      await this.terminalManager.cleanup();
      this.cleanedUp = true;
    } catch (error) {
      throw new Error(`Terminal manager cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Force cleanup - same as graceful for TerminalManager
   * The existing cleanup method already handles force termination
   */
  async forceCleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    try {
      // The existing cleanup method already uses SIGTERM then SIGKILL
      await this.terminalManager.cleanup();
      this.cleanedUp = true;
    } catch (error) {
      // For force cleanup, we mark as cleaned up even if it fails
      this.cleanedUp = true;
      console.error('Force cleanup failed for terminal manager:', error);
    }
  }

  /**
   * Check if cleanup has been completed
   */
  isCleanedUp(): boolean {
    return this.cleanedUp;
  }

  /**
   * Update terminal manager configuration
   */
  async updateConfiguration(config: Record<string, any>): Promise<void> {
    try {
      // Extract session config updates if present
      const sessionConfigUpdates: any = {};
      
      // Map generic config to session-specific config
      if (config.maxActiveSessions !== undefined) {
        sessionConfigUpdates.maxActiveSessions = config.maxActiveSessions;
      }
      if (config.maxCompletedSessions !== undefined) {
        sessionConfigUpdates.maxCompletedSessions = config.maxCompletedSessions;
      }
      if (config.sessionTimeoutMs !== undefined) {
        sessionConfigUpdates.sessionTimeoutMs = config.sessionTimeoutMs;
      }
      if (config.cleanupIntervalMs !== undefined) {
        sessionConfigUpdates.cleanupIntervalMs = config.cleanupIntervalMs;
      }
      if (config.healthCheckIntervalMs !== undefined) {
        sessionConfigUpdates.healthCheckIntervalMs = config.healthCheckIntervalMs;
      }
      if (config.memoryWarningThresholdMB !== undefined) {
        sessionConfigUpdates.memoryWarningThresholdMB = config.memoryWarningThresholdMB;
      }
      if (config.memoryCriticalThresholdMB !== undefined) {
        sessionConfigUpdates.memoryCriticalThresholdMB = config.memoryCriticalThresholdMB;
      }
      if (config.enableResourceMonitoring !== undefined) {
        sessionConfigUpdates.enableResourceMonitoring = config.enableResourceMonitoring;
      }

      if (Object.keys(sessionConfigUpdates).length > 0) {
        await this.terminalManager.updateSessionConfig(sessionConfigUpdates);
      }
    } catch (error) {
      throw new Error(`Failed to update terminal manager configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get the underlying TerminalManager instance
   */
  getTerminalManager(): TerminalManager {
    return this.terminalManager;
  }
}