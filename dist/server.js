import { z } from 'zod';
import { upgradeWebSocket } from '@hono/node-server';
import { createBaseApp } from './mcp.js';
import { renderAdminPage } from './web/page.js';
const configInputSchema = z.object({
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    skillsDirs: z.array(z.string().min(1)),
    allowedDirectories: z.array(z.string()),
    logLevel: z.enum(['debug', 'info', 'warn', 'error']),
});
export function createApp(runtime) {
    const app = createBaseApp(runtime.listenHost);
    app.get('/', (c) => c.html(renderAdminPage()));
    app.get('/healthz', (c) => c.json({ ok: true }));
    app.get('/api/status', (c) => c.json(runtime.status()));
    app.get('/api/config', (c) => c.json(runtime.config()));
    app.get('/api/skills', async (c) => c.json(await runtime.skills()));
    app.get('/api/tools', (c) => c.json({ tools: runtime.tools() }));
    app.get('/api/browser/status', (c) => c.json(runtime.browserStatus()));
    app.get('/api/browser/bridge', upgradeWebSocket(() => {
        let currentSocket;
        return {
            onOpen(_event, ws) {
                currentSocket = ws;
                runtime.browserMcpHost().bridge.attachSocket(ws);
            },
            onMessage(event) {
                void runtime.browserMcpHost().bridge.handleMessage(event.data);
            },
            onClose() {
                runtime.browserMcpHost().bridge.detachSocket(currentSocket);
            },
            onError(_event, ws) {
                runtime.browserMcpHost().bridge.detachSocket(ws);
            },
        };
    }));
    app.put('/api/config', async (c) => {
        const input = configInputSchema.parse(await c.req.json());
        const config = await runtime.updateConfig(input);
        return c.json({ config, status: runtime.status() });
    });
    app.all('/mcp', (c) => runtime.mcpHost().transport.handleRequest(c.req.raw));
    app.all('/browser/mcp', (c) => runtime.browserMcpHost().transport.handleRequest(c.req.raw));
    return app;
}
//# sourceMappingURL=server.js.map