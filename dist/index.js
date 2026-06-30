#!/usr/bin/env node
import { serve } from '@hono/node-server';
import { helpText } from './config.js';
import { createRuntimeFromProcess } from './runtime.js';
import { createApp } from './server.js';
async function main() {
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
        console.log(helpText());
        return;
    }
    const runtime = await createRuntimeFromProcess(process.argv.slice(2));
    const app = createApp(runtime);
    serve({
        fetch: app.fetch,
        hostname: runtime.listenHost,
        port: runtime.listenPort,
    }, (info) => {
        runtime.logger.info('Server listening', {
            mcpUrl: `http://${info.address}:${info.port}/mcp`,
            webUrl: `http://${info.address}:${info.port}/`,
            configPath: runtime.config().configPath,
        });
    });
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=index.js.map