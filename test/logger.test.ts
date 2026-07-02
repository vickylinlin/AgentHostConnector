import { describe, expect, it } from 'vitest'
import { formatConfigDetails } from '../src/logger.js'

describe('logger', () => {
  it('formats config details with an empty allowed directory list', () => {
    const output = formatConfigDetails({
      title: 'AgentHostConnector started',
      webUrl: 'http://127.0.0.1:18989/',
      mcpUrl: 'http://127.0.0.1:18989/mcp',
      configPath: '/tmp/config.yaml',
      host: '127.0.0.1',
      port: 18989,
      skillsDir: '/tmp/skills',
      allowedDirectories: [],
      logLevel: 'info',
    })

    expect(output).toContain('AgentHostConnector started')
    expect(output).toContain('Web Admin            http://127.0.0.1:18989/')
    expect(output).toContain('MCP Endpoint         http://127.0.0.1:18989/mcp')
    expect(output).toContain('Config Path          /tmp/config.yaml')
    expect(output).toContain('Host                 127.0.0.1')
    expect(output).toContain('Port                 18989')
    expect(output).toContain('Skills Directory     /tmp/skills')
    expect(output).toContain('Allowed Directories  none')
    expect(output).toContain('Log Level            info')
  })

  it('formats multiple allowed directories and restart details', () => {
    const output = formatConfigDetails({
      title: 'Config saved',
      webUrl: 'http://127.0.0.1:18989/',
      mcpUrl: 'http://127.0.0.1:18989/mcp',
      configPath: '/tmp/config.yaml',
      host: '127.0.0.1',
      port: 19000,
      skillsDir: '/tmp/skills',
      allowedDirectories: ['/tmp/one', '/tmp/two'],
      logLevel: 'debug',
      restartRequired: true,
    })
    const lines = output.split('\n')
    const allowedLine = lines.findIndex((line) => line.includes('Allowed Directories'))

    expect(output).toContain('Config saved')
    expect(lines[allowedLine]).toContain('/tmp/one')
    expect(lines[allowedLine + 1].trim()).toBe('/tmp/two')
    expect(output).toContain('Restart Required     yes')
  })
})
