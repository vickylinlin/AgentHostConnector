import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePath } from '../path-utils.js';
export function isPathWithinAllowedDirectories(absolutePath, allowedDirectories) {
    if (!absolutePath || allowedDirectories.length === 0 || absolutePath.includes('\x00'))
        return false;
    const normalizedPath = path.resolve(path.normalize(absolutePath));
    return allowedDirectories.some((dir) => {
        if (!dir || dir.includes('\x00'))
            return false;
        const normalizedDir = path.resolve(path.normalize(dir));
        if (normalizedPath === normalizedDir)
            return true;
        if (normalizedDir === path.sep)
            return normalizedPath.startsWith(path.sep);
        if (path.sep === '\\' && /^[A-Za-z]:\\?$/.test(normalizedDir)) {
            return normalizedPath.charAt(0).toLowerCase() === normalizedDir.charAt(0).toLowerCase();
        }
        return normalizedPath.startsWith(normalizedDir + path.sep);
    });
}
export async function resolveAllowedDirectories(directories) {
    const allowedDirectories = [];
    const warnings = [];
    for (const directory of directories) {
        const absolute = resolvePath(directory);
        try {
            const real = await fs.realpath(absolute);
            const stats = await fs.stat(real);
            if (!stats.isDirectory()) {
                warnings.push(`${absolute} is not a directory`);
                continue;
            }
            if (!allowedDirectories.includes(real))
                allowedDirectories.push(real);
            if (real !== absolute && !allowedDirectories.includes(absolute))
                allowedDirectories.push(absolute);
        }
        catch (error) {
            warnings.push(`Cannot access ${absolute}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return { allowedDirectories, warnings };
}
function resolveRelativePath(relativePath, allowedDirectories) {
    for (const allowedDir of allowedDirectories) {
        const candidate = path.resolve(allowedDir, relativePath);
        if (isPathWithinAllowedDirectories(candidate, allowedDirectories))
            return candidate;
    }
    return path.resolve(allowedDirectories[0], relativePath);
}
export function createFilesystemContext(allowedDirectories) {
    return {
        allowedDirectories: [...allowedDirectories],
        async validatePath(requestedPath) {
            const expanded = resolvePath(requestedPath);
            const absolute = path.isAbsolute(requestedPath) ? expanded : resolveRelativePath(requestedPath, allowedDirectories);
            const normalized = path.resolve(path.normalize(absolute));
            if (!isPathWithinAllowedDirectories(normalized, allowedDirectories)) {
                throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
            }
            try {
                const realPath = await fs.realpath(absolute);
                if (!isPathWithinAllowedDirectories(realPath, allowedDirectories)) {
                    throw new Error(`Access denied - symlink target outside allowed directories: ${realPath} not in ${allowedDirectories.join(', ')}`);
                }
                return realPath;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    throw error;
                const parentDir = path.dirname(absolute);
                try {
                    const realParent = await fs.realpath(parentDir);
                    if (!isPathWithinAllowedDirectories(realParent, allowedDirectories)) {
                        throw new Error(`Access denied - parent directory outside allowed directories: ${realParent} not in ${allowedDirectories.join(', ')}`);
                    }
                    return absolute;
                }
                catch {
                    throw new Error(`Parent directory does not exist: ${parentDir}`);
                }
            }
        },
    };
}
//# sourceMappingURL=security.js.map