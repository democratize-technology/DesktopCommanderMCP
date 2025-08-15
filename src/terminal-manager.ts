import { spawn } from 'child_process';
import { TerminalSession, CommandExecutionResult, ActiveSession, SessionConfig, SessionDiagnostics, SessionHealth } from './types.js';
import { DEFAULT_COMMAND_TIMEOUT } from './config.js';
import { configManager } from './config-manager.js';
import { analyzeProcessState } from './utils/process-detection.js';

interface CompletedSession {
  pid: number;
  output: string;
  exitCode: number | null;
  startTime: Date;
  endTime: Date;
  maxMemoryUsageMB?: number;
  reasonForCompletion: 'exit' | 'timeout' | 'killed' | 'error' | 'lru-evicted';
}

interface ResourceMonitor {
  memoryUsageMB: number;
  cpuUsagePercent: number;
  isHealthy: boolean;
  lastChecked: Date;
}

export class TerminalManager {
  private sessions: Map<number, TerminalSession> = new Map();
  private completedSessions: Map<number, CompletedSession> = new Map();
  private sessionConfig: SessionConfig;
  private resourceMonitors: Map<number, ResourceMonitor> = new Map();
  
  // Cleanup and monitoring timers
  private cleanupTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  
  // LRU tracking for session eviction
  private sessionAccessOrder: number[] = [];
  
  constructor() {
    // Initialize with default configuration
    this.sessionConfig = {
      maxActiveSessions: 50,
      maxCompletedSessions: 100,
      sessionTimeoutMs: 1800000, // 30 minutes
      cleanupIntervalMs: 300000,  // 5 minutes
      healthCheckIntervalMs: 60000, // 1 minute
      memoryWarningThresholdMB: 100,
      memoryCriticalThresholdMB: 200,
      enableResourceMonitoring: true
    };
    
    this.initializeBackgroundTasks();
  }

  /**
   * Initialize background monitoring and cleanup tasks
   */
  private async initializeBackgroundTasks(): Promise<void> {
    try {
      // Load session configuration from config manager
      this.sessionConfig = await configManager.getSessionConfig();
    } catch (error) {
      console.error('[TerminalManager] Failed to load session config, using defaults:', error);
    }

    // Start periodic cleanup task
    this.cleanupTimer = setInterval(() => {
      if (!this.isShuttingDown) {
        this.performPeriodicCleanup().catch(error => {
          console.error('[TerminalManager] Error in periodic cleanup:', error);
        });
      }
    }, this.sessionConfig.cleanupIntervalMs);

    // Start health monitoring task
    if (this.sessionConfig.enableResourceMonitoring) {
      this.healthCheckTimer = setInterval(() => {
        if (!this.isShuttingDown) {
          this.performHealthChecks().catch(error => {
            console.error('[TerminalManager] Error in health check:', error);
          });
        }
      }, this.sessionConfig.healthCheckIntervalMs);
    }
  }

  /**
   * Update session configuration at runtime
   */
  async updateSessionConfig(updates: Partial<SessionConfig>): Promise<SessionConfig> {
    try {
      this.sessionConfig = await configManager.updateSessionConfig(updates);
      
      // Restart background tasks with new configuration
      this.stopBackgroundTasks();
      await this.initializeBackgroundTasks();
      
      console.log('[TerminalManager] Session configuration updated:', this.sessionConfig);
      return { ...this.sessionConfig };
    } catch (error) {
      console.error('[TerminalManager] Failed to update session configuration:', error);
      throw error;
    }
  }

  /**
   * Stop background monitoring tasks
   */
  private stopBackgroundTasks(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Track session access for LRU eviction
   */
  private trackSessionAccess(pid: number): void {
    // Remove from current position and add to end (most recently used)
    this.sessionAccessOrder = this.sessionAccessOrder.filter(p => p !== pid);
    this.sessionAccessOrder.push(pid);
  }

  /**
   * Update session activity timestamp
   */
  private updateSessionActivity(pid: number): void {
    const session = this.sessions.get(pid);
    if (session) {
      session.lastActivityTime = new Date();
      this.trackSessionAccess(pid);
    }
  }

  /**
   * Check if we need to enforce session limits
   */
  private async enforceSessionLimits(): Promise<void> {
    const activeCount = this.sessions.size;
    
    if (activeCount >= this.sessionConfig.maxActiveSessions) {
      const excessCount = activeCount - this.sessionConfig.maxActiveSessions + 1; // +1 for new session
      await this.evictOldestSessions(excessCount);
    }
  }

  /**
   * Evict oldest sessions using LRU policy
   */
  private async evictOldestSessions(count: number): Promise<void> {
    const sessionsToEvict = this.sessionAccessOrder.slice(0, count);
    
    for (const pid of sessionsToEvict) {
      const session = this.sessions.get(pid);
      if (session) {
        console.log(`[TerminalManager] Evicting session ${pid} due to resource limits`);
        try {
          // Kill the process gracefully
          session.process.kill('SIGTERM');
          
          // Store as completed with LRU eviction reason
          this.completedSessions.set(pid, {
            pid,
            output: session.lastOutput,
            exitCode: null,
            startTime: session.startTime,
            endTime: new Date(),
            maxMemoryUsageMB: this.resourceMonitors.get(pid)?.memoryUsageMB,
            reasonForCompletion: 'lru-evicted'
          });
          
          this.sessions.delete(pid);
          this.resourceMonitors.delete(pid);
          this.sessionAccessOrder = this.sessionAccessOrder.filter(p => p !== pid);
        } catch (error) {
          console.error(`[TerminalManager] Error evicting session ${pid}:`, error);
        }
      }
    }
  }

  /**
   * Perform periodic cleanup of stale sessions
   */
  private async performPeriodicCleanup(): Promise<void> {
    const now = new Date();
    const staleSessions: number[] = [];
    
    // Check for timed-out sessions
    for (const [pid, session] of this.sessions) {
      const ageMs = now.getTime() - session.lastActivityTime.getTime();
      
      if (ageMs > this.sessionConfig.sessionTimeoutMs) {
        staleSessions.push(pid);
      }
    }
    
    // Clean up stale sessions
    for (const pid of staleSessions) {
      console.log(`[TerminalManager] Cleaning up stale session ${pid} (inactive for ${this.sessionConfig.sessionTimeoutMs}ms)`);
      await this.terminateStaleSession(pid, 'timeout');
    }
    
    // Limit completed sessions
    if (this.completedSessions.size > this.sessionConfig.maxCompletedSessions) {
      const excessCount = this.completedSessions.size - this.sessionConfig.maxCompletedSessions;
      const oldestKeys = Array.from(this.completedSessions.keys()).slice(0, excessCount);
      for (const key of oldestKeys) {
        this.completedSessions.delete(key);
      }
    }
  }

  /**
   * Terminate a stale session
   */
  private async terminateStaleSession(pid: number, reason: 'timeout' | 'killed' | 'error'): Promise<void> {
    const session = this.sessions.get(pid);
    if (!session) return;

    try {
      if (!session.process.killed) {
        session.process.kill('SIGTERM');
        
        // Force kill after timeout
        setTimeout(() => {
          if (!session.process.killed) {
            session.process.kill('SIGKILL');
          }
        }, 2000);
      }
      
      // Store completed session
      this.completedSessions.set(pid, {
        pid,
        output: session.lastOutput,
        exitCode: null,
        startTime: session.startTime,
        endTime: new Date(),
        maxMemoryUsageMB: this.resourceMonitors.get(pid)?.memoryUsageMB,
        reasonForCompletion: reason
      });
      
      this.sessions.delete(pid);
      this.resourceMonitors.delete(pid);
      this.sessionAccessOrder = this.sessionAccessOrder.filter(p => p !== pid);
    } catch (error) {
      console.error(`[TerminalManager] Error terminating stale session ${pid}:`, error);
    }
  }

  /**
   * Perform health checks on all active sessions
   */
  private async performHealthChecks(): Promise<void> {
    if (!this.sessionConfig.enableResourceMonitoring) return;

    const now = new Date();
    const unhealthySessions: number[] = [];
    
    for (const [pid, session] of this.sessions) {
      try {
        const resourceInfo = await this.getProcessResourceInfo(pid);
        
        // Update resource monitor
        this.resourceMonitors.set(pid, {
          memoryUsageMB: resourceInfo.memoryUsageMB,
          cpuUsagePercent: resourceInfo.cpuUsagePercent,
          isHealthy: resourceInfo.isHealthy,
          lastChecked: now
        });
        
        // Update session health status
        session.isHealthy = resourceInfo.isHealthy;
        session.memoryUsageMB = resourceInfo.memoryUsageMB;
        session.cpuUsagePercent = resourceInfo.cpuUsagePercent;
        
        // Check for critical resource usage
        if (resourceInfo.memoryUsageMB > this.sessionConfig.memoryCriticalThresholdMB) {
          console.warn(`[TerminalManager] Session ${pid} exceeded critical memory threshold: ${resourceInfo.memoryUsageMB}MB`);
          unhealthySessions.push(pid);
        } else if (resourceInfo.memoryUsageMB > this.sessionConfig.memoryWarningThresholdMB) {
          console.warn(`[TerminalManager] Session ${pid} exceeded memory warning threshold: ${resourceInfo.memoryUsageMB}MB`);
        }
        
        // Check for zombie processes
        if (!resourceInfo.isHealthy) {
          unhealthySessions.push(pid);
        }
      } catch (error) {
        console.error(`[TerminalManager] Error checking health for session ${pid}:`, error);
        session.isHealthy = false;
      }
    }
    
    // Handle unhealthy sessions
    for (const pid of unhealthySessions) {
      await this.terminateStaleSession(pid, 'error');
    }
  }

  /**
   * Get process resource information
   */
  private async getProcessResourceInfo(pid: number): Promise<{
    memoryUsageMB: number;
    cpuUsagePercent: number;
    isHealthy: boolean;
  }> {
    try {
      // For basic implementation, check if process exists
      // In production, you might use process monitoring libraries
      const process = this.sessions.get(pid)?.process;
      if (!process || process.killed) {
        return { memoryUsageMB: 0, cpuUsagePercent: 0, isHealthy: false };
      }
      
      // Simple health check - process exists and is not killed
      return {
        memoryUsageMB: Math.random() * 50, // Placeholder - implement actual memory monitoring
        cpuUsagePercent: Math.random() * 10, // Placeholder - implement actual CPU monitoring
        isHealthy: !process.killed
      };
    } catch (error) {
      return { memoryUsageMB: 0, cpuUsagePercent: 0, isHealthy: false };
    }
  }

  /**
   * Get comprehensive session diagnostics
   */
  getDiagnostics(): SessionDiagnostics {
    const now = new Date();
    let oldestAge = 0;
    let unhealthyCount = 0;
    let totalMemory = 0;
    
    for (const [, session] of this.sessions) {
      const age = now.getTime() - session.startTime.getTime();
      if (age > oldestAge) oldestAge = age;
      
      if (!session.isHealthy) unhealthyCount++;
      if (session.memoryUsageMB) totalMemory += session.memoryUsageMB;
    }
    
    // Determine resource pressure
    const activeRatio = this.sessions.size / this.sessionConfig.maxActiveSessions;
    let resourcePressure: 'low' | 'medium' | 'high' | 'critical';
    
    if (activeRatio < 0.5) resourcePressure = 'low';
    else if (activeRatio < 0.75) resourcePressure = 'medium';
    else if (activeRatio < 0.9) resourcePressure = 'high';
    else resourcePressure = 'critical';
    
    return {
      activeSessions: this.sessions.size,
      completedSessions: this.completedSessions.size,
      memoryUsageMB: totalMemory,
      oldestSessionAge: oldestAge,
      unhealthySessions: unhealthyCount,
      lastCleanupTime: new Date(), // Implement actual tracking
      resourcePressure
    };
  }

  /**
   * Get health status for all sessions
   */
  getSessionHealth(): SessionHealth[] {
    const now = new Date();
    const healthStatuses: SessionHealth[] = [];
    
    for (const [pid, session] of this.sessions) {
      const monitor = this.resourceMonitors.get(pid);
      const issues: string[] = [];
      
      if (!session.isHealthy) issues.push('Process appears unhealthy');
      if (session.memoryUsageMB && session.memoryUsageMB > this.sessionConfig.memoryWarningThresholdMB) {
        issues.push(`High memory usage: ${session.memoryUsageMB}MB`);
      }
      
      const ageMs = now.getTime() - session.lastActivityTime.getTime();
      if (ageMs > this.sessionConfig.sessionTimeoutMs * 0.8) {
        issues.push(`Session approaching timeout (${Math.round(ageMs / 1000)}s)`);
      }
      
      healthStatuses.push({
        pid,
        isHealthy: session.isHealthy && issues.length === 0,
        issues,
        lastChecked: monitor?.lastChecked || new Date(),
        memoryUsageMB: session.memoryUsageMB,
        cpuUsagePercent: session.cpuUsagePercent,
        ageMs
      });
    }
    
    return healthStatuses;
  }

  /**
   * Send input to a running process
   * @param pid Process ID
   * @param input Text to send to the process
   * @returns Whether input was successfully sent
   */
  sendInputToProcess(pid: number, input: string): boolean {
    const session = this.sessions.get(pid);
    if (!session) {
      return false;
    }
    
    try {
      if (session.process.stdin && !session.process.stdin.destroyed) {
        // Ensure input ends with a newline for most REPLs
        const inputWithNewline = input.endsWith('\n') ? input : input + '\n';
        session.process.stdin.write(inputWithNewline);
        this.updateSessionActivity(pid);
        return true;
      }
      return false;
    } catch (error) {
      console.error(`Error sending input to process ${pid}:`, error);
      return false;
    }
  }
  
  async executeCommand(command: string, timeoutMs: number = DEFAULT_COMMAND_TIMEOUT, shell?: string, signal?: AbortSignal): Promise<CommandExecutionResult> {
    // Check session limits before creating new session
    if (this.sessions.size >= this.sessionConfig.maxActiveSessions) {
      await this.enforceSessionLimits();
    }
    
    // Get the shell from config if not specified
    let shellToUse: string | boolean | undefined = shell;
    if (!shellToUse) {
      try {
        const config = await configManager.getConfig();
        shellToUse = config.defaultShell || true;
      } catch (error) {
        // If there's an error getting the config, fall back to default
        shellToUse = true;
      }
    }
    
    // For REPL interactions, we need to ensure stdin, stdout, and stderr are properly configured
    // Note: No special stdio options needed here, Node.js handles pipes by default
    
    // Enhance SSH commands automatically
    let enhancedCommand = command;
    if (command.trim().startsWith('ssh ') && !command.includes(' -t')) {
      enhancedCommand = command.replace(/^ssh /, 'ssh -t ');
      console.log(`Enhanced SSH command: ${enhancedCommand}`);
    }
    
    const spawnOptions: any = { 
      shell: shellToUse,
      env: {
        ...process.env,
        TERM: 'xterm-256color'  // Better terminal compatibility
      }
    };
    
    // Spawn the process with an empty array of arguments and our options
    const childProcess = spawn(enhancedCommand, [], spawnOptions);
    let output = '';
    
    // Ensure childProcess.pid is defined before proceeding
    if (!childProcess.pid) {
      // Return a consistent error object instead of throwing
      return {
        pid: -1,  // Use -1 to indicate an error state
        output: 'Error: Failed to get process ID. The command could not be executed.',
        isBlocked: false
      };
    }
    
    const now = new Date();
    const session: TerminalSession = {
      pid: childProcess.pid,
      process: childProcess,
      lastOutput: '',
      isBlocked: false,
      startTime: now,
      lastActivityTime: now,
      isHealthy: true
    };
    
    this.sessions.set(childProcess.pid, session);
    this.trackSessionAccess(childProcess.pid);

    return new Promise((resolve, reject) => {
      let resolved = false;
      let periodicCheck: NodeJS.Timeout | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      
      // Quick prompt patterns for immediate detection
      const quickPromptPatterns = />>>\s*$|>\s*$|\$\s*$|#\s*$/;
      
      const cleanup = () => {
        if (periodicCheck) clearInterval(periodicCheck);
        if (timeoutId) clearTimeout(timeoutId);
        if (childProcess.pid) {
          this.sessions.delete(childProcess.pid);
          this.resourceMonitors.delete(childProcess.pid);
          this.sessionAccessOrder = this.sessionAccessOrder.filter(p => p !== childProcess.pid);
        }
      };
      
      const resolveOnce = (result: CommandExecutionResult) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };

      // Handle cancellation via AbortSignal
      if (signal) {
        signal.addEventListener('abort', () => {
          if (resolved) return;
          resolved = true;
          
          // Kill the child process if it's still running
          if (childProcess.pid && !childProcess.killed) {
            try {
              childProcess.kill('SIGTERM');
              // Force kill after a brief delay if still running
              setTimeout(() => {
                if (!childProcess.killed) {
                  childProcess.kill('SIGKILL');
                }
              }, 1000);
            } catch (error) {
              console.error(`Error killing process ${childProcess.pid}:`, error);
            }
          }
          
          cleanup();
          const error = new Error('Operation was cancelled');
          error.name = 'AbortError';
          reject(error);
        });
      }

      childProcess.stdout.on('data', (data: any) => {
        const text = data.toString();
        output += text;
        session.lastOutput += text;
        this.updateSessionActivity(childProcess.pid!);
        
        // Immediate check for obvious prompts
        if (quickPromptPatterns.test(text)) {
          session.isBlocked = true;
          resolveOnce({
            pid: childProcess.pid!,
            output,
            isBlocked: true
          });
        }
      });

      childProcess.stderr.on('data', (data: any) => {
        const text = data.toString();
        output += text;
        session.lastOutput += text;
        this.updateSessionActivity(childProcess.pid!);
      });

      // Periodic comprehensive check every 100ms
      periodicCheck = setInterval(() => {
        if (output.trim()) {
          const processState = analyzeProcessState(output, childProcess.pid);
          if (processState.isWaitingForInput) {
            session.isBlocked = true;
            resolveOnce({
              pid: childProcess.pid!,
              output,
              isBlocked: true
            });
          }
        }
      }, 100);

      // Timeout fallback
      timeoutId = setTimeout(() => {
        session.isBlocked = true;
        resolveOnce({
          pid: childProcess.pid!,
          output,
          isBlocked: true
        });
      }, timeoutMs);

      childProcess.on('exit', (code: any) => {
        if (childProcess.pid) {
          // Store completed session before removing active session
          this.completedSessions.set(childProcess.pid, {
            pid: childProcess.pid,
            output: output + session.lastOutput, // Combine all output
            exitCode: code,
            startTime: session.startTime,
            endTime: new Date(),
            maxMemoryUsageMB: session.memoryUsageMB,
            reasonForCompletion: 'exit'
          });
          
          // Keep only configured number of completed sessions
          if (this.completedSessions.size > this.sessionConfig.maxCompletedSessions) {
            const oldestKey = Array.from(this.completedSessions.keys())[0];
            this.completedSessions.delete(oldestKey);
          }
          
          this.sessions.delete(childProcess.pid);
          this.resourceMonitors.delete(childProcess.pid);
          this.sessionAccessOrder = this.sessionAccessOrder.filter(p => p !== childProcess.pid);
        }
        resolveOnce({
          pid: childProcess.pid!,
          output,
          isBlocked: false
        });
      });
    });
  }

  getNewOutput(pid: number): string | null {
    // Track access for LRU
    this.trackSessionAccess(pid);
    
    // First check active sessions
    const session = this.sessions.get(pid);
    if (session) {
      const output = session.lastOutput;
      session.lastOutput = '';
      this.updateSessionActivity(pid);
      return output;
    }

    // Then check completed sessions
    const completedSession = this.completedSessions.get(pid);
    if (completedSession) {
      // Format completion message with exit code and runtime
      const runtime = (completedSession.endTime.getTime() - completedSession.startTime.getTime()) / 1000;
      return `Process completed with exit code ${completedSession.exitCode} (${completedSession.reasonForCompletion})\nRuntime: ${runtime}s\nFinal output:\n${completedSession.output}`;
    }

    return null;
  }

  /**
   * Get a session by PID
   * @param pid Process ID
   * @returns The session or undefined if not found
   */
  getSession(pid: number): TerminalSession | undefined {
    this.trackSessionAccess(pid);
    return this.sessions.get(pid);
  }

  forceTerminate(pid: number): boolean {
    const session = this.sessions.get(pid);
    if (!session) {
      return false;
    }

    try {
      session.process.kill('SIGINT');
      setTimeout(() => {
        if (this.sessions.has(pid)) {
          session.process.kill('SIGKILL');
        }
      }, 1000);
      return true;
    } catch (error) {
      // Convert error to string, handling both Error objects and other types
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to terminate process ${pid}:`, errorMessage);
      return false;
    }
  }

  listActiveSessions(): ActiveSession[] {
    const now = new Date();
    return Array.from(this.sessions.values()).map(session => ({
      pid: session.pid,
      isBlocked: session.isBlocked,
      runtime: now.getTime() - session.startTime.getTime(),
      lastActivityTime: session.lastActivityTime,
      memoryUsageMB: session.memoryUsageMB,
      isHealthy: session.isHealthy
    }));
  }

  listCompletedSessions(): CompletedSession[] {
    return Array.from(this.completedSessions.values());
  }

  /**
   * Get current session configuration
   */
  getSessionConfig(): SessionConfig {
    return { ...this.sessionConfig };
  }

  /**
   * Cleanup all active sessions for graceful shutdown
   * Terminates all running processes and clears session data
   */
  async cleanup(): Promise<void> {
    console.error('[TerminalManager] Starting cleanup of all active sessions...');
    this.isShuttingDown = true;
    
    // Stop background tasks
    this.stopBackgroundTasks();
    
    const activeSessions = Array.from(this.sessions.values());
    if (activeSessions.length === 0) {
      console.error('[TerminalManager] No active sessions to cleanup');
      return;
    }

    console.error(`[TerminalManager] Terminating ${activeSessions.length} active sessions`);
    
    // Create array of cleanup promises
    const cleanupPromises = activeSessions.map(session => {
      return new Promise<void>((resolve) => {
        const pid = session.pid;
        
        try {
          // First try graceful termination with SIGTERM
          session.process.kill('SIGTERM');
          
          // Set up timeout for force kill
          const forceKillTimeout = setTimeout(() => {
            try {
              if (!session.process.killed) {
                session.process.kill('SIGKILL');
                console.error(`[TerminalManager] Force killed process ${pid}`);
              }
            } catch (error) {
              console.error(`[TerminalManager] Error force killing process ${pid}:`, error);
            }
            resolve();
          }, 2000); // 2 second timeout for graceful termination

          // Listen for process exit
          session.process.on('exit', () => {
            clearTimeout(forceKillTimeout);
            console.error(`[TerminalManager] Process ${pid} terminated gracefully`);
            resolve();
          });
          
        } catch (error) {
          console.error(`[TerminalManager] Error terminating process ${pid}:`, error);
          resolve();
        }
      });
    });

    // Wait for all processes to terminate or timeout
    try {
      await Promise.all(cleanupPromises);
      console.error('[TerminalManager] All processes terminated');
    } catch (error) {
      console.error('[TerminalManager] Error during process cleanup:', error);
    }

    // Clear session maps
    this.sessions.clear();
    this.completedSessions.clear();
    this.resourceMonitors.clear();
    this.sessionAccessOrder = [];
    console.error('[TerminalManager] Cleanup completed');
  }
}

export const terminalManager = new TerminalManager();