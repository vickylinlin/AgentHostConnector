export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type AppConfig = {
    host: string;
    port: number;
    skillsDirs: string[];
    allowedDirectories: string[];
    logLevel: LogLevel;
};
export type LoadedConfig = AppConfig & {
    configPath: string;
};
export type RuntimeStatus = {
    name: string;
    version: string;
    configPath: string;
    mcpUrl: string;
    webUrl: string;
    host: string;
    port: number;
    configuredHost: string;
    configuredPort: number;
    restartRequired: boolean;
    uptimeSeconds: number;
    nodeVersion: string;
    skillsDirs: string[];
    allowedDirectories: string[];
    filesystemToolsRegistered: boolean;
    startedAt: string;
};
export type ToolSummary = {
    name: string;
    title: string;
    description: string;
    source: 'skills' | 'filesystem';
    readOnly: boolean;
};
