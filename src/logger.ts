import type { LogLevel } from './types.js'

const order: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
}

export type Logger = {
  debug(message: string, data?: unknown): void
  info(message: string, data?: unknown): void
  warn(message: string, data?: unknown): void
  error(message: string, data?: unknown): void
  setLevel(level: LogLevel): void
  level(): LogLevel
}

function write(level: LogLevel, message: string, data?: unknown) {
  const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export function createLogger(initialLevel: LogLevel): Logger {
  let current = initialLevel
  const enabled = (level: LogLevel) => order[level] >= order[current]
  return {
    debug: (message, data) => {
      if (enabled('debug')) write('debug', message, data)
    },
    info: (message, data) => {
      if (enabled('info')) write('info', message, data)
    },
    warn: (message, data) => {
      if (enabled('warn')) write('warn', message, data)
    },
    error: (message, data) => {
      if (enabled('error')) write('error', message, data)
    },
    setLevel: (level) => {
      current = level
    },
    level: () => current,
  }
}
