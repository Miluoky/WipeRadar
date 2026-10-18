/**
 * Minimal structured logging. In production (NODE_ENV=production, set by the Docker image) every
 * line is one JSON object — Railway and most log stores index `level`, `message` and the fields.
 * Locally it stays readable text.
 */
type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const json = process.env.NODE_ENV === "production";

function write(level: Level, message: string, fields?: Fields) {
  const out = level === "info" ? console.log : level === "warn" ? console.warn : console.error;
  if (json) {
    out(JSON.stringify({ level, time: new Date().toISOString(), message, ...fields }, errorReplacer));
  } else {
    out(message, ...(fields && Object.keys(fields).length ? [fields] : []));
  }
}

const errorReplacer = (_k: string, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v);

export const log = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};

/** Process-wide counters for /metrics (monotonic since start). */
export const counters = {
  pollCycles: 0,
  pollFailures: 0,
  truncatedLists: 0,
  wipesDetected: 0,
  liveWipes: 0,
  rulesOk: 0,
  rulesFailed: 0,
  auditStrikes: 0,
};
