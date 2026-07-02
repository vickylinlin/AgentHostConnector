import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

async function startRuntime(configPath: string, skillsDir: string, allowedDirectories: string[] = []): Promise<RunningServer> {
  const config = await loadConfig(
    {
      configPath,
      host: '127.0.0.1',
      port: 1,
      skillsDir,
      allowedDirectories,
      logLevel: 'error',
    },
    {},
  )
  const runtime = await createRuntime(config)
  const app = createApp(runtime)
  const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
    const created = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 }, () => resolve(created))
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

    const server = await startRuntime(path.join(root, 'config.yaml'), skillsDir)
    expect((await server.runtime.mcpHost().transport).sessionId).toBeUndefined()

    const health = await fetch(`${server.baseUrl}/healthz`)
    expect(await health.json()).toEqual({ ok: true })

    const status = await (await fetch(`${server.baseUrl}/api/status`)).json()
    expect(status.mcpUrl).toContain('/mcp')
    expect(status.filesystemToolsRegistered).toBe(false)

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

    const server = await startRuntime(path.join(root, 'config.yaml'), skillsDir)
    let tools = await (await fetch(`${server.baseUrl}/api/tools`)).json()
    expect(tools.tools.some((tool: { name: string }) => tool.name === 'read_text_file')).toBe(false)

    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await fetch(`${server.baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: 18990,
        skillsDir,
        allowedDirectories: [allowed],
        logLevel: 'error',
      }),
    })
    expect(response.ok).toBe(true)
    const output = log.mock.calls.map(([message]) => String(message)).join('\n')
    expect(output).toContain('Config saved')
    expect(output).toContain('Config Path')
    expect(output).toContain('Skills Directory')
    expect(output).toContain('Allowed Directories')
    expect(output).toContain(allowed)
    expect(output).toContain('Restart Required     yes')

    tools = await (await fetch(`${server.baseUrl}/api/tools`)).json()
    expect(tools.tools.some((tool: { name: string }) => tool.name === 'read_text_file')).toBe(true)

    const status = await (await fetch(`${server.baseUrl}/api/status`)).json()
    expect(status.restartRequired).toBe(true)
  })

  it('allows an MCP client to list resources and tools', async () => {
    const root = await tempDir('ahc-mcp-')
    const skillsDir = path.join(root, 'skills')
    const allowed = path.join(root, 'allowed')
    await fs.mkdir(path.join(skillsDir, 'hello'), { recursive: true })
    await fs.writeFile(path.join(skillsDir, 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Test skill\n---\nUse me.')
    await fs.mkdir(allowed, { recursive: true })

    const server = await startRuntime(path.join(root, 'config.yaml'), skillsDir, [allowed])
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

  it('hot-updates skill resources after saving config', async () => {
    const root = await tempDir('ahc-mcp-hot-')
    const oldSkillsDir = path.join(root, 'old-skills')
    const newSkillsDir = path.join(root, 'new-skills')
    await fs.mkdir(path.join(oldSkillsDir, 'old-skill'), { recursive: true })
    await fs.writeFile(path.join(oldSkillsDir, 'old-skill', 'SKILL.md'), '---\nname: old-skill\ndescription: Old\n---\nOld')
    await fs.mkdir(path.join(newSkillsDir, 'new-skill'), { recursive: true })
    await fs.writeFile(path.join(newSkillsDir, 'new-skill', 'SKILL.md'), '---\nname: new-skill\ndescription: New\n---\nNew')

    const server = await startRuntime(path.join(root, 'config.yaml'), oldSkillsDir)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await fetch(`${server.baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        host: '127.0.0.1',
        port: 1,
        skillsDir: newSkillsDir,
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
})
