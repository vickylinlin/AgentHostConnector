const order = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};
function write(level, message, data) {
    const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`;
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}`;
    if (level === 'error')
        console.error(line);
    else if (level === 'warn')
        console.warn(line);
    else
        console.log(line);
}
export function formatConfigDetails(details) {
    const rows = [
        ['Web Admin', details.webUrl],
        ['MCP Endpoint', details.mcpUrl],
        ['Config Path', details.configPath],
        ['Host', details.host],
        ['Port', String(details.port)],
        ['Skills Directory', details.skillsDir],
        ['Allowed Directories', details.allowedDirectories[0] ?? 'none'],
        ['Log Level', details.logLevel],
    ];
    if (details.restartRequired !== undefined) {
        rows.push(['Restart Required', details.restartRequired ? 'yes' : 'no']);
    }
    const labelWidth = Math.max(...rows.map(([label]) => label.length));
    const lines = [details.title, '-'.repeat(details.title.length)];
    for (const [label, value] of rows) {
        lines.push(`${label.padEnd(labelWidth)}  ${value}`);
        if (label === 'Allowed Directories') {
            for (const directory of details.allowedDirectories.slice(1)) {
                lines.push(`${''.padEnd(labelWidth)}  ${directory}`);
            }
        }
    }
    return lines.join('\n');
}
export function writeConfigDetails(details) {
    console.log(formatConfigDetails(details));
}
export function createLogger(initialLevel) {
    let current = initialLevel;
    const enabled = (level) => order[level] >= order[current];
    return {
        debug: (message, data) => {
            if (enabled('debug'))
                write('debug', message, data);
        },
        info: (message, data) => {
            if (enabled('info'))
                write('info', message, data);
        },
        warn: (message, data) => {
            if (enabled('warn'))
                write('warn', message, data);
        },
        error: (message, data) => {
            if (enabled('error'))
                write('error', message, data);
        },
        setLevel: (level) => {
            current = level;
        },
        level: () => current,
    };
}
//# sourceMappingURL=logger.js.map