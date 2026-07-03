import { loadConfig, saveConfig } from './config.js';
import { createLogger, writeConfigDetails } from './logger.js';
import { createMcpHost } from './mcp.js';
import { resolveAllowedDirectories } from './fs/security.js';
import { loadSkillCatalog } from './skills.js';
import { resolvePath } from './path-utils.js';
function normalizeInput(input, configPath) {
    return {
        host: input.host.trim() || '127.0.0.1',
        port: input.port,
        skillsDirs: input.skillsDirs.map(resolvePath),
        allowedDirectories: input.allowedDirectories.map(resolvePath),
        logLevel: input.logLevel,
        configPath,
    };
}
export async function createRuntime(initialConfig) {
    let currentConfig = initialConfig;
    let allowedDirectories = [];
    let warnings = [];
    let mcpHost;
    const listenHost = initialConfig.host;
    const listenPort = initialConfig.port;
    const startedAt = new Date();
    const logger = createLogger(initialConfig.logLevel);
    async function rebuildMcp() {
        const resolved = await resolveAllowedDirectories(currentConfig.allowedDirectories);
        allowedDirectories = resolved.allowedDirectories;
        warnings = resolved.warnings;
        for (const warning of warnings)
            logger.warn(warning);
        mcpHost = await createMcpHost(currentConfig, allowedDirectories, logger);
    }
    function status() {
        const configuredHost = currentConfig.host;
        const configuredPort = currentConfig.port;
        const webUrl = `http://${listenHost}:${listenPort}/`;
        return {
            name: 'agent-host-connector',
            version: '0.1.0',
            configPath: currentConfig.configPath,
            mcpUrl: `http://${listenHost}:${listenPort}/mcp`,
            webUrl,
            host: listenHost,
            port: listenPort,
            configuredHost,
            configuredPort,
            restartRequired: configuredHost !== listenHost || configuredPort !== listenPort,
            uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
            nodeVersion: process.version,
            skillsDirs: [...currentConfig.skillsDirs],
            allowedDirectories: [...allowedDirectories],
            filesystemToolsRegistered: allowedDirectories.length > 0,
            startedAt: startedAt.toISOString(),
        };
    }
    await rebuildMcp();
    const runtime = {
        listenHost,
        listenPort,
        startedAt,
        logger,
        config: () => currentConfig,
        allowedDirectories: () => [...allowedDirectories],
        warnings: () => [...warnings],
        mcpHost: () => mcpHost,
        tools: () => mcpHost.tools,
        status,
        skills: () => loadSkillCatalog(currentConfig.skillsDirs, logger),
        updateConfig: async (input) => {
            await saveConfig(currentConfig.configPath, input);
            currentConfig = normalizeInput(input, currentConfig.configPath);
            logger.setLevel(currentConfig.logLevel);
            await rebuildMcp();
            const currentStatus = status();
            writeConfigDetails({
                title: 'Config saved',
                webUrl: currentStatus.webUrl,
                mcpUrl: currentStatus.mcpUrl,
                configPath: currentConfig.configPath,
                host: currentConfig.host,
                port: currentConfig.port,
                skillsDirs: currentConfig.skillsDirs,
                allowedDirectories,
                logLevel: currentConfig.logLevel,
                restartRequired: currentStatus.restartRequired,
            });
            return currentConfig;
        },
    };
    return runtime;
}
export async function createRuntimeFromProcess(args, env = process.env) {
    const { parseCliArgs } = await import('./config.js');
    const config = await loadConfig(parseCliArgs(args), env);
    return createRuntime(config);
}
//# sourceMappingURL=runtime.js.map