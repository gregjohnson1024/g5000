import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROOT = process.env.G5000_ROUTER_ROOT ?? join(homedir(), '.g5000-router');
export const GRIB_CACHE = join(ROOT, 'grib-cache');
export const PLANS_DIR = join(ROOT, 'plans');
export const CACHED_POLAR = join(ROOT, 'cached-polar.json');
export const SETTINGS = join(ROOT, 'settings.json');
export const WAYPOINTS = join(ROOT, 'waypoints.json');
