#!/usr/bin/env node

import { FilteredStdioServerTransport } from './custom-stdio.js';
import { server } from './server.js';
import { commandManager } from './command-manager.js';
import { configManager } from './config-manager.js';
import { terminalManager } from './terminal-manager.js';
import { resourceManager } from './resource-manager.js';
import { TerminalManagerAdapter } from './adapters/terminal-manager-adapter.js';
import { TransportAdapter } from './adapters/transport-adapter.js';
import { ProcessToolsAdapter } from './adapters/process-tools-adapter.js';
import { CleanupPriority } from './interfaces/resource-lifecycle.js';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { platform } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const isWindows = platform() === 'win32';

// Helper function to properly convert file paths to URLs, especially for Windows
function createFileURL(filePath: string): URL {
  if (isWindows) {
    // Ensure path uses forward slashes for URL format
    const normalizedPath = filePath.replace(/\\/g, '/');
    // Ensure path has proper file:// prefix
    if (normalizedPath.startsWith('/')) {
      return new URL(`file://${normalizedPath}`);
    } else {
      return new URL(`file:///${normalizedPath}`);
    }
  } else {
    // For non-Windows, we can use the built-in function
    return pathToFileURL(filePath);
  }
}

async function runSetup() {
  try {
    // Fix for Windows ESM path issue
    const setupScriptPath = join(__dirname, 'setup-claude-server.js');
    const setupScriptUrl = createFileURL(setupScriptPath);

    // Now import using the URL format
    const { default: setupModule } = await import(setupScriptUrl.href);
    if (typeof setupModule === 'function') {
      await setupModule();
    }
  } catch (error) {
    console.error('Error running setup:', error);
    process.exit(1);
  }
}

// Graceful shutdown configuration
const SHUTDOWN_TIMEOUT_MS = 25000; // 25 seconds for Kubernetes compatibility
let isShuttingDown = false;
let shutdownTimeout: NodeJS.Timeout | null = null;

/**
 * Coordinated graceful shutdown sequence using ResourceManager
 * Delegates to centralized resource management for priority-based cleanup
 */
async function gracefulShutdown(signal: string): Promise<void> {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    console.error(`[shutdown] Already shutting down, ignoring ${signal}`);
    return;
  }
  
  isShuttingDown = true;
  console.error(`[shutdown] Received ${signal}, initiating graceful shutdown...`);
  
  // Set up force shutdown timeout
  shutdownTimeout = setTimeout(() => {
    console.error('[shutdown] Force shutdown timeout reached, exiting immediately');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    console.error('[shutdown] Delegating to ResourceManager for coordinated cleanup...');
    
    // Delegate to ResourceManager for priority-based cleanup
    await resourceManager.shutdown(true); // graceful=true
    
    // Cleanup global resources that aren't managed by ResourceManager
    console.error('[shutdown] Cleaning up global resources...');
    if (global.mcpTransport) {
      delete global.mcpTransport;
    }
    
    // Clear shutdown timeout and exit cleanly
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
    
    console.error('[shutdown] Graceful shutdown completed successfully');
    process.exit(0);
    
  } catch (error) {
    console.error('[shutdown] Error during graceful shutdown:', error);
    
    // Try force shutdown as fallback
    try {
      console.error('[shutdown] Attempting force shutdown...');
      await resourceManager.shutdown(false); // graceful=false
    } catch (forceError) {
      console.error('[shutdown] Force shutdown also failed:', forceError);
    }
    
    // Clear timeout and force exit
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
    
    console.error('[shutdown] Forced shutdown due to cleanup errors');
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown signal handlers
 * Handles both SIGTERM (orchestrators) and SIGINT (Ctrl+C)
 */
function setupShutdownHandlers(): void {
  // SIGTERM: Graceful termination (Docker, Kubernetes, process managers)
  process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM').catch((error) => {
      console.error('[shutdown] Error in SIGTERM handler:', error);
      process.exit(1);
    });
  });
  
  // SIGINT: Interrupt signal (Ctrl+C)
  process.on('SIGINT', () => {
    gracefulShutdown('SIGINT').catch((error) => {
      console.error('[shutdown] Error in SIGINT handler:', error);
      process.exit(1);
    });
  });
  
  console.error('[shutdown] Graceful shutdown handlers registered');
}

async function runServer() {
  try {
    // Check if first argument is "setup"
    if (process.argv[2] === 'setup') {
      await runSetup();
      return;
    }

    // Setup graceful shutdown handlers early in the process
    setupShutdownHandlers();

    const transport = new FilteredStdioServerTransport();
    
    // Export transport for use throughout the application
    global.mcpTransport = transport;
    
    // Initialize ResourceManager and register components
    await initializeResourceManager(transport);

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If this is a JSON parsing error, log it to stderr but don't crash
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        process.stderr.write(`[desktop-commander] JSON parsing error: ${errorMessage}\n`);
        return; // Don't exit on JSON parsing errors
      }

      process.stderr.write(`[desktop-commander] Uncaught exception: ${errorMessage}\n`);
      process.exit(1);
    });

    // Handle unhandled rejections
    process.on('unhandledRejection', (reason) => {
      const errorMessage = reason instanceof Error ? reason.message : String(reason);

      // If this is a JSON parsing error, log it to stderr but don't crash
      if (errorMessage.includes('JSON') && errorMessage.includes('Unexpected token')) {
        process.stderr.write(`[desktop-commander] JSON parsing rejection: ${errorMessage}\n`);
        return; // Don't exit on JSON parsing errors
      }

      process.stderr.write(`[desktop-commander] Unhandled rejection: ${errorMessage}\n`);
      process.exit(1);
    });

    try {
      console.error("Loading configuration...");
      await configManager.loadConfig();
      console.error("Configuration loaded successfully");
    } catch (configError) {
      console.error(`Failed to load configuration: ${configError instanceof Error ? configError.message : String(configError)}`);
      console.error(configError instanceof Error && configError.stack ? configError.stack : 'No stack trace available');
      console.error("Continuing with in-memory configuration only");
      // Continue anyway - we'll use an in-memory config
    }

    console.error("Connecting server...");
    await server.connect(transport);
    console.error("Server connected successfully");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`FATAL ERROR: ${errorMessage}`);
    console.error(error instanceof Error && error.stack ? error.stack : 'No stack trace available');
    process.stderr.write(JSON.stringify({
      type: 'error',
      timestamp: new Date().toISOString(),
      message: `Failed to start server: ${errorMessage}`
    }) + '\n');

    process.exit(1);
  }
}

runServer().catch((error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(`RUNTIME ERROR: ${errorMessage}`);
  console.error(error instanceof Error && error.stack ? error.stack : 'No stack trace available');
  process.stderr.write(JSON.stringify({
    type: 'error',
    timestamp: new Date().toISOString(),
    message: `Fatal error running server: ${errorMessage}`
  }) + '\n');

  process.exit(1);
});

/**
 * Initialize ResourceManager and register all system components
 */
async function initializeResourceManager(transport: FilteredStdioServerTransport): Promise<void> {
  try {
    console.error('[startup] Registering components with ResourceManager...');
    
    // Create adapters for existing components
    const terminalAdapter = new TerminalManagerAdapter(terminalManager);
    const transportAdapter = new TransportAdapter(transport);
    const processToolsAdapter = new ProcessToolsAdapter();
    
    // Register components with appropriate priorities
    resourceManager.register(
      'terminal-manager',
      terminalAdapter,
      CleanupPriority.CRITICAL,
      { 
        cleanupTimeoutMs: 15000, // Longer timeout for terminal cleanup
        isCritical: true 
      }
    );
    
    resourceManager.register(
      'stdio-transport',
      transportAdapter,
      CleanupPriority.TRANSPORT,
      { 
        cleanupTimeoutMs: 5000,
        isCritical: true 
      }
    );
    
    resourceManager.register(
      'process-tools',
      processToolsAdapter,
      CleanupPriority.BACKGROUND,
      { 
        cleanupTimeoutMs: 8000,
        isCritical: false 
      }
    );
    
    // Export the process tools adapter globally for process tools to register with
    (global as any).processToolsAdapter = processToolsAdapter;
    
    // Set up resource monitoring event handlers
    resourceManager.on('health-critical', (event) => {
      console.error(`[ResourceManager] CRITICAL: Component ${event.componentId} has critical issues:`, event.issues);
    });
    
    resourceManager.on('health-warning', (event) => {
      console.error(`[ResourceManager] WARNING: Component ${event.componentId} has warnings:`, event.issues);
    });
    
    resourceManager.on('cleanup-timeout', (event) => {
      console.error(`[ResourceManager] TIMEOUT: Component ${event.componentId} (priority ${event.priority}) cleanup timed out`);
    });
    
    console.error(`[startup] ResourceManager initialized with ${resourceManager.getRegisteredComponents().length} components`);
    
    // Log initial system health
    const initialHealth = await resourceManager.getSystemHealth();
    console.error(`[startup] Initial system health: ${initialHealth.status}`);
    
  } catch (error) {
    console.error('[startup] Failed to initialize ResourceManager:', error);
    throw error;
  }
}

// Export shutdown state and resource manager for other modules to check
export { isShuttingDown, resourceManager };
