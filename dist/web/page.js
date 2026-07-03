function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
export function renderAdminPage() {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>AgentHostConnector</title>
  <style>
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f4; color: #1d2520; }
    main { max-width: 1120px; margin: 0 auto; padding: 24px; display: grid; gap: 18px; }
    header { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; border-bottom: 1px solid #d8ddd3; padding-bottom: 14px; }
    h1 { font-size: 28px; margin: 0; font-weight: 720; }
    h2 { font-size: 16px; margin: 0 0 12px; }
    section { background: #ffffff; border: 1px solid #d8ddd3; border-radius: 8px; padding: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
    .kv { display: grid; gap: 4px; min-width: 0; }
    .k { font-size: 12px; color: #607068; text-transform: uppercase; }
    .v { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
    label { display: grid; gap: 6px; font-size: 13px; color: #35443d; }
    input, textarea, select { width: 100%; box-sizing: border-box; border: 1px solid #c8d0c7; border-radius: 6px; padding: 9px 10px; font: inherit; background: #fbfcfa; color: inherit; }
    textarea { min-height: 92px; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    button { border: 1px solid #1e5f4a; background: #1e5f4a; color: white; border-radius: 6px; padding: 9px 12px; font: inherit; cursor: pointer; }
    button.secondary { background: #ffffff; color: #1e5f4a; }
    .actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
    .notice { color: #8a5200; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px 8px; border-bottom: 1px solid #e5e8e0; text-align: left; vertical-align: top; }
    th { font-size: 12px; color: #607068; text-transform: uppercase; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    @media (prefers-color-scheme: dark) {
      body { background: #141815; color: #edf1ec; }
      section { background: #1d231f; border-color: #38443d; }
      header { border-color: #38443d; }
      input, textarea, select, button.secondary { background: #151a17; border-color: #4b5a51; color: #edf1ec; }
      th, td { border-color: #38443d; }
      .k, th { color: #a9b7ad; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>AgentHostConnector</h1>
      <button class="secondary" id="refresh" type="button">Refresh</button>
    </header>
    <section>
      <h2>Status</h2>
      <div class="grid" id="status"></div>
    </section>
    <section>
      <h2>Config</h2>
      <form id="config-form">
        <div class="grid">
          <label>Host<input name="host"></label>
          <label>Port<input name="port" type="number" min="1" max="65535"></label>
          <label>Log level<select name="logLevel"><option>debug</option><option>info</option><option>warn</option><option>error</option></select></label>
        </div>
        <label style="margin-top:12px">Skills directories (one path per line)<textarea name="skillsDirs" placeholder="/Users/alex/.agents/skills&#10;/Users/alex/Dev/project-skills"></textarea></label>
        <label style="margin-top:12px">Allowed directories (one path per line)<textarea name="allowedDirectories" placeholder="/Users/alex/Dev/project-a&#10;/Users/alex/Documents/workspace"></textarea></label>
        <div class="actions"><button type="submit">Save</button><span id="save-result"></span></div>
      </form>
    </section>
    <section>
      <h2>Skills</h2>
      <div id="skills"></div>
    </section>
    <section>
      <h2>Filesystem Tools</h2>
      <div id="tools"></div>
    </section>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'": '&#39;'}[c]));
    function kv(label, value, cls = '') { return '<div class="kv '+cls+'"><div class="k">'+esc(label)+'</div><div class="v">'+esc(value)+'</div></div>'; }
    async function json(url, options) {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    }
    async function load() {
      const [status, config, skills, tools] = await Promise.all([json('/api/status'), json('/api/config'), json('/api/skills'), json('/api/tools')]);
      $('status').innerHTML = [
        kv('MCP URL', status.mcpUrl),
        kv('Web URL', status.webUrl),
        kv('Config', status.configPath),
        kv('Node', status.nodeVersion),
        kv('Uptime', status.uptimeSeconds + 's'),
        kv('Restart', status.restartRequired ? 'required for host/port' : 'not required', status.restartRequired ? 'notice' : '')
      ].join('');
      const form = $('config-form');
      form.host.value = config.host;
      form.port.value = config.port;
      form.logLevel.value = config.logLevel;
      form.skillsDirs.value = config.skillsDirs.join('\\n');
      form.allowedDirectories.value = config.allowedDirectories.join('\\n');
      const skillRows = skills.skills.map(s => [s.name, s.description, s.uri, s.directoryPath]);
      const diagnosticRows = (skills.diagnostics ?? []).map(d => [d.severity, d.message, d.name ?? '', d.skillFilePath ?? d.directoryPath ?? '']);
      $('skills').innerHTML =
        (skillRows.length ? table(['Name', 'Description', 'URI', 'Directory'], skillRows) : '<p>No valid skills found.</p>') +
        (diagnosticRows.length ? '<h2 style="margin-top:16px">Skill Diagnostics</h2>' + table(['Level', 'Message', 'Name', 'Path'], diagnosticRows) : '');
      const fsTools = tools.tools.filter(t => t.source === 'filesystem');
      $('tools').innerHTML = '<p><code>'+esc(status.allowedDirectories.join('\\n') || '(none)')+'</code></p>' + (fsTools.length ? table(['Name', 'Mode', 'Description'], fsTools.map(t => [t.name, t.readOnly ? 'read' : 'write', t.description])) : '<p>No filesystem tools registered.</p>');
    }
    function table(headers, rows) {
      return '<table><thead><tr>'+headers.map(h => '<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r => '<tr>'+r.map(c => '<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    }
    $('refresh').addEventListener('click', load);
    $('config-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      $('save-result').textContent = 'Saving...';
      try {
        await json('/api/config', {
          method: 'PUT',
          headers: {'content-type': 'application/json'},
          body: JSON.stringify({
            host: form.host.value,
            port: Number(form.port.value),
            skillsDirs: form.skillsDirs.value.split('\\n').map(s => s.trim()).filter(Boolean),
            allowedDirectories: form.allowedDirectories.value.split('\\n').map(s => s.trim()).filter(Boolean),
            logLevel: form.logLevel.value
          })
        });
        $('save-result').textContent = 'Saved';
        await load();
      } catch (error) {
        $('save-result').textContent = error.message;
      }
    });
    load().catch(error => { $('status').innerHTML = '<p>'+esc(error.message)+'</p>'; });
  </script>
</body>
</html>`;
}
export function renderStatusSummary(status) {
    return escapeHtml(`${status.name} ${status.mcpUrl}`);
}
//# sourceMappingURL=page.js.map