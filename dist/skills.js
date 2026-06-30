import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
const SKILL_FILE_NAME = 'SKILL.md';
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_INDEX_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
const MAX_SCAN_DEPTH = 6;
const MAX_SCAN_DIRECTORIES = 2000;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.hg', '.svn']);
const TEXT_EXTENSIONS = new Set([
    '.css',
    '.csv',
    '.html',
    '.js',
    '.json',
    '.jsx',
    '.log',
    '.md',
    '.mdx',
    '.py',
    '.sh',
    '.ts',
    '.tsx',
    '.txt',
    '.xml',
    '.yaml',
    '.yml',
]);
const MIME_TYPES = new Map([
    ['.css', 'text/css'],
    ['.csv', 'text/csv'],
    ['.gif', 'image/gif'],
    ['.html', 'text/html'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.js', 'text/javascript'],
    ['.json', 'application/json'],
    ['.md', 'text/markdown'],
    ['.mdx', 'text/markdown'],
    ['.pdf', 'application/pdf'],
    ['.png', 'image/png'],
    ['.py', 'text/x-python'],
    ['.sh', 'text/x-shellscript'],
    ['.svg', 'image/svg+xml'],
    ['.ts', 'text/typescript'],
    ['.tsx', 'text/typescript'],
    ['.txt', 'text/plain'],
    ['.xml', 'application/xml'],
    ['.yaml', 'application/yaml'],
    ['.yml', 'application/yaml'],
]);
function getFrontmatter(source) {
    if (!source.startsWith('---'))
        return null;
    const endIndex = source.indexOf('\n---', 3);
    if (endIndex === -1)
        return null;
    return source.slice(4, endIndex).trim();
}
function createDiagnosticLogger(diagnostics, logger) {
    return (diagnostic) => {
        diagnostics.push(diagnostic);
        logger.warn(diagnostic.message, {
            directoryPath: diagnostic.directoryPath,
            skillFilePath: diagnostic.skillFilePath,
            name: diagnostic.name,
        });
    };
}
async function safeReadDir(directory) {
    try {
        return await fs.readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
async function walkSkillDirectories(rootDir, diagnostics, logger) {
    const results = [];
    const warn = createDiagnosticLogger(diagnostics, logger);
    const pending = [{ directoryPath: rootDir, depth: 0 }];
    let visited = 0;
    while (pending.length > 0) {
        const current = pending.pop();
        if (!current)
            continue;
        if (current.depth > MAX_SCAN_DEPTH)
            continue;
        if (visited >= MAX_SCAN_DIRECTORIES) {
            warn({
                severity: 'warn',
                message: `Stopped skill scan after ${MAX_SCAN_DIRECTORIES} directories`,
                directoryPath: rootDir,
            });
            break;
        }
        visited += 1;
        const entries = await safeReadDir(current.directoryPath);
        const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === SKILL_FILE_NAME);
        if (current.directoryPath !== rootDir)
            results.push(current.directoryPath);
        if (hasSkillFile)
            continue;
        for (const entry of entries) {
            if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name))
                continue;
            pending.push({ directoryPath: path.join(current.directoryPath, entry.name), depth: current.depth + 1 });
        }
    }
    return results;
}
async function findSkillFile(directoryPath) {
    const entries = await safeReadDir(directoryPath);
    const candidate = entries.find((entry) => entry.isFile() && entry.name === SKILL_FILE_NAME);
    if (!candidate)
        return null;
    return {
        directoryName: path.basename(directoryPath),
        directoryPath,
        skillFilePath: path.join(directoryPath, SKILL_FILE_NAME),
    };
}
async function collectSkillFiles(rootDir, diagnostics, logger) {
    const directories = await walkSkillDirectories(rootDir, diagnostics, logger);
    const matches = await Promise.all(directories.map((directoryPath) => findSkillFile(directoryPath)));
    return matches.filter((match) => match !== null);
}
function parseSkillFrontmatter(source) {
    const frontmatter = getFrontmatter(source);
    if (!frontmatter)
        throw new Error('Missing YAML frontmatter');
    const parsed = parseYaml(frontmatter);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('Frontmatter must be a YAML mapping');
    return parsed;
}
function parseSkillSummary(match, raw) {
    const parsed = parseSkillFrontmatter(raw);
    if (typeof parsed.name !== 'string' || parsed.name.trim() === '')
        throw new Error('Missing string frontmatter field: name');
    if (typeof parsed.description !== 'string' || parsed.description.trim() === '') {
        throw new Error('Missing string frontmatter field: description');
    }
    const name = parsed.name.trim();
    if (!SKILL_NAME_PATTERN.test(name))
        throw new Error(`Invalid skill name: ${name}`);
    if (name !== match.directoryName)
        throw new Error(`Skill name must match parent directory name: ${name} != ${match.directoryName}`);
    const { name: _name, description: _description, ...metadata } = parsed;
    return {
        name,
        description: parsed.description.trim(),
        uri: createSkillUri(name, SKILL_FILE_NAME),
        directoryPath: match.directoryPath,
        skillFilePath: match.skillFilePath,
        metadata,
    };
}
export async function loadSkillCatalog(rootDir, logger) {
    const diagnostics = [];
    const warn = createDiagnosticLogger(diagnostics, logger);
    const matches = await collectSkillFiles(rootDir, diagnostics, logger);
    const summaries = [];
    for (const match of matches) {
        try {
            const raw = await fs.readFile(match.skillFilePath, 'utf8');
            summaries.push(parseSkillSummary(match, raw));
        }
        catch (error) {
            warn({
                severity: 'error',
                message: `Skipping invalid skill definition: ${error instanceof Error ? error.message : String(error)}`,
                directoryPath: match.directoryPath,
                skillFilePath: match.skillFilePath,
            });
        }
    }
    const counts = new Map();
    for (const summary of summaries)
        counts.set(summary.name, (counts.get(summary.name) ?? 0) + 1);
    const duplicateNames = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name));
    for (const summary of summaries) {
        if (!duplicateNames.has(summary.name))
            continue;
        warn({
            severity: 'error',
            message: `Skipping duplicate skill name: ${summary.name}`,
            directoryPath: summary.directoryPath,
            skillFilePath: summary.skillFilePath,
            name: summary.name,
        });
    }
    return {
        skills: summaries.filter((summary) => !duplicateNames.has(summary.name)).sort((a, b) => a.name.localeCompare(b.name)),
        diagnostics,
    };
}
export async function listSkills(rootDir, logger) {
    return (await loadSkillCatalog(rootDir, logger)).skills;
}
export function createSkillUri(skillName, filePath) {
    return `skill://${skillName}/${filePath.split(path.sep).map(encodeURIComponent).join('/')}`;
}
export function createSkillIndex(skills) {
    return {
        $schema: SKILL_INDEX_SCHEMA,
        skills: skills.map((skill) => ({
            name: skill.name,
            type: 'skill-md',
            description: skill.description,
            url: skill.uri,
        })),
    };
}
export function inferSkillMimeType(filePath) {
    return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}
function isTextMimeType(mimeType, filePath) {
    if (mimeType.startsWith('text/'))
        return true;
    if (mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'application/yaml')
        return true;
    return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}
function assertRelativeSkillPath(filePath) {
    if (!filePath || filePath.includes('\x00'))
        throw new Error('Skill resource path is empty or invalid');
    if (path.isAbsolute(filePath))
        throw new Error(`Skill resource path must be relative: ${filePath}`);
    const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'));
    if (normalized === '.' || normalized.startsWith('/') || normalized.startsWith('../') || normalized === '..') {
        throw new Error(`Skill resource path escapes skill directory: ${filePath}`);
    }
    return normalized;
}
function isPathInsideDirectory(candidate, directory) {
    const relative = path.relative(directory, candidate);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}
export async function readSkillResource(rootDir, skillName, filePath, logger) {
    const catalog = await loadSkillCatalog(rootDir, logger);
    const skill = catalog.skills.find((item) => item.name === skillName);
    if (!skill)
        throw new Error(`Skill not found: ${skillName}`);
    const relativePath = assertRelativeSkillPath(filePath);
    const requestedPath = path.resolve(skill.directoryPath, relativePath);
    const realSkillDirectory = await fs.realpath(skill.directoryPath);
    const realResourcePath = await fs.realpath(requestedPath);
    if (!isPathInsideDirectory(realResourcePath, realSkillDirectory)) {
        throw new Error(`Skill resource path escapes skill directory: ${filePath}`);
    }
    const stats = await fs.stat(realResourcePath);
    if (!stats.isFile())
        throw new Error(`Skill resource is not a file: ${filePath}`);
    const mimeType = inferSkillMimeType(relativePath);
    const uri = createSkillUri(skill.name, relativePath);
    if (isTextMimeType(mimeType, relativePath)) {
        return { uri, mimeType, content: await fs.readFile(realResourcePath, 'utf8'), encoding: 'text' };
    }
    return { uri, mimeType, content: (await fs.readFile(realResourcePath)).toString('base64'), encoding: 'base64' };
}
//# sourceMappingURL=skills.js.map