import fs from 'node:fs/promises'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Logger } from './logger.js'

export type SkillSummary = {
  name: string
  description: string
  uri: string
  directoryPath: string
  skillFilePath: string
  metadata?: Record<string, unknown>
}

export type SkillDiagnostic = {
  severity: 'warn' | 'error'
  message: string
  directoryPath?: string
  skillFilePath?: string
  name?: string
}

export type SkillCatalog = {
  skills: SkillSummary[]
  diagnostics: SkillDiagnostic[]
}

export type SkillResource = {
  uri: string
  mimeType: string
  content: string
  encoding: 'text' | 'base64'
}

type SkillFileMatch = {
  directoryName: string
  directoryPath: string
  skillFilePath: string
}

type ParsedFrontmatter = {
  name?: unknown
  description?: unknown
  [key: string]: unknown
}

const SKILL_FILE_NAME = 'SKILL.md'
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/
const SKILL_INDEX_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
const MAX_SCAN_DEPTH = 6
const MAX_SCAN_DIRECTORIES = 2000
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', '.hg', '.svn'])

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
])

const MIME_TYPES = new Map<string, string>([
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
])

function getFrontmatter(source: string): string | null {
  if (!source.startsWith('---')) return null
  const endIndex = source.indexOf('\n---', 3)
  if (endIndex === -1) return null
  return source.slice(4, endIndex).trim()
}

function createDiagnosticLogger(diagnostics: SkillDiagnostic[], logger: Logger) {
  return (diagnostic: SkillDiagnostic) => {
    diagnostics.push(diagnostic)
    logger.warn(diagnostic.message, {
      directoryPath: diagnostic.directoryPath,
      skillFilePath: diagnostic.skillFilePath,
      name: diagnostic.name,
    })
  }
}

async function safeReadDir(directory: string) {
  try {
    return await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function walkSkillDirectories(rootDir: string, diagnostics: SkillDiagnostic[], logger: Logger): Promise<string[]> {
  const results: string[] = []
  const warn = createDiagnosticLogger(diagnostics, logger)
  const pending = [{ directoryPath: rootDir, depth: 0 }]
  let visited = 0

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) continue
    if (current.depth > MAX_SCAN_DEPTH) continue
    if (visited >= MAX_SCAN_DIRECTORIES) {
      warn({
        severity: 'warn',
        message: `Stopped skill scan after ${MAX_SCAN_DIRECTORIES} directories`,
        directoryPath: rootDir,
      })
      break
    }
    visited += 1

    const entries = await safeReadDir(current.directoryPath)
    const hasSkillFile = entries.some((entry) => entry.isFile() && entry.name === SKILL_FILE_NAME)
    if (current.directoryPath !== rootDir) results.push(current.directoryPath)
    if (hasSkillFile) continue

    for (const entry of entries) {
      if (!entry.isDirectory() || SKIPPED_DIRECTORIES.has(entry.name)) continue
      pending.push({ directoryPath: path.join(current.directoryPath, entry.name), depth: current.depth + 1 })
    }
  }

  return results
}

async function findSkillFile(directoryPath: string): Promise<SkillFileMatch | null> {
  const entries = await safeReadDir(directoryPath)
  const candidate = entries.find((entry) => entry.isFile() && entry.name === SKILL_FILE_NAME)
  if (!candidate) return null

  return {
    directoryName: path.basename(directoryPath),
    directoryPath,
    skillFilePath: path.join(directoryPath, SKILL_FILE_NAME),
  }
}

async function collectSkillFiles(rootDir: string, diagnostics: SkillDiagnostic[], logger: Logger): Promise<SkillFileMatch[]> {
  const directories = await walkSkillDirectories(rootDir, diagnostics, logger)
  const matches = await Promise.all(directories.map((directoryPath) => findSkillFile(directoryPath)))
  return matches.filter((match): match is SkillFileMatch => match !== null)
}

function parseSkillFrontmatter(source: string): ParsedFrontmatter {
  const frontmatter = getFrontmatter(source)
  if (!frontmatter) throw new Error('Missing YAML frontmatter')
  const parsed = parseYaml(frontmatter)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Frontmatter must be a YAML mapping')
  return parsed as ParsedFrontmatter
}

function parseSkillSummary(match: SkillFileMatch, raw: string): SkillSummary {
  const parsed = parseSkillFrontmatter(raw)
  if (typeof parsed.name !== 'string' || parsed.name.trim() === '') throw new Error('Missing string frontmatter field: name')
  if (typeof parsed.description !== 'string' || parsed.description.trim() === '') {
    throw new Error('Missing string frontmatter field: description')
  }

  const name = parsed.name.trim()
  if (!SKILL_NAME_PATTERN.test(name)) throw new Error(`Invalid skill name: ${name}`)
  if (name !== match.directoryName) throw new Error(`Skill name must match parent directory name: ${name} != ${match.directoryName}`)

  const { name: _name, description: _description, ...metadata } = parsed
  return {
    name,
    description: parsed.description.trim(),
    uri: createSkillUri(name, SKILL_FILE_NAME),
    directoryPath: match.directoryPath,
    skillFilePath: match.skillFilePath,
    metadata,
  }
}

export async function loadSkillCatalog(rootDir: string, logger: Logger): Promise<SkillCatalog> {
  const diagnostics: SkillDiagnostic[] = []
  const warn = createDiagnosticLogger(diagnostics, logger)
  const matches = await collectSkillFiles(rootDir, diagnostics, logger)
  const summaries: SkillSummary[] = []

  for (const match of matches) {
    try {
      const raw = await fs.readFile(match.skillFilePath, 'utf8')
      summaries.push(parseSkillSummary(match, raw))
    } catch (error) {
      warn({
        severity: 'error',
        message: `Skipping invalid skill definition: ${error instanceof Error ? error.message : String(error)}`,
        directoryPath: match.directoryPath,
        skillFilePath: match.skillFilePath,
      })
    }
  }

  const counts = new Map<string, number>()
  for (const summary of summaries) counts.set(summary.name, (counts.get(summary.name) ?? 0) + 1)
  const duplicateNames = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name))
  for (const summary of summaries) {
    if (!duplicateNames.has(summary.name)) continue
    warn({
      severity: 'error',
      message: `Skipping duplicate skill name: ${summary.name}`,
      directoryPath: summary.directoryPath,
      skillFilePath: summary.skillFilePath,
      name: summary.name,
    })
  }

  return {
    skills: summaries.filter((summary) => !duplicateNames.has(summary.name)).sort((a, b) => a.name.localeCompare(b.name)),
    diagnostics,
  }
}

export async function listSkills(rootDir: string, logger: Logger): Promise<SkillSummary[]> {
  return (await loadSkillCatalog(rootDir, logger)).skills
}

export function createSkillUri(skillName: string, filePath: string): string {
  return `skill://${skillName}/${filePath.split(path.sep).map(encodeURIComponent).join('/')}`
}

export function createSkillIndex(skills: SkillSummary[]) {
  return {
    $schema: SKILL_INDEX_SCHEMA,
    skills: skills.map((skill) => ({
      name: skill.name,
      type: 'skill-md',
      description: skill.description,
      url: skill.uri,
    })),
  }
}

export function inferSkillMimeType(filePath: string): string {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? 'application/octet-stream'
}

function isTextMimeType(mimeType: string, filePath: string): boolean {
  if (mimeType.startsWith('text/')) return true
  if (mimeType === 'application/json' || mimeType === 'application/xml' || mimeType === 'application/yaml') return true
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function assertRelativeSkillPath(filePath: string): string {
  if (!filePath || filePath.includes('\x00')) throw new Error('Skill resource path is empty or invalid')
  if (path.isAbsolute(filePath)) throw new Error(`Skill resource path must be relative: ${filePath}`)
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'))
  if (normalized === '.' || normalized.startsWith('/') || normalized.startsWith('../') || normalized === '..') {
    throw new Error(`Skill resource path escapes skill directory: ${filePath}`)
  }
  return normalized
}

function isPathInsideDirectory(candidate: string, directory: string): boolean {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

export async function readSkillResource(rootDir: string, skillName: string, filePath: string, logger: Logger): Promise<SkillResource> {
  const catalog = await loadSkillCatalog(rootDir, logger)
  const skill = catalog.skills.find((item) => item.name === skillName)
  if (!skill) throw new Error(`Skill not found: ${skillName}`)

  const relativePath = assertRelativeSkillPath(filePath)
  const requestedPath = path.resolve(skill.directoryPath, relativePath)
  const realSkillDirectory = await fs.realpath(skill.directoryPath)
  const realResourcePath = await fs.realpath(requestedPath)
  if (!isPathInsideDirectory(realResourcePath, realSkillDirectory)) {
    throw new Error(`Skill resource path escapes skill directory: ${filePath}`)
  }

  const stats = await fs.stat(realResourcePath)
  if (!stats.isFile()) throw new Error(`Skill resource is not a file: ${filePath}`)

  const mimeType = inferSkillMimeType(relativePath)
  const uri = createSkillUri(skill.name, relativePath)
  if (isTextMimeType(mimeType, relativePath)) {
    return { uri, mimeType, content: await fs.readFile(realResourcePath, 'utf8'), encoding: 'text' }
  }
  return { uri, mimeType, content: (await fs.readFile(realResourcePath)).toString('base64'), encoding: 'base64' }
}
