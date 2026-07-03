import { fromJsonSchema, McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
const CALL_TIMEOUT_MS = 60_000;
function isRecord(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function textResult(text, structuredContent) {
    return {
        content: [{ type: 'text', text }],
        ...(structuredContent ? { structuredContent } : {}),
    };
}
function resultToMcpResult(value) {
    if (isRecord(value) && Array.isArray(value.content))
        return value;
    if (isRecord(value))
        return textResult(JSON.stringify(value, null, 2), value);
    return textResult(String(value ?? ''), { value });
}
async function dataToString(data) {
    if (typeof data === 'string')
        return data;
    if (data instanceof ArrayBuffer)
        return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data))
        return new TextDecoder().decode(data);
    if (data instanceof Blob)
        return data.text();
    return String(data);
}
function parseMessage(data) {
    const parsed = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.type !== 'string')
        throw new Error('Invalid browser bridge message.');
    return parsed;
}
export class BrowserBridge {
    logger;
    socket = null;
    tools = [];
    pending = new Map();
    registeredTools = new Map();
    server = null;
    connectedAt = null;
    lastRegisteredAt = null;
    clientName = '';
    extensionId = '';
    onToolListChanged;
    constructor(logger) {
        this.logger = logger;
    }
    setMcpServer(server) {
        this.server = server;
    }
    setToolListChangedHandler(handler) {
        this.onToolListChanged = handler;
    }
    attachSocket(socket) {
        if (this.socket && this.socket !== socket) {
            this.logger.info('Replacing active browser bridge connection.');
            this.socket.close();
        }
        this.socket = socket;
        this.connectedAt = new Date().toISOString();
        this.tools = [];
        this.clientName = '';
        this.extensionId = '';
        this.rejectPending('Browser bridge connection was replaced.');
        this.notifyToolListChanged();
    }
    async handleMessage(data) {
        const message = parseMessage(await dataToString(data));
        if (message.type === 'register') {
            this.tools = message.tools.filter((tool) => tool.name && tool.inputSchema?.type === 'object');
            this.syncRegisteredTools();
            this.clientName = message.clientName ?? '';
            this.extensionId = message.extensionId ?? '';
            this.lastRegisteredAt = new Date().toISOString();
            this.logger.info('Browser tools registered.', { count: this.tools.length });
            this.notifyToolListChanged();
            return;
        }
        if (message.type === 'call_result') {
            const pending = this.pending.get(message.id);
            if (!pending)
                return;
            clearTimeout(pending.timeout);
            this.pending.delete(message.id);
            if (message.ok)
                pending.resolve(resultToMcpResult(message.result));
            else
                pending.reject(new Error(message.error || 'Browser tool call failed.'));
        }
    }
    detachSocket(socket) {
        if (socket && this.socket !== socket)
            return;
        this.socket = null;
        this.tools = [];
        this.syncRegisteredTools();
        this.clientName = '';
        this.extensionId = '';
        this.rejectPending('Browser bridge disconnected.');
        this.notifyToolListChanged();
    }
    status(listenHost, listenPort) {
        return {
            browserMcpUrl: `http://${listenHost}:${listenPort}/browser/mcp`,
            browserBridgeUrl: `ws://${listenHost}:${listenPort}/api/browser/bridge`,
            browserConnected: Boolean(this.socket),
            browserToolCount: this.tools.length,
            browserConnectedAt: this.connectedAt,
            browserLastRegisteredAt: this.lastRegisteredAt,
            browserClientName: this.clientName || null,
            browserExtensionId: this.extensionId || null,
            tools: this.tools.map((tool) => ({
                name: tool.name,
                title: tool.title ?? tool.name,
                description: tool.description ?? '',
                source: 'browser',
                readOnly: Boolean(tool.annotations?.readOnlyHint),
            })),
        };
    }
    async callTool(name, args) {
        if (!this.socket)
            throw new Error('NavPilot browser bridge is not connected.');
        if (!this.tools.some((tool) => tool.name === name))
            throw new Error(`Browser tool "${name}" is not registered.`);
        const id = crypto.randomUUID();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Browser tool "${name}" timed out after ${CALL_TIMEOUT_MS / 1000}s.`));
            }, CALL_TIMEOUT_MS);
            this.pending.set(id, { resolve, reject, timeout });
            this.socket?.send(JSON.stringify({ type: 'call', id, toolName: name, args }));
        });
    }
    rejectPending(message) {
        for (const [id, pending] of this.pending) {
            clearTimeout(pending.timeout);
            pending.reject(new Error(message));
            this.pending.delete(id);
        }
    }
    notifyToolListChanged() {
        try {
            this.onToolListChanged?.();
        }
        catch (error) {
            this.logger.warn('Failed to notify browser MCP tool list change.', error instanceof Error ? error.message : String(error));
        }
    }
    syncRegisteredTools() {
        if (!this.server)
            return;
        const nextNames = new Set(this.tools.map((tool) => tool.name));
        for (const [name, registered] of this.registeredTools) {
            if (!nextNames.has(name)) {
                registered.remove();
                this.registeredTools.delete(name);
            }
        }
        for (const tool of this.tools) {
            const inputSchema = fromJsonSchema(tool.inputSchema);
            const outputSchema = tool.outputSchema ? fromJsonSchema(tool.outputSchema) : undefined;
            const callback = async (args) => {
                const record = isRecord(args) ? args : {};
                return this.callTool(tool.name, record);
            };
            const existing = this.registeredTools.get(tool.name);
            if (existing) {
                existing.update({
                    title: tool.title ?? tool.name,
                    description: tool.description,
                    paramsSchema: inputSchema,
                    ...(outputSchema ? { outputSchema } : {}),
                    annotations: tool.annotations,
                    _meta: tool._meta,
                    callback,
                    enabled: true,
                });
            }
            else {
                this.registeredTools.set(tool.name, this.server.registerTool(tool.name, {
                    title: tool.title ?? tool.name,
                    description: tool.description,
                    inputSchema,
                    ...(outputSchema ? { outputSchema } : {}),
                    annotations: tool.annotations,
                    _meta: tool._meta,
                }, callback));
            }
        }
    }
}
export async function createBrowserMcpHost(bridge) {
    const server = new McpServer({ name: 'navpilot-browser', version: '0.1.0' }, {
        capabilities: { tools: { listChanged: true } },
        instructions: 'This endpoint exposes browser automation tools registered by a locally connected NavPilot Chrome extension. If no extension is connected, no tools are available.',
    });
    bridge.setMcpServer(server);
    bridge.setToolListChangedHandler(() => server.sendToolListChanged());
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    await server.connect(transport);
    return { server, transport, bridge };
}
//# sourceMappingURL=browser-bridge.js.map