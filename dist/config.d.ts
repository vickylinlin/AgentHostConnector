import type { AppConfig, LoadedConfig } from './types.js';
export declare const DEFAULT_CONFIG_PATH = "~/.config/navpilot-hostconnector/config.yaml";
export declare const DEFAULT_CONFIG: AppConfig;
export type CliOptions = Partial<AppConfig> & {
    configPath?: string;
};
export declare function defaultConfigPath(): string;
export declare function parseCliArgs(args: string[]): CliOptions;
export declare function envOptions(env: NodeJS.ProcessEnv): CliOptions;
export declare function loadConfig(cliOptions?: CliOptions, env?: NodeJS.ProcessEnv): Promise<LoadedConfig>;
export declare function saveConfig(configPath: string, input: AppConfig): Promise<void>;
export declare function helpText(): string;
