import type { LogLevel } from './types.js';
export type ConfigDetails = {
    title: string;
    webUrl: string;
    mcpUrl: string;
    configPath: string;
    host: string;
    port: number;
    skillsDirs: string[];
    allowedDirectories: string[];
    logLevel: LogLevel;
    restartRequired?: boolean;
};
export type Logger = {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    setLevel(level: LogLevel): void;
    level(): LogLevel;
};
export declare function formatConfigDetails(details: ConfigDetails): string;
export declare function writeConfigDetails(details: ConfigDetails): void;
export declare function createLogger(initialLevel: LogLevel): Logger;
