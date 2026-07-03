export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type AppConfig = {
  host: string
  port: number
  skillsDirs: string[]
  allowedDirectories: string[]
  logLevel: LogLevel
}

export type LoadedConfig = AppConfig & {
  configPath: string
}

export type BrowserBridgeStatus = {
  browserMcpUrl: string
  browserBridgeUrl: string
  browserConnected: boolean
  browserToolCount: number
  browserConnectedAt: string | null
  browserLastRegisteredAt: string | null
  browserClientName: string | null
  browserExtensionId: string | null
  tools: ToolSummary[]
}

export type RuntimeStatus = {
  name: string
  version: string
  configPath: string
  mcpUrl: string
  webUrl: string
  host: string
  port: number
  configuredHost: string
  configuredPort: number
  restartRequired: boolean
  uptimeSeconds: number
  nodeVersion: string
  skillsDirs: string[]
  allowedDirectories: string[]
  filesystemToolsRegistered: boolean
  startedAt: string
  browserMcpUrl: string
  browserConnected: boolean
  browserToolCount: number
  browserLastRegisteredAt: string | null
}

export type ToolSummary = {
  name: string
  title: string
  description: string
  source: 'skills' | 'filesystem' | 'browser'
  readOnly: boolean
}
