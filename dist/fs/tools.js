import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { createFilesystemContext } from './security.js';
import { applyFileEdits, directoryTree, formatSize, getFileStats, headFile, mediaMimeTypes, readFileAsBase64, readFileContent, searchFiles, tailFile, writeFileContent, } from './operations.js';
// Adapted from https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem.
// Tool names and safety semantics intentionally match the official filesystem server.
export const FILESYSTEM_TOOL_SUMMARIES = [
    { name: 'read_file', title: 'Read File (Deprecated)', source: 'filesystem', readOnly: true, description: 'Read text file contents.' },
    { name: 'read_text_file', title: 'Read Text File', source: 'filesystem', readOnly: true, description: 'Read text file contents.' },
    { name: 'read_media_file', title: 'Read Media File', source: 'filesystem', readOnly: true, description: 'Read image or audio files as base64.' },
    { name: 'read_multiple_files', title: 'Read Multiple Files', source: 'filesystem', readOnly: true, description: 'Read multiple text files.' },
    { name: 'write_file', title: 'Write File', source: 'filesystem', readOnly: false, description: 'Create or overwrite a text file.' },
    { name: 'edit_file', title: 'Edit File', source: 'filesystem', readOnly: false, description: 'Apply exact text edits to a file.' },
    { name: 'create_directory', title: 'Create Directory', source: 'filesystem', readOnly: false, description: 'Create a directory recursively.' },
    { name: 'list_directory', title: 'List Directory', source: 'filesystem', readOnly: true, description: 'List files and directories.' },
    { name: 'list_directory_with_sizes', title: 'List Directory With Sizes', source: 'filesystem', readOnly: true, description: 'List files and sizes.' },
    { name: 'directory_tree', title: 'Directory Tree', source: 'filesystem', readOnly: true, description: 'Return recursive directory tree JSON.' },
    { name: 'move_file', title: 'Move File', source: 'filesystem', readOnly: false, description: 'Move or rename a file or directory.' },
    { name: 'search_files', title: 'Search Files', source: 'filesystem', readOnly: true, description: 'Search recursively within allowed directories.' },
    { name: 'get_file_info', title: 'Get File Info', source: 'filesystem', readOnly: true, description: 'Return file or directory metadata.' },
    { name: 'list_allowed_directories', title: 'List Allowed Directories', source: 'filesystem', readOnly: true, description: 'Show filesystem roots.' },
];
const contentSchema = z.object({ content: z.string() });
const readTextFileSchema = z.object({
    path: z.string(),
    tail: z.number().int().positive().optional(),
    head: z.number().int().positive().optional(),
});
const readMediaFileSchema = z.object({ path: z.string() });
const editOperationSchema = z.object({
    oldText: z.string(),
    newText: z.string(),
});
function textResult(text) {
    return {
        content: [{ type: 'text', text }],
        structuredContent: { content: text },
    };
}
export function registerFilesystemTools(server, allowedDirectories) {
    if (allowedDirectories.length === 0)
        return [];
    const context = createFilesystemContext(allowedDirectories);
    const readTextFileHandler = async (args) => {
        const validPath = await context.validatePath(args.path);
        if (args.head && args.tail)
            throw new Error('Cannot specify both head and tail parameters simultaneously');
        const content = args.head ? await headFile(validPath, args.head) : args.tail ? await tailFile(validPath, args.tail) : await readFileContent(validPath);
        return textResult(content);
    };
    server.registerTool('read_file', {
        title: 'Read File (Deprecated)',
        description: 'Read the complete contents of a file as text. Deprecated: use read_text_file instead. Only works within allowed directories.',
        inputSchema: readTextFileSchema,
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, readTextFileHandler);
    server.registerTool('read_text_file', {
        title: 'Read Text File',
        description: 'Read file contents as text, optionally using head or tail. Only works within allowed directories.',
        inputSchema: readTextFileSchema,
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, readTextFileHandler);
    const readMediaHandler = async ({ path: requestedPath }) => {
        const validPath = await context.validatePath(requestedPath);
        const mimeType = mediaMimeTypes[path.extname(validPath).toLowerCase()] ?? 'application/octet-stream';
        const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('audio/') ? 'audio' : 'blob';
        const content = type === 'image'
            ? [{ type: 'image', data: await readFileAsBase64(validPath), mimeType }]
            : type === 'audio'
                ? [{ type: 'audio', data: await readFileAsBase64(validPath), mimeType }]
                : [{ type: 'blob', data: await readFileAsBase64(validPath), mimeType }];
        return { content, structuredContent: { content } };
    };
    server.registerTool('read_media_file', {
        title: 'Read Media File',
        description: 'Read an image or audio file as base64. Only works within allowed directories.',
        inputSchema: readMediaFileSchema,
        outputSchema: z.object({ content: z.array(z.object({ type: z.enum(['image', 'audio', 'blob']), data: z.string(), mimeType: z.string() })) }),
        annotations: { readOnlyHint: true },
    }, readMediaHandler);
    server.registerTool('read_multiple_files', {
        title: 'Read Multiple Files',
        description: 'Read multiple text files. Failed reads for individual files do not stop the operation. Only works within allowed directories.',
        inputSchema: z.object({ paths: z.array(z.string()).min(1) }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async ({ paths }) => {
        const results = await Promise.all(paths.map(async (requestedPath) => {
            try {
                const validPath = await context.validatePath(requestedPath);
                return `${requestedPath}:\n${await readFileContent(validPath)}\n`;
            }
            catch (error) {
                return `${requestedPath}: Error - ${error instanceof Error ? error.message : String(error)}`;
            }
        }));
        return textResult(results.join('\n---\n'));
    });
    server.registerTool('write_file', {
        title: 'Write File',
        description: 'Create a new file or overwrite an existing file. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string(), content: z.string() }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true },
    }, async ({ path: requestedPath, content }) => {
        const validPath = await context.validatePath(requestedPath);
        await writeFileContent(validPath, content);
        return textResult(`Successfully wrote to ${requestedPath}`);
    });
    server.registerTool('edit_file', {
        title: 'Edit File',
        description: 'Make exact text edits to a file and return a git-style diff. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string(), edits: z.array(editOperationSchema), dryRun: z.boolean().default(false) }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    }, async ({ path: requestedPath, edits, dryRun }) => {
        const validPath = await context.validatePath(requestedPath);
        return textResult(await applyFileEdits(validPath, edits, dryRun));
    });
    server.registerTool('create_directory', {
        title: 'Create Directory',
        description: 'Create a directory recursively. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string() }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    }, async ({ path: requestedPath }) => {
        const validPath = await context.validatePath(requestedPath);
        await fs.mkdir(validPath, { recursive: true });
        return textResult(`Successfully created directory ${requestedPath}`);
    });
    server.registerTool('list_directory', {
        title: 'List Directory',
        description: 'List files and directories. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string() }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async ({ path: requestedPath }) => {
        const validPath = await context.validatePath(requestedPath);
        const entries = await fs.readdir(validPath, { withFileTypes: true });
        return textResult(entries.map((entry) => `${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${entry.name}`).join('\n'));
    });
    server.registerTool('list_directory_with_sizes', {
        title: 'List Directory With Sizes',
        description: 'List files and directories with file sizes. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string(), sortBy: z.enum(['name', 'size']).optional().default('name') }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async ({ path: requestedPath, sortBy }) => {
        const validPath = await context.validatePath(requestedPath);
        const detailed = await Promise.all((await fs.readdir(validPath, { withFileTypes: true })).map(async (entry) => {
            const stats = await fs.stat(path.join(validPath, entry.name)).catch(() => undefined);
            return { name: entry.name, isDirectory: entry.isDirectory(), size: stats?.size ?? 0 };
        }));
        detailed.sort((a, b) => (sortBy === 'size' ? b.size - a.size : a.name.localeCompare(b.name)));
        const lines = detailed.map((entry) => `${entry.isDirectory ? '[DIR]' : '[FILE]'} ${entry.name.padEnd(30)} ${entry.isDirectory ? '' : formatSize(entry.size).padStart(10)}`);
        const files = detailed.filter((entry) => !entry.isDirectory);
        lines.push('', `Total: ${files.length} files, ${detailed.length - files.length} directories`, `Combined size: ${formatSize(files.reduce((sum, entry) => sum + entry.size, 0))}`);
        return textResult(lines.join('\n'));
    });
    server.registerTool('directory_tree', {
        title: 'Directory Tree',
        description: 'Return recursive directory tree JSON. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string(), excludePatterns: z.array(z.string()).optional().default([]) }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async ({ path: requestedPath, excludePatterns }) => {
        const validPath = await context.validatePath(requestedPath);
        return textResult(JSON.stringify(await directoryTree(validPath, excludePatterns), null, 2));
    });
    server.registerTool('move_file', {
        title: 'Move File',
        description: 'Move or rename a file or directory. Source and destination must be within allowed directories.',
        inputSchema: z.object({ source: z.string(), destination: z.string() }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: true },
    }, async ({ source, destination }) => {
        const validSource = await context.validatePath(source);
        const validDestination = await context.validatePath(destination);
        await fs.rename(validSource, validDestination);
        return textResult(`Successfully moved ${source} to ${destination}`);
    });
    server.registerTool('search_files', {
        title: 'Search Files',
        description: 'Recursively search for files and directories matching a glob or name pattern. Only searches within allowed directories.',
        inputSchema: z.object({ path: z.string(), pattern: z.string(), excludePatterns: z.array(z.string()).optional().default([]) }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async ({ path: requestedPath, pattern, excludePatterns }) => {
        const validPath = await context.validatePath(requestedPath);
        const results = await searchFiles(validPath, pattern, excludePatterns);
        return textResult(results.length > 0 ? results.map((result) => result.path).join('\n') : 'No matches found');
    });
    server.registerTool('get_file_info', {
        title: 'Get File Info',
        description: 'Return metadata about a file or directory. Only works within allowed directories.',
        inputSchema: z.object({ path: z.string() }),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async ({ path: requestedPath }) => {
        const validPath = await context.validatePath(requestedPath);
        const info = await getFileStats(validPath);
        return textResult(Object.entries(info).map(([key, value]) => `${key}: ${value}`).join('\n'));
    });
    server.registerTool('list_allowed_directories', {
        title: 'List Allowed Directories',
        description: 'Return the directories this server may access.',
        inputSchema: z.object({}),
        outputSchema: contentSchema,
        annotations: { readOnlyHint: true },
    }, async () => textResult(`Allowed directories:\n${context.allowedDirectories.join('\n')}`));
    return FILESYSTEM_TOOL_SUMMARIES;
}
//# sourceMappingURL=tools.js.map