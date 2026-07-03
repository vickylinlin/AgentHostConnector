import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../src/logger.js'
import { createSkillIndex, loadSkillCatalog, readSkillResource } from '../src/skills.js'

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ahc-skills-'))
}

async function writeSkill(root: string, name: string, body = 'Use me.') {
  const skillDir = path.join(root, name)
  await fs.mkdir(skillDir, { recursive: true })
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}`)
  return skillDir
}

describe('skills', () => {
  it('creates a standard skill index for valid skills', async () => {
    const root = await tempDir()
    await writeSkill(root, 'good-skill')

    const catalog = await loadSkillCatalog([root], createLogger('error'))
    expect(catalog.skills).toHaveLength(1)
    expect(catalog.skills[0]).toMatchObject({
      name: 'good-skill',
      description: 'good-skill skill',
      uri: 'skill://good-skill/SKILL.md',
    })
    expect(createSkillIndex(catalog.skills)).toEqual({
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [
        {
          name: 'good-skill',
          type: 'skill-md',
          description: 'good-skill skill',
          url: 'skill://good-skill/SKILL.md',
        },
      ],
    })
  })

  it('reads SKILL.md and supporting resources', async () => {
    const root = await tempDir()
    const skillDir = await writeSkill(root, 'reader')
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true })
    await fs.writeFile(path.join(skillDir, 'references', 'guide.md'), '# Guide')

    await expect(readSkillResource([root], 'reader', 'SKILL.md', createLogger('error'))).resolves.toMatchObject({
      uri: 'skill://reader/SKILL.md',
      mimeType: 'text/markdown',
      content: expect.stringContaining('name: reader'),
      encoding: 'text',
    })
    await expect(readSkillResource([root], 'reader', 'references/guide.md', createLogger('error'))).resolves.toMatchObject({
      uri: 'skill://reader/references/guide.md',
      mimeType: 'text/markdown',
      content: '# Guide',
      encoding: 'text',
    })
  })

  it('skips invalid skills and overrides duplicate names with diagnostics', async () => {
    const root = await tempDir()
    await fs.mkdir(path.join(root, 'bad-name'), { recursive: true })
    await fs.writeFile(path.join(root, 'bad-name', 'SKILL.md'), '---\nname: BadName\ndescription: Bad\n---\nBad')
    await fs.mkdir(path.join(root, 'missing-description'), { recursive: true })
    await fs.writeFile(path.join(root, 'missing-description', 'SKILL.md'), '---\nname: missing-description\n---\nBad')
    await writeSkill(path.join(root, 'a'), 'same')
    await writeSkill(path.join(root, 'b'), 'same')

    const catalog = await loadSkillCatalog([root], createLogger('error'))
    expect(catalog.skills).toHaveLength(1)
    expect(catalog.skills[0].name).toBe('same')
    expect(catalog.skills[0].directoryPath).toBe(path.join(root, 'b', 'same'))
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Invalid skill name'),
        expect.stringContaining('Missing string frontmatter field: description'),
        expect.stringContaining('Overriding duplicate skill name: same'),
      ]),
    )
  })

  it('loads multiple roots and reads resources from the overriding skill', async () => {
    const firstRoot = await tempDir()
    const secondRoot = await tempDir()
    await writeSkill(firstRoot, 'shared', 'first')
    const overridingSkillDir = await writeSkill(secondRoot, 'shared', 'second')
    await writeSkill(firstRoot, 'first-only')
    await writeSkill(secondRoot, 'second-only')
    await fs.mkdir(path.join(overridingSkillDir, 'references'), { recursive: true })
    await fs.writeFile(path.join(overridingSkillDir, 'references', 'guide.md'), 'overridden guide')

    const catalog = await loadSkillCatalog([firstRoot, secondRoot], createLogger('error'))
    expect(catalog.skills.map((skill) => skill.name)).toEqual(['first-only', 'second-only', 'shared'])
    expect(catalog.skills.find((skill) => skill.name === 'shared')?.directoryPath).toBe(overridingSkillDir)
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Overriding duplicate skill name: shared')]),
    )

    await expect(readSkillResource([firstRoot, secondRoot], 'shared', 'SKILL.md', createLogger('error'))).resolves.toMatchObject({
      content: expect.stringContaining('second'),
    })
    await expect(readSkillResource([firstRoot, secondRoot], 'shared', 'references/guide.md', createLogger('error'))).resolves.toMatchObject({
      content: 'overridden guide',
    })
  })

  it('rejects path escapes, absolute paths, directories, and symlink escapes', async () => {
    const root = await tempDir()
    const skillDir = await writeSkill(root, 'secure')
    const outside = path.join(root, 'outside.md')
    await fs.writeFile(outside, 'secret')
    await fs.mkdir(path.join(skillDir, 'references'), { recursive: true })
    await fs.symlink(outside, path.join(skillDir, 'references', 'outside.md'))

    await expect(readSkillResource([root], 'secure', '../outside.md', createLogger('error'))).rejects.toThrow('escapes')
    await expect(readSkillResource([root], 'secure', outside, createLogger('error'))).rejects.toThrow('relative')
    await expect(readSkillResource([root], 'secure', 'references', createLogger('error'))).rejects.toThrow('not a file')
    await expect(readSkillResource([root], 'secure', 'references/outside.md', createLogger('error'))).rejects.toThrow('escapes')
  })
})
