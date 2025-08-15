/**
 * Resource Lifecycle Management Interfaces
 * 
 * Provides standardized interfaces for component resource management,
 * enabling centralized coordination of cleanup and monitoring.
 */

export interface ResourceInfo {
  /** Component identifier */
  id: string;
  /** Component type for categorization */
  type: 'terminal' | 'transport' | 'process' | 'timer' | 'network' | 'custom';
  /** Human-readable description */
  description: string;
  /** Current resource usage statistics */
  usage: ResourceUsage;
  /** Health status */
  isHealthy: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last activity timestamp */
  lastActivity: Date;
}

export interface ResourceUsage {
  /** Memory usage in MB (if applicable) */
  memoryMB?: number;
  /** CPU usage percentage (if applicable) */
  cpuPercent?: number;
  /** Number of active connections/sessions */
  activeConnections?: number;
  /** Number of pending operations */
  pendingOperations?: number;
  /** Custom metrics specific to the resource type */
  customMetrics?: Record<string, number>;
}

export interface ResourceHealthCheck {
  /** Whether the resource is healthy */
  isHealthy: boolean;
  /** Issues detected (empty if healthy) */
  issues: string[];
  /** Last health check timestamp */
  lastChecked: Date;
  /** Recommended actions for unhealthy resources */
  recommendations?: string[];
}

/**
 * Interface that all managed components must implement
 * for standardized resource lifecycle management
 */
export interface ResourceLifecycle {
  /**
   * Get current resource information
   */
  getResourceInfo(): ResourceInfo;

  /**
   * Perform health check on the resource
   */
  performHealthCheck(): Promise<ResourceHealthCheck>;

  /**
   * Graceful cleanup of all resources
   * Should release resources in an orderly fashion
   */
  cleanup(): Promise<void>;

  /**
   * Force cleanup when graceful cleanup fails
   * Should aggressively release all resources
   */
  forceCleanup(): Promise<void>;

  /**
   * Check if cleanup has been completed
   */
  isCleanedUp(): boolean;

  /**
   * Update resource configuration at runtime
   * @param config Partial configuration updates
   */
  updateConfiguration?(config: Record<string, any>): Promise<void>;
}

/**
 * Priority levels for cleanup order
 * Lower numbers are cleaned up first
 */
export enum CleanupPriority {
  /** Critical system resources (terminal sessions, child processes) */
  CRITICAL = 1,
  /** Transport and I/O resources */
  TRANSPORT = 2,
  /** Background tasks and monitoring */
  BACKGROUND = 3,
  /** System resources and logging */
  SYSTEM = 4
}

/**
 * Resource registration information
 */
export interface ResourceRegistration {
  /** The resource component */
  component: ResourceLifecycle;
  /** Cleanup priority */
  priority: CleanupPriority;
  /** Optional timeout for cleanup operations (ms) */
  cleanupTimeoutMs?: number;
  /** Whether this resource is critical for system operation */
  isCritical?: boolean;
}

/**
 * System-wide health information
 */
export interface SystemHealthInfo {
  /** Overall system health status */
  status: 'healthy' | 'degraded' | 'critical' | 'failing';
  /** Total number of registered components */
  totalComponents: number;
  /** Number of healthy components */
  healthyComponents: number;
  /** Number of unhealthy components */
  unhealthyComponents: number;
  /** System resource usage summary */
  systemUsage: ResourceUsage;
  /** Critical issues affecting system operation */
  criticalIssues: string[];
  /** Warnings that don't affect operation */
  warnings: string[];
  /** Last health check timestamp */
  lastChecked: Date;
  /** Uptime in milliseconds */
  uptimeMs: number;
}

/**
 * Resource monitoring configuration
 */
export interface ResourceMonitoringConfig {
  /** Enable/disable resource monitoring */
  enabled: boolean;
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Memory warning threshold in MB */
  memoryWarningThresholdMB: number;
  /** Memory critical threshold in MB */
  memoryCriticalThresholdMB: number;
  /** CPU warning threshold percentage */
  cpuWarningThresholdPercent: number;
  /** CPU critical threshold percentage */
  cpuCriticalThresholdPercent: number;
  /** Enable detailed logging */
  enableDetailedLogging: boolean;
  /** Cleanup timeout in milliseconds */
  cleanupTimeoutMs: number;
  /** Force cleanup timeout in milliseconds */
  forceCleanupTimeoutMs: number;
}

/**
 * Resource manager events
 */
export interface ResourceManagerEvents {
  /** Emitted when a component is registered */
  'component-registered': { id: string; type: string; priority: CleanupPriority };
  /** Emitted when a component is unregistered */
  'component-unregistered': { id: string; reason: string };
  /** Emitted when health check detects issues */
  'health-warning': { componentId: string; issues: string[] };
  /** Emitted when a component becomes unhealthy */
  'health-critical': { componentId: string; issues: string[] };
  /** Emitted during shutdown process */
  'shutdown-started': { graceful: boolean; totalComponents: number };
  /** Emitted when shutdown completes */
  'shutdown-completed': { success: boolean; duration: number };
  /** Emitted when a cleanup operation times out */
  'cleanup-timeout': { componentId: string; priority: CleanupPriority };
}

/**
 * Diagnostic information for troubleshooting
 */
export interface DiagnosticInfo {
  /** System overview */
  system: SystemHealthInfo;
  /** Per-component details */
  components: Array<{
    id: string;
    info: ResourceInfo;
    health: ResourceHealthCheck;
    registration: Omit<ResourceRegistration, 'component'>;
  }>;
  /** Resource usage history (if tracking enabled) */
  usageHistory?: Array<{
    timestamp: Date;
    usage: ResourceUsage;
  }>;
  /** Recent events and errors */
  recentEvents: Array<{
    timestamp: Date;
    level: 'info' | 'warning' | 'error';
    message: string;
    data?: any;
  }>;
}