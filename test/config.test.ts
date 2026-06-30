import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig, parseCliArgs } from '../src/config.js'

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ahc-config-'))
}

describe('config', () => {
  it('loads defaults and expands paths', async () => {
    const dir = await tempDir()
    const config = await loadConfig({ configPath: path.join(dir, 'missing.yaml') }, {})
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(18989)
    expect(config.skillsDir).toBe(path.join(os.homedir(), '.agents', 'skills'))
    expect(config.allowedDirectories).toEqual([])
  })

  it('applies CLI over env over yaml', async () => {
    const dir = await tempDir()
    const configPath = path.join(dir, 'config.yaml')
    await fs.writeFile(
      configPath,
      ['host: 0.0.0.0', 'port: 1000', 'skillsDir: ./yaml-skills', 'allowedDirectories:', '  - ./yaml-allowed', 'logLevel: warn'].join('\n'),
    )
    const config = await loadConfig(
      parseCliArgs(['--config', configPath, '--port', '3000', '--allow-dir', './cli-allowed']),
      { HOST: '127.0.0.2', PORT: '2000', SKILLS_DIR: './env-skills', LOG_LEVEL: 'debug' },
    )
    expect(config.host).toBe('127.0.0.2')
    expect(config.port).toBe(3000)
    expect(config.skillsDir).toBe(path.resolve('./env-skills'))
    expect(config.allowedDirectories).toEqual([path.resolve('./cli-allowed')])
    expect(config.logLevel).toBe('debug')
  })
})

