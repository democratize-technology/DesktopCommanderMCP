#!/usr/bin/env node

/**
 * Test script for graceful shutdown functionality
 * 
 * This script tests that the MCP server properly handles SIGTERM and SIGINT
 * signals and cleans up resources correctly.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function testGracefulShutdown() {
  console.log('Testing graceful shutdown functionality...');
  
  // Path to the compiled server
  const serverPath = join(__dirname, '..', 'dist', 'index.js');
  
  console.log(`Starting server: ${serverPath}`);
  
  // Start the server process
  const serverProcess = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });

  let output = '';
  let errorOutput = '';

  // Capture server output
  serverProcess.stdout.on('data', (data) => {
    output += data.toString();
  });

  serverProcess.stderr.on('data', (data) => {
    const text = data.toString();
    errorOutput += text;
    console.log(`[server stderr]: ${text.trim()}`);
  });

  // Wait for server to start and look for specific initialization messages
  console.log('Waiting for server to initialize...');
  let serverReady = false;
  let waitTime = 0;
  const maxWaitTime = 10000; // 10 seconds max
  
  while (!serverReady && waitTime < maxWaitTime) {
    await new Promise(resolve => setTimeout(resolve, 500));
    waitTime += 500;
    
    // Check if server is fully initialized
    if (errorOutput.includes('Server connected successfully') || 
        errorOutput.includes('Enhanced FilteredStdioServerTransport initialized')) {
      serverReady = true;
    }
  }
  
  if (!serverReady) {
    console.log('Server did not fully initialize within timeout');
  } else {
    console.log('Server appears to be initialized');
  }

  console.log('Server should be running, testing SIGTERM...');
  
  // Test SIGTERM graceful shutdown
  console.log('Sending SIGTERM signal...');
  serverProcess.kill('SIGTERM');

  // Wait for process to exit
  const exitPromise = new Promise((resolve) => {
    serverProcess.on('exit', (code, signal) => {
      resolve({ code, signal });
    });
  });

  // Add timeout to prevent hanging
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      resolve({ code: null, signal: 'TIMEOUT' });
    }, 30000); // 30 second timeout
  });

  const result = await Promise.race([exitPromise, timeoutPromise]);
  
  console.log(`\nTest Results:`);
  console.log(`Exit Code: ${result.code}`);
  console.log(`Signal: ${result.signal}`);
  
  // Check if graceful shutdown messages are in stderr
  const hasShutdownStart = errorOutput.includes('Received SIGTERM, initiating graceful shutdown') || 
                           errorOutput.includes('initiating graceful shutdown');
  const hasShutdownHandlers = errorOutput.includes('Graceful shutdown handlers registered');
  const hasTerminalCleanup = errorOutput.includes('Step 2: Cleaning up terminal sessions');
  const hasTransportCleanup = errorOutput.includes('Step 3: Cleaning up transport');
  const hasShutdownComplete = errorOutput.includes('Graceful shutdown completed successfully');
  
  console.log(`\nShutdown Messages Check:`);
  console.log(`✓ Shutdown handlers registered: ${hasShutdownHandlers}`);
  console.log(`✓ Shutdown initiated: ${hasShutdownStart}`);
  console.log(`✓ Terminal cleanup: ${hasTerminalCleanup}`);
  console.log(`✓ Transport cleanup: ${hasTransportCleanup}`);
  console.log(`✓ Shutdown completed: ${hasShutdownComplete}`);
  
  // Overall test result - if there are no sessions, it's OK to skip some cleanup steps
  const testPassed = result.code === 0 && 
                     result.signal !== 'TIMEOUT' && 
                     hasShutdownHandlers && 
                     hasShutdownComplete;
  
  console.log(`\n${testPassed ? '✓ TEST PASSED' : '✗ TEST FAILED'}: Graceful shutdown functionality`);
  
  if (!testPassed) {
    console.log('\nFull error output:');
    console.log(errorOutput);
    process.exit(1);
  }
  
  // If process is still running after timeout, force kill it
  if (result.signal === 'TIMEOUT') {
    console.log('Forcing process termination...');
    serverProcess.kill('SIGKILL');
    process.exit(1);
  }
}

// Run the test
testGracefulShutdown().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});