# Desktop Commander MCP - Core (Privacy-First)

A minimal, privacy-focused Model Context Protocol (MCP) server that provides Claude Desktop with filesystem access, terminal operations, and text editing capabilities. **All telemetry, analytics, tracking, and marketing features have been removed.**

## Privacy-First Changes

This fork removes all data collection, tracking, and promotional content:

### ❌ Removed
- **Telemetry & Analytics**: Google Analytics tracking, usage statistics collection
- **Marketing Content**: Testimonials, supporter badges, promotional videos, buy-me-coffee links
- **Feedback Systems**: Browser-based feedback forms and prompting 
- **Usage Tracking**: Tool call logging, success/failure metrics, fuzzy search logging
- **External Services**: All connections to external analytics and tracking services

### ✅ Core MCP Features Retained
- **Filesystem Operations**: Read/write files, create directories, search files and code
- **Terminal Control**: Execute commands, manage processes, interactive sessions  
- **Text Editing**: Surgical search/replace operations on files
- **Configuration**: Basic server configuration management

## Features

- **Filesystem Operations**: Read/write files, create directories, search files and code
- **Terminal Control**: Execute commands, manage processes, interactive sessions  
- **Text Editing**: Surgical search/replace operations on files
- **Configuration**: Basic server configuration management

## Installation

### Option 1: Install through npx
```bash
npx @wonderwhy-er/desktop-commander@latest setup
```

### Option 2: Manual Configuration
Add to your `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "desktop-commander": {
      "command": "npx",
      "args": ["-y", "@wonderwhy-er/desktop-commander"]
    }
  }
}
```

### Option 3: Local Development (Privacy-First Version)
```bash
git clone https://github.com/democratize-technology-code-developer/DesktopCommanderMCP.git
cd DesktopCommanderMCP
git checkout clean-core-mcp
npm run setup
```

## Configuration

The server maintains a configuration file with settings for:
- `allowedDirectories`: Filesystem paths the server can access
- `blockedCommands`: Shell commands that cannot be executed
- `defaultShell`: Default shell for command execution
- `fileReadLineLimit`: Maximum lines to read per operation
- `fileWriteLineLimit`: Maximum lines to write per operation

## Available Tools

### Filesystem
- `read_file` - Read file contents with optional offset/length
- `write_file` - Write/append file contents
- `create_directory` - Create directories
- `list_directory` - List directory contents
- `move_file` - Move/rename files
- `search_files` - Find files by name
- `search_code` - Search file contents using ripgrep
- `get_file_info` - Get file metadata

### Terminal
- `start_process` - Start terminal processes
- `interact_with_process` - Send input to running processes  
- `read_process_output` - Read process output
- `force_terminate` - Terminate processes
- `list_sessions` - List active sessions
- `list_processes` - List system processes
- `kill_process` - Kill processes by PID

### Text Editing
- `edit_block` - Apply targeted text replacements

### Configuration
- `get_config` - Get current configuration
- `set_config_value` - Update configuration values

## Privacy Notice

This version has been completely stripped of all tracking, analytics, and data collection. The server operates entirely locally without sending any data to external services.

## License

MIT
