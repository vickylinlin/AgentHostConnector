import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFilesystemContext, resolveAllowedDirectories } from '../src/fs/security.js'

async function tempDir(prefix: string) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix))
}

describe('filesystem security', () => {
  it('rejects paths outside allowed directories', async () => {
    const allowed = await tempDir('ahc-allowed-')
    const outside = await tempDir('ahc-outside-')
    const context = createFilesystemContext((await resolveAllowedDirectories([allowed])).allowedDirectories)
    await expect(context.validatePath(path.join(outside, 'secret.txt'))).rejects.toThrow('Access denied')
  })

  it('rejects symlinks that escape allowed directories', async () => {
    const allowed = await tempDir('ahc-allowed-')
    const outside = await tempDir('ahc-outside-')
    const secret = path.join(outside, 'secret.txt')
    await fs.writeFile(secret, 'secret')
    const link = path.join(allowed, 'link.txt')
    await fs.symlink(secret, link)
    const context = createFilesystemContext((await resolveAllowedDirectories([allowed])).allowedDirectories)
    await expect(context.validatePath(link)).rejects.toThrow('symlink target outside')
  })
})

