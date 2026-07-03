import { fromJsonSchema, McpServer, WebStandardStreamableHTTPServerTransport, type CallToolResult, type JsonSchemaType, type RegisteredTool, type Tool } from '@modelcontextprotocol/server'
import type { WSContext } from 'hono/ws'
import type { Logger } from './logger.js'
import type { BrowserBridgeStatus } from './types.js'

type JsonObjectSchema = JsonSchemaType & {
  type: 'object'
  properties?: Record<string, JsonSchemaType>
  required?: string[]
}

export type BrowserToolRegistration = {
  name: string
  title?: string
  description?: string
  inputSchema: JsonObjectSchema
  outputSchema?: JsonObjectSchema
  annotations?: Tool['annotations']
  _meta?: Record<string, unknown>
}

type BrowserRegisterMessage = {
  type: 'register'
  clientName?: string
  extensionId?: string
  tools: BrowserToolRegistration[]
}

type BrowserCallResultMessage = {
  type: 'call_result'
  id: string
  ok: boolean
  result?: unknown
  error?: string
}

type BrowserBridgeMessage = BrowserRegisterMessage | BrowserCallResultMessage

type PendingCall = {
  resolve: (result: CallToolResult) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

type BridgeSocket = Pick<WSContext<WebSocket>, 'send' | 'close'>

const CALL_TIMEOUT_MS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function textResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {}),
  }
}

function resultToMcpResult(value: unknown): CallToolResult {
  if (isRecord(value) && Array.isArray(value.content)) return value as CallToolResult
  if (isRecord(value)) return textResult(JSON.stringify(value, null, 2), value)
  return textResult(String(value ?? ''), { value })
}

async function dataToString(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(data)
  if (data instanceof Blob) return data.text()
  return String(data)
}

function parseMessage(data: string): BrowserBridgeMessage {
  const parsed = JSON.parse(data) as unknown
  if (!isRecord(parsed) || typeof parsed.type !== 'string') throw new Error('Invalid browser bridge message.')
  return parsed as BrowserBridgeMessage
}

export class BrowserBridge {
  private socket: BridgeSocket | null = null
  private tools: BrowserToolRegistration[] = []
  private pending = new Map<string, PendingCall>()
  private registeredTools = new Map<string, RegisteredTool>()
  private server: McpServer | null = null
  private connectedAt: string | null = null
  private lastRegisteredAt: string | null = null
  private clientName = ''
  private extensionId = ''
  private onToolListChanged?: () => void

  constructor(private readonly logger: Logger) {}

  setMcpServer(server: McpServer): void {
    this.server = server
  }

  setToolListChangedHandler(handler: () => void): void {
    this.onToolListChanged = handler
  }

  attachSocket(socket: BridgeSocket): void {
    if (this.socket && this.socket !== socket) {
      this.logger.info('Replacing active browser bridge connection.')
      this.socket.close()
    }
    this.socket = socket
    this.connectedAt = new Date().toISOString()
    this.tools = []
    this.clientName = ''
    this.extensionId = ''
    this.rejectPending('Browser bridge connection was replaced.')
    this.notifyToolListChanged()
  }

  async handleMessage(data: unknown): Promise<void> {
    const message = parseMessage(await dataToString(data))
    if (message.type === 'register') {
      this.tools = message.tools.filter((tool) => tool.name && tool.inputSchema?.type === 'object')
      this.syncRegisteredTools()
      this.clientName = message.clientName ?? ''
      this.extensionId = message.extensionId ?? ''
      this.lastRegisteredAt = new Date().toISOString()
      this.logger.info('Browser tools registered.', { count: this.tools.length })
      this.notifyToolListChanged()
      return
    }

    if (message.type === 'call_result') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timeout)
      this.pending.delete(message.id)
      if (message.ok) pending.resolve(resultToMcpResult(message.result))
      else pending.reject(new Error(message.error || 'Browser tool call failed.'))
    }
  }

  detachSocket(socket?: BridgeSocket): void {
    if (socket && this.socket !== socket) return
    this.socket = null
    this.tools = []
    this.syncRegisteredTools()
    this.clientName = ''
    this.extensionId = ''
    this.rejectPending('Browser bridge disconnected.')
    this.notifyToolListChanged()
  }

  status(listenHost: string, listenPort: number): BrowserBridgeStatus {
    return {
      browserMcpUrl: `http://${listenHost}:${listenPort}/browser/mcp`,
      browserBridgeUrl: `ws://${listenHost}:${listenPort}/api/browser/bridge`,
      browserConnected: Boolean(this.socket),
      browserToolCount: this.tools.length,
      browserConnectedAt: this.connectedAt,
      browserLastRegisteredAt: this.lastRegisteredAt,
      browserClientName: this.clientName || null,
      browserExtensionId: this.extensionId || null,
      tools: this.tools.map((tool) => ({
        name: tool.name,
        title: tool.title ?? tool.name,
        description: tool.description ?? '',
        source: 'browser' as const,
        readOnly: Boolean(tool.annotations?.readOnlyHint),
      })),
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    if (!this.socket) throw new Error('NavPilot browser bridge is not connected.')
    if (!this.tools.some((tool) => tool.name === name)) throw new Error(`Browser tool "${name}" is not registered.`)

    const id = crypto.randomUUID()
    return new Promise<CallToolResult>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Browser tool "${name}" timed out after ${CALL_TIMEOUT_MS / 1000}s.`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timeout })
      this.socket?.send(JSON.stringify({ type: 'call', id, toolName: name, args }))
    })
  }

  private rejectPending(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(message))
      this.pending.delete(id)
    }
  }

  private notifyToolListChanged(): void {
    try {
      this.onToolListChanged?.()
    } catch (error) {
      this.logger.warn('Failed to notify browser MCP tool list change.', error instanceof Error ? error.message : String(error))
    }
  }

  private syncRegisteredTools(): void {
    if (!this.server) return
    const nextNames = new Set(this.tools.map((tool) => tool.name))
    for (const [name, registered] of this.registeredTools) {
      if (!nextNames.has(name)) {
        registered.remove()
        this.registeredTools.delete(name)
      }
    }
    for (const tool of this.tools) {
      const inputSchema = fromJsonSchema(tool.inputSchema)
      const outputSchema = tool.outputSchema ? fromJsonSchema(tool.outputSchema) : undefined
      const callback = async (args: unknown) => {
        const record = isRecord(args) ? args : {}
        return this.callTool(tool.name, record)
      }
      const existing = this.registeredTools.get(tool.name)
      if (existing) {
        existing.update({
          title: tool.title ?? tool.name,
          description: tool.description,
          paramsSchema: inputSchema,
          ...(outputSchema ? { outputSchema } : {}),
          annotations: tool.annotations,
          _meta: tool._meta,
          callback,
          enabled: true,
        })
      } else {
        this.registeredTools.set(
          tool.name,
          this.server.registerTool(
            tool.name,
            {
              title: tool.title ?? tool.name,
              description: tool.description,
              inputSchema,
              ...(outputSchema ? { outputSchema } : {}),
              annotations: tool.annotations,
              _meta: tool._meta,
            },
            callback,
          ),
        )
      }
    }
  }
}

export type BrowserMcpHost = {
  server: McpServer
  transport: WebStandardStreamableHTTPServerTransport
  bridge: BrowserBridge
}

export async function createBrowserMcpHost(bridge: BrowserBridge): Promise<BrowserMcpHost> {
  const server = new McpServer(
    { name: 'navpilot-browser', version: '0.1.0' },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        'This endpoint exposes browser automation tools registered by a locally connected NavPilot Chrome extension. If no extension is connected, no tools are available.',
    },
  )

  bridge.setMcpServer(server)
  bridge.setToolListChangedHandler(() => server.sendToolListChanged())

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)

  return { server, transport, bridge }
}
