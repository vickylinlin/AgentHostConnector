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