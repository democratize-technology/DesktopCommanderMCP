import { ChildProcess } from 'child_process';
import { FilteredStdioServerTransport } from './custom-stdio.js';

declare global {
  var mcpTransport: FilteredStdioServerTransport | undefined;
}

export interface ProcessInfo {
  pid: number;
  command: string;
  cpu: string;
  memory: string;
}

export interface TerminalSession {
  pid: number;
  process: ChildProcess;
  lastOutput: string;
  isBlocked: boolean;
  startTime: Date;
  lastActivityTime: Date;
  memoryUsageMB?: number;
  cpuUsagePercent?: number;
  isHealthy: boolean;
}

export interface CommandExecutionResult {
  pid: number;
  output: string;
  isBlocked: boolean;
}

export interface ActiveSession {
  pid: number;
  isBlocked: boolean;
  runtime: number;
  lastActivityTime: Date;
  memoryUsageMB?: number;
  isHealthy: boolean;
}

export interface CompletedSession {
  pid: number;
  output: string;
  exitCode: number | null;
  startTime: Date;
  endTime: Date;
  maxMemoryUsageMB?: number;
  reasonForCompletion: 'exit' | 'timeout' | 'killed' | 'error' | 'lru-evicted';
}

// Define the server response types
export interface ServerResponseContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface ServerResult {
  content: ServerResponseContent[];
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

// Session management configuration
export interface SessionConfig {
  maxActiveSessions: number;
  maxCompletedSessions: number;
  sessionTimeoutMs: number;
  cleanupIntervalMs: number;
  healthCheckIntervalMs: number;
  memoryWarningThresholdMB: number;
  memoryCriticalThresholdMB: number;
  enableResourceMonitoring: boolean;
}

// Session diagnostics for monitoring
export interface SessionDiagnostics {
  activeSessions: number;
  completedSessions: number;
  memoryUsageMB: number;
  oldestSessionAge: number;
  unhealthySessions: number;
  lastCleanupTime: Date;
  resourcePressure: 'low' | 'medium' | 'high' | 'critical';
}

// Health monitoring status
export interface SessionHealth {
  pid: number;
  isHealthy: boolean;
  issues: string[];
  lastChecked: Date;
  memoryUsageMB?: number;
  cpuUsagePercent?: number;
  ageMs: number;
}

// Define a helper type for tool handler functions
export type ToolHandler<T = unknown> = (args: T) => Promise<ServerResult>;
