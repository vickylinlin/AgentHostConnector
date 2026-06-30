export declare function isPathWithinAllowedDirectories(absolutePath: string, allowedDirectories: string[]): boolean;
export declare function resolveAllowedDirectories(directories: string[]): Promise<{
    allowedDirectories: string[];
    warnings: string[];
}>;
export type FilesystemContext = {
    allowedDirectories: string[];
    validatePath(requestedPath: string): Promise<string>;
};
export declare function createFilesystemContext(allowedDirectories: string[]): FilesystemContext;
