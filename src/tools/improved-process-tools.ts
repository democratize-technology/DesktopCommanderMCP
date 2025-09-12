import { terminalManager } from '../terminal-manager.js';
import { commandManager } from '../command-manager.js';
import { createErrorResponse } from '../error-handlers.js';
import { StartProcessArgsSchema, ReadProcessOutputArgsSchema, InteractWithProcessArgsSchema, ForceTerminateArgsSchema, ListSessionsArgsSchema } from './schemas.js';
import { ServerResult } from '../types.js';
import { analyzeProcessState, cleanProcessOutput, formatProcessStateMessage, ProcessState } from '../utils/process-detection.js';
import { getSystemInfo } from '../utils/system-info.js';
import * as os from 'os';
import { configManager } from '../config-manager.js';

/**
 * ResourceManager for centralized timer and event listener lifecycle management
 * Prevents resource leaks by ensuring all resources are properly cleaned up
 */
class ResourceManager {
  private timers = new Set<NodeJS.Timeout>();
  private intervals = new Set<NodeJS.Timeout>();
  private listeners = new Map<EventTarget | NodeJS.EventEmitter, Array<{ event: string; listener: (...args: any[]) => void }>>();
  private abortController?: AbortController;
  private isDisposed = false;

  constructor(signal?: AbortSignal) {
    if (signal) {
      // Create our own controller that's linked to the parent signal
      this.abortController = new AbortController();
      
      // If parent signal is already aborted, abort immediately
      if (signal.aborted) {
        this.abortController.abort();
      } else {
        // Listen for parent signal abort
        signal.addEventListener('abort', () => {
          this.abortController?.abort();
          this.cleanup();
        }, { once: true });
      }
    }

    // Register with global ProcessToolsAdapter if available
    try {
      const processToolsAdapter = (global as any).processToolsAdapter;
      if (processToolsAdapter && typeof processToolsAdapter.registerResourceManager === 'function') {
        processToolsAdapter.registerResourceManager(this);
      }
    } catch (error) {
      // Ignore registration errors - adapter may not be initialized yet
    }
  }

  get signal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  /**
   * Create a timeout with automatic cleanup tracking
   */
  setTimeout(callback: () => void, ms: number): NodeJS.Timeout {
    if (this.isDisposed) {
      throw new Error('ResourceManager is disposed');
    }

    const timeout = setTimeout(() => {
      this.timers.delete(timeout);
      if (!this.isDisposed) {
        callback();
      }
    }, ms);
    
    this.timers.add(timeout);
    return timeout;
  }

  /**
   * Create an interval with automatic cleanup tracking
   */
  setInterval(callback: () => void, ms: number): NodeJS.Timeout {
    if (this.isDisposed) {
      throw new Error('ResourceManager is disposed');
    }

    const interval = setInterval(() => {
      if (!this.isDisposed) {
        callback();
      }
    }, ms);
    
    this.intervals.add(interval);
    return interval;
  }

  /**
   * Add event listener with automatic cleanup tracking
   */
  addEventListener<T extends EventTarget | NodeJS.EventEmitter>(
    target: T, 
    event: string, 
    listener: (...args: any[]) => void,
    options?: any
  ): void {
    if (this.isDisposed) {
      throw new Error('ResourceManager is disposed');
    }

    // Wrap listener to check disposal state
    const wrappedListener = (...args: any[]) => {
      if (!this.isDisposed) {
        listener(...args);
      }
    };

    // Add listener using appropriate method
    if ('addEventListener' in target) {
      (target as EventTarget).addEventListener(event, wrappedListener, options);
    } else {
      (target as NodeJS.EventEmitter).on(event, wrappedListener);
    }

    // Track for cleanup
    if (!this.listeners.has(target)) {
      this.listeners.set(target, []);
    }
    this.listeners.get(target)!.push({ event, listener: wrappedListener });
  }

  /**
   * Remove a specific event listener
   */
  removeEventListener<T extends EventTarget | NodeJS.EventEmitter>(
    target: T,
    event: string,
    listener: (...args: any[]) => void
  ): void {
    try {
      if ('removeEventListener' in target) {
        (target as EventTarget).removeEventListener(event, listener);
      } else {
        (target as NodeJS.EventEmitter).removeListener(event, listener);
      }
    } catch (error) {
      // Ignore cleanup errors - target may be destroyed
    }
  }

  /**
   * Clean up all managed resources
   * Safe to call multiple times
   */
  cleanup(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;

    // Clear all timers
    for (const timer of this.timers) {
      try {
        clearTimeout(timer);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.timers.clear();

    // Clear all intervals
    for (const interval of this.intervals) {
      try {
        clearInterval(interval);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    this.intervals.clear();

    // Remove all event listeners
    for (const [target, listeners] of this.listeners) {
      for (const { event, listener } of listeners) {
        try {
          if ('removeEventListener' in target) {
            (target as EventTarget).removeEventListener(event, listener);
          } else {
            (target as NodeJS.EventEmitter).removeListener(event, listener);
          }
        } catch (error) {
          // Ignore cleanup errors - target may be destroyed
        }
      }
    }
    this.listeners.clear();

    // Abort our controller if we have one
    if (this.abortController && !this.abortController.signal.aborted) {
      try {
        this.abortController.abort();
      } catch (error) {
        // Ignore cleanup errors
      }
    }

    // Unregister from global ProcessToolsAdapter
    try {
      const processToolsAdapter = (global as any).processToolsAdapter;
      if (processToolsAdapter && typeof processToolsAdapter.unregisterResourceManager === 'function') {
        processToolsAdapter.unregisterResourceManager(this);
      }
    } catch (error) {
      // Ignore unregistration errors
    }
  }

  /**
   * Check if this manager is disposed
   */
  get disposed(): boolean {
    return this.isDisposed;
  }
}

/**
 * Start a new process (renamed from execute_command)
 * Includes early detection of process waiting for input
 */
export async function startProcess(args: unknown, signal?: AbortSignal): Promise<ServerResult> {
  const parsed = StartProcessArgsSchema.safeParse(args);
  if (!parsed.success) {
    return createErrorResponse(`Invalid arguments for start_process: ${parsed.error}`);
  }

  // Command validation and tracking
  try {
    const commands = commandManager.extractCommands(parsed.data.command).join(', ');
    // Process started successfully
  } catch (error) {
    // Continue with basic command processing
  }

  const isAllowed = await commandManager.validateCommand(parsed.data.command);
  if (!isAllowed) {
    return createErrorResponse(`Command not allowed: ${parsed.data.command}`);
  }

  let shellUsed: string | undefined = parsed.data.shell;

  if (!shellUsed) {
    const config = await configManager.getConfig();
    if (config.defaultShell) {
      shellUsed = config.defaultShell;
    } else {
      const isWindows = os.platform() === 'win32';
      if (isWindows && process.env.COMSPEC) {
        shellUsed = process.env.COMSPEC;
      } else if (!isWindows && process.env.SHELL) {
        shellUsed = process.env.SHELL;
      } else {
        shellUsed = isWindows ? 'cmd.exe' : '/bin/sh';
      }
    }
  }

  const result = await terminalManager.executeCommand(
    parsed.data.command,
    parsed.data.timeout_ms,
    shellUsed,
    signal
  );

  if (result.pid === -1) {
    return createErrorResponse(result.output);
  }

  // Analyze the process state to detect if it's waiting for input
  const processState = analyzeProcessState(result.output, result.pid);
  
  let statusMessage = '';
  if (processState.isWaitingForInput) {
    statusMessage = `\n🔄 ${formatProcessStateMessage(processState, result.pid)}`;
  } else if (processState.isFinished) {
    statusMessage = `\n✅ ${formatProcessStateMessage(processState, result.pid)}`;
  } else if (result.isBlocked) {
    statusMessage = '\n⏳ Process is running. Use read_process_output to get more output.';
  }

  return {
    content: [{
      type: "text",
      text: `Process started with PID ${result.pid} (shell: ${shellUsed})\nInitial output:\n${result.output}${statusMessage}`
    }],
  };
}

/**
 * Read output from a running process (renamed from read_output)
 * Includes early detection of process waiting for input
 */
export async function readProcessOutput(args: unknown, signal?: AbortSignal): Promise<ServerResult> {
  const parsed = ReadProcessOutputArgsSchema.safeParse(args);
  if (!parsed.success) {
    return createErrorResponse(`Invalid arguments for read_process_output: ${parsed.error}`);
  }

  const { pid, timeout_ms = 5000 } = parsed.data;

  const session = terminalManager.getSession(pid);
  if (!session) {
    return createErrorResponse(`No active session found for PID ${pid}`);
  }

  // Create resource manager for this operation
  const resourceManager = new ResourceManager(signal);
  
  let output = "";
  let timeoutReached = false;
  let earlyExit = false;
  let processState: ProcessState | undefined;

  try {
    // Check for cancellation before starting
    if (signal?.aborted) {
      throw new Error('Operation was cancelled');
    }

    const outputPromise: Promise<string> = new Promise<string>((resolve, reject) => {
      const initialOutput = terminalManager.getNewOutput(pid);
      if (initialOutput && initialOutput.length > 0) {
        // Immediate check on existing output
        const state = analyzeProcessState(initialOutput, pid);
        if (state.isWaitingForInput) {
          earlyExit = true;
          processState = state;
        }
        resolve(initialOutput);
        return;
      }

      let resolved = false;
      
      // Quick prompt patterns for immediate detection
      const quickPromptPatterns = />>>\s*$|>\s*$|\$\s*$|#\s*$/;

      const resolveOnce = (value: string, isTimeout = false) => {
        if (resolved) return;
        resolved = true;
        timeoutReached = isTimeout;
        resolve(value);
      };

      const rejectOnce = (error: Error) => {
        if (resolved) return;
        resolved = true;
        reject(error);
      };

      // Handle abort signal
      if (resourceManager.signal) {
        resourceManager.addEventListener(resourceManager.signal, 'abort', () => {
          rejectOnce(new Error('Operation was cancelled'));
        });
      }

      // Monitor for new output with immediate detection
      const currentSession = terminalManager.getSession(pid);
      if (currentSession && currentSession.process && currentSession.process.stdout && currentSession.process.stderr) {
        const immediateDetector = (data: Buffer) => {
          if (resolved) return;
          
          const text = data.toString();
          // Immediate check for obvious prompts
          if (quickPromptPatterns.test(text)) {
            const newOutput = terminalManager.getNewOutput(pid) || text;
            const state = analyzeProcessState(output + newOutput, pid);
            if (state.isWaitingForInput) {
              earlyExit = true;
              processState = state;
              resolveOnce(newOutput);
              return;
            }
          }
        };
        
        // Use ResourceManager to track listeners
        resourceManager.addEventListener(currentSession.process.stdout, 'data', immediateDetector);
        resourceManager.addEventListener(currentSession.process.stderr, 'data', immediateDetector);
      }

      // Set up interval for periodic checking
      resourceManager.setInterval(() => {
        if (resolved) return;
        
        const newOutput = terminalManager.getNewOutput(pid);
        if (newOutput && newOutput.length > 0) {
          const currentOutput = output + newOutput;
          const state = analyzeProcessState(currentOutput, pid);
          
          // Early exit if process is clearly waiting for input
          if (state.isWaitingForInput) {
            earlyExit = true;
            processState = state;
            resolveOnce(newOutput);
            return;
          }
          
          output = currentOutput;
          
          // Continue collecting if still running
          if (!state.isFinished) {
            return;
          }
          
          // Process finished
          processState = state;
          resolveOnce(newOutput);
        }
      }, 200); // Check every 200ms

      // Set up timeout
      resourceManager.setTimeout(() => {
        if (resolved) return;
        const finalOutput = terminalManager.getNewOutput(pid) || "";
        resolveOnce(finalOutput, true);
      }, timeout_ms);
    });

    const newOutput = await outputPromise;
    output += newOutput;
    
    // Analyze final state if not already done
    if (!processState) {
      processState = analyzeProcessState(output, pid);
    }

  } catch (error) {
    return createErrorResponse(`Error reading output: ${error}`);
  } finally {
    // Ensure all resources are cleaned up
    resourceManager.cleanup();
  }

  // Format response based on what we detected
  let statusMessage = '';
  if (earlyExit && processState?.isWaitingForInput) {
    statusMessage = `\n🔄 ${formatProcessStateMessage(processState, pid)}`;
  } else if (processState?.isFinished) {
    statusMessage = `\n✅ ${formatProcessStateMessage(processState, pid)}`;
  } else if (timeoutReached) {
    statusMessage = '\n⏱️ Timeout reached - process may still be running';
  }

  const responseText = output || 'No new output available';
  
  return {
    content: [{
      type: "text",
      text: `${responseText}${statusMessage}`
    }],
  };
}

/**
 * Interact with a running process (renamed from send_input)
 * Automatically detects when process is ready and returns output
 */
export async function interactWithProcess(args: unknown, signal?: AbortSignal): Promise<ServerResult> {
  const parsed = InteractWithProcessArgsSchema.safeParse(args);
  if (!parsed.success) {
    return createErrorResponse(`Invalid arguments for interact_with_process: ${parsed.error}`);
  }

  const { 
    pid, 
    input, 
    timeout_ms = 8000,
    wait_for_prompt = true
  } = parsed.data;
  
  // Create resource manager for this operation
  const resourceManager = new ResourceManager(signal);
  
  try {
    // Check for cancellation before starting
    if (signal?.aborted) {
      throw new Error('Operation was cancelled');
    }

    const success = terminalManager.sendInputToProcess(pid, input);
    
    if (!success) {
      return createErrorResponse(`Failed to send input to process ${pid}. The process may have exited or doesn't accept input.`);
    }

    // If not waiting for response, return immediately
    if (!wait_for_prompt) {
      return {
        content: [{
          type: "text",
          text: `✅ Input sent to process ${pid}. Use read_process_output to get the response.`
        }],
      };
    }

    // Smart waiting with immediate and periodic detection
    let output = "";
    let processState: ProcessState | undefined;
    let earlyExit = false;
    
    // Quick prompt patterns for immediate detection
    const quickPromptPatterns = />>>\s*$|>\s*$|\$\s*$|#\s*$/;
    
    const waitForResponse = (): Promise<void> => {
      return new Promise((resolve, reject) => {
        let resolved = false;
        let attempts = 0;
        const maxAttempts = Math.ceil(timeout_ms / 200);
        
        const resolveOnce = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        
        const rejectOnce = (error: Error) => {
          if (resolved) return;
          resolved = true;
          reject(error);
        };
        
        // Handle abort signal
        if (resourceManager.signal) {
          resourceManager.addEventListener(resourceManager.signal, 'abort', () => {
            rejectOnce(new Error('Operation was cancelled'));
          });
        }
        
        // Set up immediate detection on the process streams
        const session = terminalManager.getSession(pid);
        if (session && session.process && session.process.stdout && session.process.stderr) {
          const immediateDetector = (data: Buffer) => {
            if (resolved) return;
            
            const text = data.toString();
            // Immediate check for obvious prompts
            if (quickPromptPatterns.test(text)) {
              // Use ResourceManager timeout for the delayed check
              resourceManager.setTimeout(() => {
                if (resolved) return;
                
                const newOutput = terminalManager.getNewOutput(pid);
                if (newOutput) {
                  output += newOutput;
                  const state = analyzeProcessState(output, pid);
                  if (state.isWaitingForInput) {
                    processState = state;
                    earlyExit = true;
                    resolveOnce();
                  }
                }
              }, 50); // Small delay to ensure output is captured
            }
          };
          
          // Use ResourceManager to track listeners
          resourceManager.addEventListener(session.process.stdout, 'data', immediateDetector);
          resourceManager.addEventListener(session.process.stderr, 'data', immediateDetector);
        }
        
        // Periodic check as fallback
        resourceManager.setInterval(() => {
          if (resolved) return;
          
          const newOutput = terminalManager.getNewOutput(pid);
          if (newOutput && newOutput.length > 0) {
            output += newOutput;
            
            // Analyze current state
            processState = analyzeProcessState(output, pid);
            
            // Exit early if we detect the process is waiting for input
            if (processState.isWaitingForInput) {
              earlyExit = true;
              resolveOnce();
              return;
            }
            
            // Also exit if process finished
            if (processState.isFinished) {
              resolveOnce();
              return;
            }
          }
          
          attempts++;
          if (attempts >= maxAttempts) {
            resolveOnce();
          }
        }, 200);
      });
    };
    
    await waitForResponse();

    // Clean and format output
    const cleanOutput = cleanProcessOutput(output, input);
    const timeoutReached = !earlyExit && !processState?.isFinished && !processState?.isWaitingForInput;
    
    // Determine final state
    if (!processState) {
      processState = analyzeProcessState(output, pid);
    }
    
    let statusMessage = '';
    if (processState.isWaitingForInput) {
      statusMessage = `\n🔄 ${formatProcessStateMessage(processState, pid)}`;
    } else if (processState.isFinished) {
      statusMessage = `\n✅ ${formatProcessStateMessage(processState, pid)}`;
    } else if (timeoutReached) {
      statusMessage = '\n⏱️ Response may be incomplete (timeout reached)';
    }
    
    if (cleanOutput.trim().length === 0 && !timeoutReached) {
      return {
        content: [{
          type: "text",
          text: `✅ Input executed in process ${pid}.\n📭 (No output produced)${statusMessage}`
        }],
      };
    }
    
    // Format response with better structure and consistent emojis
    let responseText = `✅ Input executed in process ${pid}`;
    
    if (cleanOutput && cleanOutput.trim().length > 0) {
      responseText += `:\n\n📤 Output:\n${cleanOutput}`;
    } else {
      responseText += `.\n📭 (No output produced)`;
    }
    
    if (statusMessage) {
      responseText += `\n\n${statusMessage}`;
    }

    return {
      content: [{
        type: "text", 
        text: responseText
      }],
    };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Process interaction error:', errorMessage);
    return createErrorResponse(`Error interacting with process: ${errorMessage}`);
  } finally {
    // Ensure all resources are cleaned up
    resourceManager.cleanup();
  }
}

/**
 * Force terminate a process
 */
export async function forceTerminate(args: unknown, signal?: AbortSignal): Promise<ServerResult> {
  const parsed = ForceTerminateArgsSchema.safeParse(args);
  if (!parsed.success) {
    return createErrorResponse(`Invalid arguments for force_terminate: ${parsed.error}`);
  }

  const success = terminalManager.forceTerminate(parsed.data.pid);
  return {
    content: [{
      type: "text",
      text: success
        ? `Successfully initiated termination of session ${parsed.data.pid}`
        : `No active session found for PID ${parsed.data.pid}`
    }],
  };
}

/**
 * List active sessions
 */
export async function listSessions(signal?: AbortSignal): Promise<ServerResult> {
  const sessions = terminalManager.listActiveSessions();
  return {
    content: [{
      type: "text",
      text: sessions.length === 0
        ? 'No active sessions'
        : sessions.map(s =>
            `PID: ${s.pid}, Blocked: ${s.isBlocked}, Runtime: ${Math.round(s.runtime / 1000)}s`
          ).join('\n')
    }],
  };
}