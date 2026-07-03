import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { McpServer, ResourceTemplate, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { createSkillIndex, loadSkillCatalog, readSkillResource } from './skills.js';
import { registerFilesystemTools } from './fs/tools.js';
function registerSkillCapabilities(server, config, logger) {
    server.registerResource('skill_index', 'skill://index.json', {
        title: 'Skill Index',
        description: 'Discovery index for local Agent Skills served over MCP resources.',
        mimeType: 'application/json',
    }, async (uri) => {
        const catalog = await loadSkillCatalog(config.skillsDirs, logger);
        return {
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(createSkillIndex(catalog.skills)) }],
        };
    });
    server.registerResource('skill_resource', new ResourceTemplate('skill://{skillName}/{+filePath}', {
        list: async () => {
            const catalog = await loadSkillCatalog(config.skillsDirs, logger);
            return {
                resources: catalog.skills.map((skill) => ({
                    uri: skill.uri,
                    name: skill.name,
                    title: skill.name,
                    description: skill.description,
                    mimeType: 'text/markdown',
                    _meta: {
                        'io.modelcontextprotocol.skills/directoryPath': skill.directoryPath,
                    },
                })),
            };
        },
    }), {
        title: 'Skill Resource',
        description: 'Read SKILL.md or supporting files from a local Agent Skill directory.',
    }, async (uri, variables) => {
        const skillName = String(variables.skillName ?? uri.hostname);
        const filePath = String(variables.filePath ?? decodeURIComponent(uri.pathname.replace(/^\//, '')));
        const resource = await readSkillResource(config.skillsDirs, skillName, filePath, logger);
        if (resource.encoding === 'text') {
            return {
                contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.content }],
            };
        }
        return {
            contents: [{ uri: resource.uri, mimeType: resource.mimeType, blob: resource.content }],
        };
    });
}
export async function createMcpHost(config, allowedDirectories, logger) {
    const server = new McpServer({ name: 'agent-host-connector', version: '0.1.0' }, {
        capabilities: {
            resources: { listChanged: true },
            extensions: { 'io.modelcontextprotocol/skills': {} },
            experimental: { 'io.modelcontextprotocol/skills': {} },
        },
        instructions: 'This local connector serves Agent Skills as MCP resources. Read skill://index.json to discover skills, then read skill://<skill-name>/SKILL.md and referenced skill://<skill-name>/<relative-path> files on demand. Filesystem tools are available only for explicitly allowlisted directories.',
    });
    registerSkillCapabilities(server, config, logger);
    const filesystemTools = registerFilesystemTools(server, allowedDirectories);
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    await server.connect(transport);
    return {
        server,
        transport,
        tools: filesystemTools,
    };
}
export function createBaseApp(host) {
    return createMcpHonoApp({ host });
}
//# sourceMappingURL=mcp.js.map