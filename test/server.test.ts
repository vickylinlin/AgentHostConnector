import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'
import { loadConfig } from '../src/config.js'
import { createRuntime, type Runtime } from '../src/runtime.js'
import { createApp } from '../src/server.js'

type RunningServer = {
  runtime: Runtime
  baseUrl: string
  close(): Promise<void>
}

const running: RunningServer[] = []

async function tempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

async function startRuntime(configPath: string, skillsDirs: string[], allowedDirectories: string[] = []): Promise<RunningServer> {
  const config = await loadConfig(
    {
      configPath,
      host: '127.0.0.1',
      port: 1,
      skillsDirs,
      allowedDirectories,
      logLevel: 'error',
    },
    {},
  )
  const runtime = await createRuntime(config)
  const app = createApp(runtime)
  const wss = new WebSocketServer({ noServer: true })
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const created = serve({ fetch: app.fetch, websocket: { server: wss }, hostname: '127.0.0.1', port: 0 }, () => resolve(created))
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No server address')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const result = {
    runtime,
    baseUrl,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }
  running.push(result)
  return result
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(running.splice(0).map((item) => item.close()))
})

describe('server', () => {
  it('serves status, config, skills, and tool lists', async () => {
    const root = await tempDir('ahc-server-')
    const skillsDir = path.join(root, 'skills')
    await fs.mkdir(path.join(skillsDir, 'hello'), { recursive: true })
    await fs.writeFile(path.join(skillsDir, 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Test skill\n---\nUse me.')

    const server = await startRuntime(path.join(root, 'config.yaml'), [skillsDir])
    expect((await server.runtime.mcpHost().transport).sessionId).toBeUndefined()

    const health = await fetch(`${server.baseUrl}/healthz`)
    expect(await health.json()).toEqual({ ok: true })

    const status = await (await fetch(`${server.baseUrl}/api/status`)).json()
    expect(status.mcpUrl).toContain('/mcp')
    expect(status.browserMcpUrl).toContain('/browser/mcp')
    expect(status.browserConnected).toBe(false)
    expect(status.browserToolCount).toBe(0)
    expect(status.filesystemToolsRegistered).toBe(false)
    expect(status.skillsDirs).toEqual([skillsDir])

    const browserStatus = await (await fetch(`${server.baseUrl}/api/browser/status`)).json()
    expect(browserStatus.browserMcpUrl).toContain('/browser/mcp')
    expect(browserStatus.browserBridgeUrl).toContain('/api/browser/bridge')
    expect(browserStatus.browserConnected).toBe(false)
    expect(browserStatus.tools).toEqual([])

    const skills = await (await fetch(`${server.baseUrl}/api/skills`)).json()
    expect(skills.skills).toHaveLength(1)
    expect(skills.skills[0].uri).toBe('skill://hello/SKILL.md')
    expect(skills.diagnostics).toEqual([])

    const tools = await (await fetch(`${server.baseUrl}/api/tools`)).json()
    expect(tools.tools).toEqual([])
  })

  it('hot-updates filesystem tools after saving config', async () => {
    const root = await tempDir('ahc-server-')
    const skillsDir = path.join(root, 'skills')
    const allowed = path.join(root, 'allowed')
    await fs.mkdir(skillsDir, { recursive: true })
    await fs.mkdir(allowed, { recursive: true })

    const server = await startRuntime(path.join(root, 'config.yaml'), [skillsDir])
    let tools = await (await fetch(`${server.baseUrl}/api/tools`)).json()
    expect(tools.tools.some((tool: { name: string }) => tool.name === 'read_text_file')).toBe(false)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await fetch(`${server.baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: 18990,
        skillsDirs: [skillsDir],
        allowedDirectories: [allowed],
        logLevel: 'error',
      }),
    })
    expect(response.ok).toBe(true)
    const output = log.mock.calls.map(([message]) => String(message)).join('\n')
    expect(output).toContain('Config saved')
    expect(output).toContain('Config Path')
    expect(output).toContain('Skills Directories')
    expect(output).toContain('Allowed Directories')
    expect(output).toContain(allowed)
    expect(output).toContain('Restart Required     yes')

    tools = await (await fetch(`${server.baseUrl}/api/tools`)).json()
    expect(tools.tools.some((tool: { name: string }) => tool.name === 'read_text_file')).toBe(true)

    const status = await (await fetch(`${server.baseUrl}/api/status`)).json()
    expect(status.restartRequired).toBe(true)
    expect(status.skillsDirs).toEqual([skillsDir])
  })

  it('allows an MCP client to list resources and tools', async () => {
    const root = await tempDir('ahc-mcp-')
    const skillsDir = path.join(root, 'skills')
    const allowed = path.join(root, 'allowed')
    await fs.mkdir(path.join(skillsDir, 'hello'), { recursive: true })
    await fs.writeFile(path.join(skillsDir, 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Test skill\n---\nUse me.')
    await fs.mkdir(allowed, { recursive: true })

    const server = await startRuntime(path.join(root, 'config.yaml'), [skillsDir], [allowed])
    const client = new Client({ name: 'agent-host-connector-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`))
    await client.connect(transport)
    try {
      expect(client.getServerCapabilities()?.extensions?.['io.modelcontextprotocol/skills']).toEqual({})
      const resources = await client.listResources()
      expect(resources.resources.map((resource) => resource.uri)).toContain('skill://index.json')
      expect(resources.resources.map((resource) => resource.uri)).toContain('skill://hello/SKILL.md')
      const templates = await client.listResourceTemplates()
      expect(templates.resourceTemplates.map((template) => template.uriTemplate)).toContain('skill://{skillName}/{+filePath}')
      const index = await client.readResource({ uri: 'skill://index.json' })
      expect(JSON.parse(index.contents[0].text ?? '{}')).toEqual({
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: [
          {
            name: 'hello',
            type: 'skill-md',
            description: 'Test skill',
            url: 'skill://hello/SKILL.md',
          },
        ],
      })
      const skill = await client.readResource({ uri: 'skill://hello/SKILL.md' })
      expect(skill.contents[0].text).toContain('Use me.')
      await fs.mkdir(path.join(skillsDir, 'hello', 'references'), { recursive: true })
      await fs.writeFile(path.join(skillsDir, 'hello', 'references', 'guide.md'), '# Guide')
      const guide = await client.readResource({ uri: 'skill://hello/references/guide.md' })
      expect(guide.contents[0].text).toBe('# Guide')
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).not.toContain('get_skill_detail')
      expect(tools.tools.map((tool) => tool.name)).toContain('read_text_file')
    } finally {
      await client.close()
    }
  })

  it('serves browser MCP tools registered by a NavPilot bridge client', async () => {
    const root = await tempDir('ahc-browser-')
    const skillsDir = path.join(root, 'skills')
    await fs.mkdir(skillsDir, { recursive: true })

    const server = await startRuntime(path.join(root, 'config.yaml'), [skillsDir])
    const emptyClient = new Client({ name: 'browser-empty-test', version: '1.0.0' })
    const emptyTransport = new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/browser/mcp`))
    await emptyClient.connect(emptyTransport)
    try {
      expect((await emptyClient.listTools()).tools).toEqual([])
    } finally {
      await emptyClient.close()
    }

    const socket = new WebSocket(`${server.baseUrl.replace('http:', 'ws:')}/api/browser/bridge`)
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve)
      socket.once('error', reject)
    })
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as { type: string; id: string; toolName: string; args?: Record<string, unknown> }
      if (message.type !== 'call') return
      socket.send(JSON.stringify({
        type: 'call_result',
        id: message.id,
        ok: true,
        result: { toolName: message.toolName, args: message.args, value: 'ok' },
      }))
    })
    socket.send(JSON.stringify({
      type: 'register',
      clientName: 'NavPilot Test',
      extensionId: 'test-extension',
      tools: [{
        name: 'tab_list',
        title: 'List Tabs',
        description: 'Lists browser tabs.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        outputSchema: { type: 'object', properties: { value: { type: 'string' } } },
        annotations: { readOnlyHint: true },
      }],
    }))

    await vi.waitFor(async () => {
      const status = await (await fetch(`${server.baseUrl}/api/browser/status`)).json()
      expect(status.browserConnected).toBe(true)
      expect(status.browserToolCount).toBe(1)
    })

    const client = new Client({ name: 'browser-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/browser/mcp`))
    await client.connect(transport)
    try {
      const tools = await client.listTools()
      expect(tools.tools.map((tool) => tool.name)).toEqual(['tab_list'])
      const result = await client.callTool({ name: 'tab_list', arguments: { includeInactive: true } })
      expect(result.structuredContent).toEqual({
        toolName: 'tab_list',
        args: { includeInactive: true },
        value: 'ok',
      })
    } finally {
      await client.close()
      socket.close()
    }
  })

  it('hot-updates skill resources after saving config', async () => {
    const root = await tempDir('ahc-mcp-hot-')
    const oldSkillsDir = path.join(root, 'old-skills')
    const newSkillsDir = path.join(root, 'new-skills')
    await fs.mkdir(path.join(oldSkillsDir, 'old-skill'), { recursive: true })
    await fs.writeFile(path.join(oldSkillsDir, 'old-skill', 'SKILL.md'), '---\nname: old-skill\ndescription: Old\n---\nOld')
    await fs.mkdir(path.join(newSkillsDir, 'new-skill'), { recursive: true })
    await fs.writeFile(path.join(newSkillsDir, 'new-skill', 'SKILL.md'), '---\nname: new-skill\ndescription: New\n---\nNew')

    const server = await startRuntime(path.join(root, 'config.yaml'), [oldSkillsDir])
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await fetch(`${server.baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: 1,
        skillsDirs: [newSkillsDir],
        allowedDirectories: [],
        logLevel: 'error',
      }),
    })
    expect(response.ok).toBe(true)

    const client = new Client({ name: 'agent-host-connector-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`))
    await client.connect(transport)
    try {
      const index = await client.readResource({ uri: 'skill://index.json' })
      expect(JSON.parse(index.contents[0].text ?? '{}').skills.map((skill: { name: string }) => skill.name)).toEqual(['new-skill'])
    } finally {
      await client.close()
    }
  })

  it('serves only the overriding skill from multiple configured directories', async () => {
    const root = await tempDir('ahc-mcp-multi-')
    const firstSkillsDir = path.join(root, 'first-skills')
    const secondSkillsDir = path.join(root, 'second-skills')
    await fs.mkdir(path.join(firstSkillsDir, 'shared'), { recursive: true })
    await fs.writeFile(path.join(firstSkillsDir, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: First\n---\nFirst')
    await fs.mkdir(path.join(secondSkillsDir, 'shared'), { recursive: true })
    await fs.writeFile(path.join(secondSkillsDir, 'shared', 'SKILL.md'), '---\nname: shared\ndescription: Second\n---\nSecond')

    const server = await startRuntime(path.join(root, 'config.yaml'), [firstSkillsDir, secondSkillsDir])
    const client = new Client({ name: 'agent-host-connector-test', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`${server.baseUrl}/mcp`))
    await client.connect(transport)
    try {
      const resources = await client.listResources()
      expect(resources.resources.filter((resource) => resource.uri === 'skill://shared/SKILL.md')).toHaveLength(1)
      const index = await client.readResource({ uri: 'skill://index.json' })
      expect(JSON.parse(index.contents[0].text ?? '{}').skills).toEqual([
        {
          name: 'shared',
          type: 'skill-md',
          description: 'Second',
          url: 'skill://shared/SKILL.md',
        },
      ])
      const skill = await client.readResource({ uri: 'skill://shared/SKILL.md' })
      expect(skill.contents[0].text).toContain('Second')
    } finally {
      await client.close()
    }
  })
})
