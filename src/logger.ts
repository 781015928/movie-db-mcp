type Level = "silent" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<Level, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };

function levelFromEnv(): Level {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return (raw in LEVELS ? raw : "info") as Level;
}

const current = LEVELS[levelFromEnv()];

function write(level: Level, msg: string, meta?: unknown) {
  if (LEVELS[level] > current) return;
  const line = meta === undefined ? msg : `${msg} ${JSON.stringify(meta)}`;
  process.stderr.write(`[${new Date().toISOString()}] [${level}] ${line}\n`);
}

export const logger = {
  error: (msg: string, meta?: unknown) => write("error", msg, meta),
  warn: (msg: string, meta?: unknown) => write("warn", msg, meta),
  info: (msg: string, meta?: unknown) => write("info", msg, meta),
  debug: (msg: string, meta?: unknown) => write("debug", msg, meta),
};
