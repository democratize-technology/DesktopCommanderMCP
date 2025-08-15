import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import process from "node:process";

interface LogNotification {
  jsonrpc: "2.0";
  method: "notifications/message";
  params: {
    level: "emergency" | "alert" | "critical" | "error" | "warning" | "notice" | "info" | "debug";
    logger?: string;
    data: any;
  };
}

/**
 * Enhanced StdioServerTransport that filters console output to prevent
 * polluting the JSON-RPC stream while preserving stderr for debugging.
 */
export class FilteredStdioServerTransport extends StdioServerTransport {
  private originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
    debug: typeof console.debug;
    info: typeof console.info;
  };
  private originalStdoutWrite: typeof process.stdout.write;

  constructor() {
    super();
    
    // Store original methods
    this.originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
      info: console.info,
    };
    
    this.originalStdoutWrite = process.stdout.write;
    
    // Setup console redirection - but NOT for console.error!
    this.setupConsoleRedirection();
    
    // Setup stdout filtering for any other output
    this.setupStdoutFiltering();
    
    // Log initialization to stderr to avoid polluting the JSON stream
    process.stderr.write(`[desktop-commander] FilteredStdioServerTransport initialized\n`);
  }

  private setupConsoleRedirection() {
    // Redirect console.log to stderr to prevent stdout pollution
    console.log = (...args: any[]) => {
      process.stderr.write(`[LOG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
    };

    console.info = (...args: any[]) => {
      process.stderr.write(`[INFO] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
    };

    console.warn = (...args: any[]) => {
      process.stderr.write(`[WARN] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
    };

    // CRITICAL: Keep console.error going to stderr, NOT as JSON-RPC notifications!
    console.error = (...args: any[]) => {
      process.stderr.write(`[ERROR] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
    };

    console.debug = (...args: any[]) => {
      process.stderr.write(`[DEBUG] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`);
    };
  }

  private setupStdoutFiltering() {
    process.stdout.write = (buffer: any, encoding?: any, callback?: any): boolean => {
      // Handle different call signatures
      if (typeof buffer === 'string') {
        const trimmed = buffer.trim();
        
        // Check if this looks like a valid JSON-RPC message
        if (trimmed.startsWith('{') && (
          trimmed.includes('"jsonrpc"') || 
          trimmed.includes('"method"') || 
          trimmed.includes('"id"')
        )) {
          // This looks like a valid JSON-RPC message, allow it
          return this.originalStdoutWrite.call(process.stdout, buffer, encoding, callback);
        } else if (trimmed.length > 0) {
          // Non-JSON-RPC output, send to stderr instead
          process.stderr.write(`[STDOUT] ${buffer}`);
          if (callback) callback();
          return true;
        }
      }
      
      // For non-string buffers or empty strings, let them through
      return this.originalStdoutWrite.call(process.stdout, buffer, encoding, callback);
    };
  }

  private sendLogNotification(level: LogNotification["params"]["level"], args: any[]) {
    // Convert args to a single string message
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');

    const notification: LogNotification = {
      jsonrpc: "2.0",
      method: "notifications/message",
      params: {
        level,
        logger: "desktop-commander",
        data: message,
      },
    };

    // Send the notification through the original stdout
    this.originalStdoutWrite.call(process.stdout, JSON.stringify(notification) + '\n');
  }

  /**
   * Clean up and restore original console methods
   */
  public cleanup() {
    // Restore original console methods
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;
    console.debug = this.originalConsole.debug;
    console.info = this.originalConsole.info;
    
    // Restore original stdout write
    process.stdout.write = this.originalStdoutWrite;
    
    process.stderr.write('[desktop-commander] FilteredStdioServerTransport cleaned up\n');
  }
}
