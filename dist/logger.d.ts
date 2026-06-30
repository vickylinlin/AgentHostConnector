import type { LogLevel } from './types.js';
export type Logger = {
    debug(message: string, data?: unknown): void;
    info(message: string, data?: unknown): void;
    warn(message: string, data?: unknown): void;
    error(message: string, data?: unknown): void;
    setLevel(level: LogLevel): void;
    level(): LogLevel;
};
export declare function createLogger(initialLevel: LogLevel): Logger;
