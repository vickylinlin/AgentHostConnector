import os from 'node:os';
import path from 'node:path';
export function expandHome(value) {
    if (value === '~')
        return os.homedir();
    if (value.startsWith('~/') || value.startsWith('~\\'))
        return path.join(os.homedir(), value.slice(2));
    return value;
}
export function normalizePath(value) {
    const trimmed = value.trim().replace(/^["']|["']$/g, '');
    return path.normalize(trimmed);
}
export function resolvePath(value) {
    return path.resolve(expandHome(normalizePath(value)));
}
//# sourceMappingURL=path-utils.js.map