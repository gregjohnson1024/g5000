import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

export async function readJson<T = unknown>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

export async function listJson(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  return names.filter((n) => n.endsWith('.json')).sort();
}
