import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import { minimatch } from 'minimatch';
export function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0)
        return '0 B';
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    if (index <= 0)
        return `${bytes} B`;
    return `${(bytes / Math.pow(1024, index)).toFixed(2)} ${units[index]}`;
}
export function normalizeLineEndings(text) {
    return text.replace(/\r\n/g, '\n');
}
export function createUnifiedDiff(originalContent, newContent, filepath = 'file') {
    return createTwoFilesPatch(filepath, filepath, normalizeLineEndings(originalContent), normalizeLineEndings(newContent), 'original', 'modified');
}
export async function getFileStats(filePath) {
    const stats = await fs.stat(filePath);
    return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        permissions: stats.mode.toString(8).slice(-3),
    };
}
export async function readFileContent(filePath) {
    return fs.readFile(filePath, 'utf8');
}
export async function readFileAsBase64(filePath) {
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
        stream.on('error', reject);
    });
}
export async function writeFileContent(filePath, content) {
    try {
        await fs.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
    }
    catch (error) {
        if (error.code !== 'EEXIST')
            throw error;
        const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
        try {
            await fs.writeFile(tempPath, content, 'utf8');
            await fs.rename(tempPath, filePath);
        }
        catch (renameError) {
            await fs.unlink(tempPath).catch(() => { });
            throw renameError;
        }
    }
}
export async function applyFileEdits(filePath, edits, dryRun = false) {
    const original = normalizeLineEndings(await fs.readFile(filePath, 'utf8'));
    let modified = original;
    for (const edit of edits) {
        const oldText = normalizeLineEndings(edit.oldText);
        const newText = normalizeLineEndings(edit.newText);
        if (modified.includes(oldText)) {
            modified = modified.replace(oldText, () => newText);
            continue;
        }
        const oldLines = oldText.split('\n');
        const contentLines = modified.split('\n');
        let matched = false;
        for (let i = 0; i <= contentLines.length - oldLines.length; i += 1) {
            const candidate = contentLines.slice(i, i + oldLines.length);
            if (!oldLines.every((line, offset) => line.trim() === candidate[offset].trim()))
                continue;
            const originalIndent = contentLines[i].match(/^\s*/)?.[0] ?? '';
            const newLines = newText.split('\n').map((line, offset) => (offset === 0 ? originalIndent + line.trimStart() : line));
            contentLines.splice(i, oldLines.length, ...newLines);
            modified = contentLines.join('\n');
            matched = true;
            break;
        }
        if (!matched)
            throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
    const diff = createUnifiedDiff(original, modified, filePath);
    let ticks = 3;
    while (diff.includes('`'.repeat(ticks)))
        ticks += 1;
    const formattedDiff = `${'`'.repeat(ticks)}diff\n${diff}${'`'.repeat(ticks)}\n\n`;
    if (!dryRun) {
        const tempPath = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
        try {
            await fs.writeFile(tempPath, modified, 'utf8');
            await fs.rename(tempPath, filePath);
        }
        catch (error) {
            await fs.unlink(tempPath).catch(() => { });
            throw error;
        }
    }
    return formattedDiff;
}
export async function headFile(filePath, numLines) {
    const content = await readFileContent(filePath);
    return normalizeLineEndings(content).split('\n').slice(0, numLines).join('\n');
}
export async function tailFile(filePath, numLines) {
    const content = await readFileContent(filePath);
    return normalizeLineEndings(content).split('\n').slice(-numLines).join('\n');
}
function shouldExclude(relativePath, excludePatterns) {
    return excludePatterns.some((pattern) => {
        if (pattern.includes('*'))
            return minimatch(relativePath, pattern, { dot: true });
        return (minimatch(relativePath, pattern, { dot: true }) ||
            minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
            minimatch(relativePath, `**/${pattern}/**`, { dot: true }));
    });
}
export async function searchFiles(rootPath, pattern, excludePatterns = []) {
    const results = [];
    async function walk(currentPath) {
        for (const entry of await fs.readdir(currentPath, { withFileTypes: true })) {
            const entryPath = path.join(currentPath, entry.name);
            const relative = path.relative(rootPath, entryPath);
            if (shouldExclude(relative, excludePatterns))
                continue;
            if (minimatch(relative, pattern, { dot: true }) || entry.name.includes(pattern)) {
                results.push({ path: entryPath, isDirectory: entry.isDirectory() });
            }
            if (entry.isDirectory())
                await walk(entryPath);
        }
    }
    await walk(rootPath);
    return results.sort((a, b) => a.path.localeCompare(b.path));
}
export async function directoryTree(rootPath, excludePatterns = []) {
    async function build(currentPath) {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        const result = [];
        for (const entry of entries) {
            const entryPath = path.join(currentPath, entry.name);
            const relative = path.relative(rootPath, entryPath);
            if (shouldExclude(relative, excludePatterns))
                continue;
            const node = {
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
            };
            if (entry.isDirectory())
                node.children = await build(entryPath);
            result.push(node);
        }
        return result;
    }
    return build(rootPath);
}
export const mediaMimeTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
};
//# sourceMappingURL=operations.js.map