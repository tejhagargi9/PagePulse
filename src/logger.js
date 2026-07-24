const priorities = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function createLogger(level = 'info', output = process.stdout) {
  const threshold = priorities[level] ?? priorities.info;
  function write(logLevel, event, fields = {}) {
    if (priorities[logLevel] < threshold) return;
    output.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: logLevel, event, ...fields })}\n`);
  }
  return {
    debug: (event, fields) => write('debug', event, fields),
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields)
  };
}
