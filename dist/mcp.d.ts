import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import type { Logger } from './logger.js';
import type { LoadedConfig, ToolSummary } from './types.js';
export type McpHost = {
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
    tools: ToolSummary[];
};
export declare function createMcpHost(config: LoadedConfig, allowedDirectories: string[], logger: Logger): Promise<McpHost>;
export declare function createBaseApp(host: string): Hono;
