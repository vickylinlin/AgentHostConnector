#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { helpText } from './config.js';
import { writeConfigDetails } from './logger.js';
import { createRuntimeFromProcess } from './runtime.js';
import { createApp } from './server.js';
async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(helpText());
        return;
    }
    const runtime = await createRuntimeFromProcess(process.argv.slice(2));
    const app = createApp(runtime);
    const wss = new WebSocketServer({ noServer: true });
    serve({
        fetch: app.fetch,
        websocket: { server: wss },
        hostname: runtime.listenHost,
        port: runtime.listenPort,
    }, (info) => {
        const config = runtime.config();
        writeConfigDetails({
            title: 'AgentHostConnector started',
            webUrl: `http://${info.address}:${info.port}/`,
            mcpUrl: `http://${info.address}:${info.port}/mcp`,
            configPath: config.configPath,
            host: config.host,
            port: config.port,
            skillsDirs: config.skillsDirs,
            allowedDirectories: runtime.allowedDirectories(),
            logLevel: config.logLevel,
        });
    });
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map