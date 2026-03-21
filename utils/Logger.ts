export interface LogEntry {
  timestamp: number;
  action: string;
  details: Record<string, unknown>;
}

export interface Logger {
  info(action: string, details?: Record<string, unknown>): void;
  warn(action: string, details?: Record<string, unknown>): void;
  error(action: string, details?: Record<string, unknown>): void;
  debug(action: string, details?: Record<string, unknown>): void;
  signal(message: string): void;
  getLogs(): LogEntry[];
}

const MAX_HISTORY = 100;

export function createLogger(moduleName: string): Logger {
  const logs: LogEntry[] = [];
  const isDebugAll = process.env.DEBUG_ALL === 'true';

  function pruneLogs(): void {
    while (logs.length > MAX_HISTORY) logs.shift();
  }

  return {
    info(action: string, details: Record<string, unknown> = {}) {
      if (isDebugAll) console.log(`[${moduleName}] ${action}`, details);
      logs.push({ timestamp: Date.now(), action, details });
      pruneLogs();
    },
    warn(action: string, details: Record<string, unknown> = {}) {
      console.warn(`[${moduleName}] ⚠️ ${action}`, details);
      logs.push({ timestamp: Date.now(), action, details });
      pruneLogs();
    },
    error(action: string, details: Record<string, unknown> = {}) {
      console.error(`[${moduleName}] 🚨 ${action}`, details);
      logs.push({ timestamp: Date.now(), action, details });
      pruneLogs();
    },
    debug(action: string, details: Record<string, unknown> = {}) {
      if (isDebugAll || process.env.DEBUG === 'true') {
        console.log(`[${moduleName}] DEBUG: ${action}`, details);
      }
      logs.push({ timestamp: Date.now(), action, details: { ...details, _debug: true } });
      pruneLogs();
    },
    signal(message: string) {
      console.log(message);
    },
    getLogs() {
      return [...logs];
    },
  };
}
