#!/usr/bin/env node

// Test script to verify MCP server is working
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, 'dist', 'index.js');

console.log('Testing Desktop Commander MCP Server...\n');

const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'] // stdin: pipe, stdout: pipe, stderr: inherit
});

// Send initialize request
const initRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'test-client',
      version: '1.0.0'
    }
  }
};

// Send list tools request
const listToolsRequest = {
  jsonrpc: '2.0',
  id: 2,
  method: 'tools/list',
  params: {}
};

let responses = [];
let buffer = '';

server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';
  
  for (const line of lines) {
    if (line.trim()) {
      try {
        const json = JSON.parse(line);
        responses.push(json);
        console.log('✅ Received valid JSON-RPC response:', json.id || json.method || 'notification');
        
        if (json.id === 1) {
          console.log('   Server initialized successfully');
          // Send list tools request after initialization
          server.stdin.write(JSON.stringify(listToolsRequest) + '\n');
        } else if (json.id === 2) {
          console.log(`   Found ${json.result?.tools?.length || 0} tools`);
          console.log('\n✅ MCP Server is working correctly!');
          server.kill();
          process.exit(0);
        }
      } catch (e) {
        console.error('❌ Invalid JSON received on stdout:', line);
        console.error('   This should not happen - stdout should only contain JSON-RPC messages');
        server.kill();
        process.exit(1);
      }
    }
  }
});

server.on('error', (err) => {
  console.error('❌ Failed to start server:', err);
  process.exit(1);
});

// Send initialize request
setTimeout(() => {
  console.log('Sending initialize request...');
  server.stdin.write(JSON.stringify(initRequest) + '\n');
}, 100);

// Timeout after 5 seconds
setTimeout(() => {
  console.error('❌ Test timed out - no valid responses received');
  server.kill();
  process.exit(1);
}, 5000);
