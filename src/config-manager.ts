import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import { mkdir } from 'fs/promises';
import os from 'os';
import { VERSION } from './version.js';
import { CONFIG_FILE } from './config.js';
import { SessionConfig } from './types.js';

export interface ServerConfig {
  blockedCommands?: string[];
  defaultShell?: string;
  allowedDirectories?: string[];
  fileWriteLineLimit?: number; // Line limit for file write operations
  fileReadLineLimit?: number; // Default line limit for file read operations (changed from character-based)
  currentClient?: ClientInfo; // Current connected client information
  sessionManagement?: SessionConfig; // Session management configuration
  [key: string]: any; // Allow for arbitrary configuration keys
}

export interface ClientInfo {
  name: string;
  version: string;
}

/**
 * Singleton config manager for the server
 */
class ConfigManager {
  private configPath: string;
  private config: ServerConfig = {};
  private initialized = false;

  constructor() {
    // Get user's home directory
    // Define config directory and file paths
    this.configPath = CONFIG_FILE;
  }

  /**
   * Initialize configuration - load from disk or create default
   */
  async init() {
    if (this.initialized) return;

    try {
      // Ensure config directory exists
      const configDir = path.dirname(this.configPath);
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }

      // Check if config file exists
      try {
        await fs.access(this.configPath);
        // Load existing config
        const configData = await fs.readFile(this.configPath, 'utf8');
        this.config = JSON.parse(configData);
      } catch (error) {
        // Config file doesn't exist, create default
        this.config = this.getDefaultConfig();
        await this.saveConfig();
      }
      this.config['version'] = VERSION;

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize config:', error);
      // Fall back to default config in memory
      this.config = this.getDefaultConfig();
      this.initialized = true;
    }
  }

  /**
   * Alias for init() to maintain backward compatibility
   */
  async loadConfig() {
    return this.init();
  }

  /**
   * Get default session management configuration
   */
  private getDefaultSessionConfig(): SessionConfig {
    return {
      maxActiveSessions: parseInt(process.env.MAX_ACTIVE_SESSIONS || '50'),
      maxCompletedSessions: parseInt(process.env.MAX_COMPLETED_SESSIONS || '100'),
      sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS || '1800000'), // 30 minutes
      cleanupIntervalMs: parseInt(process.env.CLEANUP_INTERVAL_MS || '300000'), // 5 minutes
      healthCheckIntervalMs: parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '60000'), // 1 minute
      memoryWarningThresholdMB: parseInt(process.env.MEMORY_WARNING_THRESHOLD_MB || '100'),
      memoryCriticalThresholdMB: parseInt(process.env.MEMORY_CRITICAL_THRESHOLD_MB || '200'),
      enableResourceMonitoring: process.env.ENABLE_RESOURCE_MONITORING !== 'false'
    };
  }

  /**
   * Create default configuration
   */
  private getDefaultConfig(): ServerConfig {
    return {
      blockedCommands: [

        // Disk and partition management
        "mkfs",      // Create a filesystem on a device
        "format",    // Format a storage device (cross-platform)
        "mount",     // Mount a filesystem
        "umount",    // Unmount a filesystem
        "fdisk",     // Manipulate disk partition tables
        "dd",        // Convert and copy files, can write directly to disks
        "parted",    // Disk partition manipulator
        "diskpart",  // Windows disk partitioning utility
        
        // System administration and user management
        "sudo",      // Execute command as superuser
        "su",        // Substitute user identity
        "passwd",    // Change user password
        "adduser",   // Add a user to the system
        "useradd",   // Create a new user
        "usermod",   // Modify user account
        "groupadd",  // Create a new group
        "chsh",      // Change login shell
        "visudo",    // Edit the sudoers file
        
        // System control
        "shutdown",  // Shutdown the system
        "reboot",    // Restart the system
        "halt",      // Stop the system
        "poweroff",  // Power off the system
        "init",      // Change system runlevel
        
        // Network and security
        "iptables",  // Linux firewall administration
        "firewall",  // Generic firewall command
        "netsh",     // Windows network configuration
        
        // Windows system commands
        "sfc",       // System File Checker
        "bcdedit",   // Boot Configuration Data editor
        "reg",       // Windows registry editor
        "net",       // Network/user/service management
        "sc",        // Service Control manager
        "runas",     // Execute command as another user
        "cipher",    // Encrypt/decrypt files or wipe data
        "takeown"    // Take ownership of files
      ],
      defaultShell: os.platform() === 'win32' ? 'powershell.exe' : '/bin/sh',
      allowedDirectories: [],
      fileWriteLineLimit: 50,  // Default line limit for file write operations (changed from 100)
      fileReadLineLimit: 1000, // Default line limit for file read operations (changed from character-based)
      sessionManagement: this.getDefaultSessionConfig()
    };
  }

  /**
   * Save config to disk
   */
  private async saveConfig() {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (error) {
      console.error('Failed to save config:', error);
      throw error;
    }
  }

  /**
   * Get the entire config
   */
  async getConfig(): Promise<ServerConfig> {
    await this.init();
    return { ...this.config };
  }

  /**
   * Get a specific configuration value
   */
  async getValue(key: string): Promise<any> {
    await this.init();
    return this.config[key];
  }

  /**
   * Set a specific configuration value
   */
  async setValue(key: string, value: any): Promise<void> {
    await this.init();
    
    // Update the value
    this.config[key] = value;
    await this.saveConfig();
  }

  /**
   * Update multiple configuration values at once
   */
  async updateConfig(updates: Partial<ServerConfig>): Promise<ServerConfig> {
    await this.init();
    this.config = { ...this.config, ...updates };
    await this.saveConfig();
    return { ...this.config };
  }

  /**
   * Get session management configuration
   */
  async getSessionConfig(): Promise<SessionConfig> {
    await this.init();
    return this.config.sessionManagement || this.getDefaultSessionConfig();
  }

  /**
   * Update session management configuration
   */
  async updateSessionConfig(updates: Partial<SessionConfig>): Promise<SessionConfig> {
    await this.init();
    const currentSessionConfig = this.config.sessionManagement || this.getDefaultSessionConfig();
    const newSessionConfig = { ...currentSessionConfig, ...updates };
    
    // Validate configuration values
    if (newSessionConfig.maxActiveSessions < 1 || newSessionConfig.maxActiveSessions > 1000) {
      throw new Error('maxActiveSessions must be between 1 and 1000');
    }
    if (newSessionConfig.sessionTimeoutMs < 60000) { // Minimum 1 minute
      throw new Error('sessionTimeoutMs must be at least 60000ms (1 minute)');
    }
    if (newSessionConfig.cleanupIntervalMs < 30000) { // Minimum 30 seconds
      throw new Error('cleanupIntervalMs must be at least 30000ms (30 seconds)');
    }
    
    this.config.sessionManagement = newSessionConfig;
    await this.saveConfig();
    return { ...newSessionConfig };
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfig(): Promise<ServerConfig> {
    this.config = this.getDefaultConfig();
    await this.saveConfig();
    return { ...this.config };
  }
}

// Export singleton instance
export const configManager = new ConfigManager();