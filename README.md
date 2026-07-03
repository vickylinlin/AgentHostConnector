# AgentHostConnector

Local HTTP MCP host connector for NavPilot and other agents.

```bash
npx --yes github:vickylinlin/AgentHostConnector
```

Defaults:

- MCP endpoint: `http://127.0.0.1:18989/mcp`
- Web admin: `http://127.0.0.1:18989/`
- Config: `~/.config/navpilot-hostconnector/config.yaml`
- Skills directories: `~/.agents/skills`
- Allowed filesystem directories: none

Example config:

```yaml
host: 127.0.0.1
port: 18989
skillsDirs:
  - ~/.agents/skills
  - ~/Dev/project-skills
allowedDirectories:
  - ~/Dev/workspace
logLevel: info
```

CLI overrides have priority over environment variables, YAML, and defaults:

```bash
agent-host-connector --port 19000 --skills-dir ~/.agents/skills --skills-dir ~/Dev/project-skills --allow-dir ~/Dev/workspace
```

When multiple skill directories contain a skill with the same name, later directories override earlier ones.
