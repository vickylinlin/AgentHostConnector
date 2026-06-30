export type FileInfo = {
    size: number;
    created: Date;
    modified: Date;
    accessed: Date;
    isDirectory: boolean;
    isFile: boolean;
    permissions: string;
};
export type SearchResult = {
    path: string;
    isDirectory: boolean;
};
export declare function formatSize(bytes: number): string;
export declare function normalizeLineEndings(text: string): string;
export declare function createUnifiedDiff(originalContent: string, newContent: string, filepath?: string): string;
export declare function getFileStats(filePath: string): Promise<FileInfo>;
export declare function readFileContent(filePath: string): Promise<string>;
export declare function readFileAsBase64(filePath: string): Promise<string>;
export declare function writeFileContent(filePath: string, content: string): Promise<void>;
export declare function applyFileEdits(filePath: string, edits: Array<{
    oldText: string;
    newText: string;
}>, dryRun?: boolean): Promise<string>;
export declare function headFile(filePath: string, numLines: number): Promise<string>;
export declare function tailFile(filePath: string, numLines: number): Promise<string>;
export declare function searchFiles(rootPath: string, pattern: string, excludePatterns?: string[]): Promise<SearchResult[]>;
export declare function directoryTree(rootPath: string, excludePatterns?: string[]): Promise<{
    name: string;
    type: "file" | "directory";
    children?: unknown[];
}[]>;
export declare const mediaMimeTypes: Record<string, string>;
