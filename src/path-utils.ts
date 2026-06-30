import os from 'node:os'
import path from 'node:path'

export function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(os.homedir(), value.slice(2))
  return value
}

export function normalizePath(value: string): string {
  const trimmed = value.trim().replace(/^["']|["']$/g, '')
  return path.normalize(trimmed)
}

export function resolvePath(value: string): string {
  return path.resolve(expandHome(normalizePath(value)))
}

