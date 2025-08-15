/**
 * Transport Resource Adapter
 * 
 * Adapts the FilteredStdioServerTransport to work with the centralized ResourceManager
 * while preserving all existing functionality.
 */

import { 
  ResourceLifecycle, 
  ResourceInfo, 
  ResourceHealthCheck,
  ResourceUsage 
} from '../interfaces/resource-lifecycle.js';
import { FilteredStdioServerTransport } from '../custom-stdio.js';

export class TransportAdapter implements ResourceLifecycle {
  private transport: FilteredStdioServerTransport;
  private cleanedUp = false;
  private createdAt: Date;

  constructor(transport: FilteredStdioServerTransport) {
    this.transport = transport;
    this.createdAt = new Date();
  }

  /**
   * Get current resource information for the transport
   */
  getResourceInfo(): ResourceInfo {
    const usage: ResourceUsage = {
      activeConnections: 1, // Transport maintains one stdio connection
      pendingOperations: 0, // Transport doesn't track pending operations
      customMetrics: {
        hasOriginalConsole: this.hasOriginalConsole() ? 1 : 0,
        hasOriginalStdout: this.hasOriginalStdout() ? 1 : 0,
        isConsoleRedirected: this.isConsoleRedirected() ? 1 : 0
      }
    };

    return {
      id: 'stdio-transport',
      type: 'transport',
      description: 'JSON-RPC stdio transport with console redirection',
      usage,
      isHealthy: !this.cleanedUp && this.hasOriginalConsole() && this.hasOriginalStdout(),
      createdAt: this.createdAt,
      lastActivity: new Date() // Transport is always active when server is running
    };
  }

  /**
   * Perform health check on the transport
   */
  async performHealthCheck(): Promise<ResourceHealthCheck> {
    const issues: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check if transport has been properly initialized
      if (!this.hasOriginalConsole()) {
        issues.push('Original console methods not preserved');
        recommendations.push('Restart transport to restore console state');
      }

      if (!this.hasOriginalStdout()) {
        issues.push('Original stdout.write not preserved');
        recommendations.push('Restart transport to restore stdout state');
      }

      // Check if console redirection is working
      if (!this.isConsoleRedirected()) {
        issues.push('Console redirection not active');
        recommendations.push('Verify transport initialization completed properly');
      }

      // Check process stdio streams
      if (!process.stdout.writable) {
        issues.push('stdout is not writable');
        recommendations.push('Check process stdio configuration');
      }

      if (!process.stderr.writable) {
        issues.push('stderr is not writable');
        recommendations.push('Check process stdio configuration');
      }

      // Check for cleanup state
      if (this.cleanedUp) {
        issues.push('Transport has been cleaned up');
        recommendations.push('Transport cannot be used after cleanup');
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
        recommendations: ['Restart transport if issues persist'],
        lastChecked: new Date()
      };
    }
  }

  /**
   * Graceful cleanup - restore original console and stdout
   */
  async cleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    try {
      // Use the existing cleanup method
      this.transport.cleanup();
      this.cleanedUp = true;
    } catch (error) {
      throw new Error(`Transport cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Force cleanup - same as graceful for transport
   */
  async forceCleanup(): Promise<void> {
    if (this.cleanedUp) {
      return;
    }

    try {
      this.transport.cleanup();
      this.cleanedUp = true;
    } catch (error) {
      // For force cleanup, we mark as cleaned up even if it fails
      this.cleanedUp = true;
      console.error('Force cleanup failed for transport:', error);
    }
  }

  /**
   * Check if cleanup has been completed
   */
  isCleanedUp(): boolean {
    return this.cleanedUp;
  }

  /**
   * Transport doesn't support runtime configuration updates
   */
  async updateConfiguration(config: Record<string, any>): Promise<void> {
    // Transport configuration is set at initialization and cannot be changed
    throw new Error('Transport configuration cannot be updated at runtime');
  }

  /**
   * Get the underlying transport instance
   */
  getTransport(): FilteredStdioServerTransport {
    return this.transport;
  }

  /**
   * Check if original console methods are preserved
   */
  private hasOriginalConsole(): boolean {
    try {
      // Access private property using bracket notation to avoid TypeScript errors
      const originalConsole = (this.transport as any).originalConsole;
      return originalConsole && 
             typeof originalConsole.log === 'function' &&
             typeof originalConsole.warn === 'function' &&
             typeof originalConsole.error === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Check if original stdout.write is preserved
   */
  private hasOriginalStdout(): boolean {
    try {
      // Access private property using bracket notation
      const originalStdoutWrite = (this.transport as any).originalStdoutWrite;
      return typeof originalStdoutWrite === 'function';
    } catch {
      return false;
    }
  }

  /**
   * Check if console redirection is active
   */
  private isConsoleRedirected(): boolean {
    try {
      // Console should be redirected if transport is working properly
      // We check if console.log is not the original function
      return console.log.toString().includes('sendLogNotification') ||
             console.log.name !== 'log'; // Wrapped functions often have different names
    } catch {
      return false;
    }
  }
}