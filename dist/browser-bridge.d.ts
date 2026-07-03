import { McpServer, WebStandardStreamableHTTPServerTransport, type CallToolResult, type JsonSchemaType, type Tool } from '@modelcontextprotocol/server';
import type { WSContext } from 'hono/ws';
import type { Logger } from './logger.js';
import type { BrowserBridgeStatus } from './types.js';
type JsonObjectSchema = JsonSchemaType & {
    type: 'object';
    properties?: Record<string, JsonSchemaType>;
    required?: string[];
};
export type BrowserToolRegistration = {
    name: string;
    title?: string;
    description?: string;
    inputSchema: JsonObjectSchema;
    outputSchema?: JsonObjectSchema;
    annotations?: Tool['annotations'];
    _meta?: Record<string, unknown>;
};
type BridgeSocket = Pick<WSContext<WebSocket>, 'send' | 'close'>;
export declare class BrowserBridge {
    private readonly logger;
    private socket;
    private tools;
    private pending;
    private registeredTools;
    private server;
    private connectedAt;
    private lastRegisteredAt;
    private clientName;
    private extensionId;
    private onToolListChanged?;
    constructor(logger: Logger);
    setMcpServer(server: McpServer): void;
    setToolListChangedHandler(handler: () => void): void;
    attachSocket(socket: BridgeSocket): void;
    handleMessage(data: unknown): Promise<void>;
    detachSocket(socket?: BridgeSocket): void;
    status(listenHost: string, listenPort: number): BrowserBridgeStatus;
    callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult>;
    private rejectPending;
    private notifyToolListChanged;
    private syncRegisteredTools;
}
export type BrowserMcpHost = {
    server: McpServer;
    transport: WebStandardStreamableHTTPServerTransport;
    bridge: BrowserBridge;
};
export declare function createBrowserMcpHost(bridge: BrowserBridge): Promise<BrowserMcpHost>;
export {};
