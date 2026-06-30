import type { McpServer } from '@modelcontextprotocol/server';
import type { ToolSummary } from '../types.js';
export declare const FILESYSTEM_TOOL_SUMMARIES: ToolSummary[];
export declare function registerFilesystemTools(server: McpServer, allowedDirectories: string[]): ToolSummary[];
