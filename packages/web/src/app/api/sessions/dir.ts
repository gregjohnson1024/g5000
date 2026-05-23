import path from 'node:path';

/**
 * Resolve the sessions directory. Prefer the SESSION_LOG_DIR env var (same
 * value the g5000 app uses). Fall back to data/sessions relative to
 * the server's CWD (which is the g5000 app workspace when Next is
 * hosted by it, or the web workspace when next dev runs standalone).
 */
export function sessionsDir(): string {
  if (process.env.SESSION_LOG_DIR) return process.env.SESSION_LOG_DIR;
  return path.resolve(process.cwd(), 'data', 'sessions');
}
