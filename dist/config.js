import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { resolvePath } from './path-utils.js';
export const DEFAULT_CONFIG_PATH = '~/.config/navpilot-hostconnector/config.yaml';
const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
const fileConfigSchema = z.object({
    host: z.string().optional(),
    port: z.number().int().min(1).max(65535).optional(),
    skillsDir: z.string().optional(),
    allowedDirectories: z.array(z.string()).optional(),
    logLevel: logLevelSchema.optional(),
});
export const DEFAULT_CONFIG = {
    host: '127.0.0.1',
    port: 18989,
    skillsDir: '~/.agents/skills',
    allowedDirectories: [],
    logLevel: 'info',
};
export function defaultConfigPath() {
    return path.join(os.homedir(), '.config', 'navpilot-hostconnector', 'config.yaml');
}
function parsePort(value) {
    if (!value)
        return undefined;
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error(`Invalid port: ${value}`);
    return port;
}
function parseLogLevel(value) {
    if (!value)
        return undefined;
    return logLevelSchema.parse(value.trim());
}
export function parseCliArgs(args) {
    const options = {};
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        const next = () => {
            const value = args[i + 1];
            if (!value || value.startsWith('--'))
                throw new Error(`Missing value for ${arg}`);
            i += 1;
            return value;
        };
        if (arg === '--config')
            options.configPath = next();
        else if (arg === '--host')
            options.host = next();
        else if (arg === '--port')
            options.port = parsePort(next());
        else if (arg === '--skills-dir')
            options.skillsDir = next();
        else if (arg === '--allow-dir')
            options.allowedDirectories = [...(options.allowedDirectories ?? []), next()];
        else if (arg === '--log-level')
            options.logLevel = parseLogLevel(next());
        else if (arg === '--help' || arg === '-h')
            throw new Error(helpText());
        else
            throw new Error(`Unknown option: ${arg}`);
    }
    return options;
}
export function envOptions(env) {
    const allowed = env.ALLOWED_DIRECTORIES ?? env.ALLOW_DIRS;
    return {
        ...(env.CONFIG_PATH ? { configPath: env.CONFIG_PATH } : {}),
        ...(env.HOST ? { host: env.HOST } : {}),
        ...(env.PORT ? { port: parsePort(env.PORT) } : {}),
        ...(env.SKILLS_DIR ? { skillsDir: env.SKILLS_DIR } : {}),
        ...(allowed ? { allowedDirectories: allowed.split(path.delimiter).filter(Boolean) } : {}),
        ...(env.LOG_LEVEL ? { logLevel: parseLogLevel(env.LOG_LEVEL) } : {}),
    };
}
async function readYamlConfig(configPath) {
    try {
        const raw = await fs.readFile(configPath, 'utf8');
        const parsed = parseYaml(raw);
        return fileConfigSchema.parse(parsed ?? {});
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return {};
        throw error;
    }
}
function normalizeConfig(config, configPath) {
    return {
        host: config.host.trim() || DEFAULT_CONFIG.host,
        port: config.port,
        skillsDir: resolvePath(config.skillsDir),
        allowedDirectories: config.allowedDirectories.map(resolvePath),
        logLevel: config.logLevel,
        configPath: resolvePath(configPath),
    };
}
export async function loadConfig(cliOptions = {}, env = process.env) {
    const envConfig = envOptions(env);
    const configPath = resolvePath(cliOptions.configPath ?? envConfig.configPath ?? DEFAULT_CONFIG_PATH);
    const fileConfig = await readYamlConfig(configPath);
    const merged = {
        ...DEFAULT_CONFIG,
        ...fileConfig,
        ...envConfig,
        ...cliOptions,
        allowedDirectories: cliOptions.allowedDirectories ?? envConfig.allowedDirectories ?? fileConfig.allowedDirectories ?? DEFAULT_CONFIG.allowedDirectories,
    };
    return normalizeConfig(merged, configPath);
}
export async function saveConfig(configPath, input) {
    const parsed = fileConfigSchema.required().parse(input);
    const dir = path.dirname(resolvePath(configPath));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(resolvePath(configPath), stringifyYaml(parsed), 'utf8');
}
export function helpText() {
    return [
        'agent-host-connector',
        '',
        'Options:',
        '  --config <path>',
        '  --host <host>',
        '  --port <port>',
        '  --skills-dir <path>',
        '  --allow-dir <path>      Repeatable',
        '  --log-level <level>     debug | info | warn | error',
    ].join('\n');
}
//# sourceMappingURL=config.js.map