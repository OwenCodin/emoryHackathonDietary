import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dataDirectory = new URL('./data/', import.meta.url);

const WRITABLE = new Set(['diary.json', 'cache.json']);

// Writable files may live in RENAL_STATE_DIR (read at call time) so tests never touch committed data.
function resolveFile(name) {
  const stateDir = process.env.RENAL_STATE_DIR;
  if (WRITABLE.has(name) && typeof stateDir === 'string' && stateDir.trim()) {
    return join(stateDir, name);
  }
  return fileURLToPath(new URL(name, dataDirectory));
}

export async function readData(name) {
  const contents = await readFile(resolveFile(name), 'utf8');
  return JSON.parse(contents);
}

export async function writeData(name, value) {
  const destination = resolveFile(name);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${name}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, destination);
}

export function normalizeFoodName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isFiniteNonNegative(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export function errorResult(error, fallback = 'renal operation failed') {
  const message = error instanceof Error ? error.message : fallback;
  return { ok: false, error: message.slice(0, 120) || fallback };
}
