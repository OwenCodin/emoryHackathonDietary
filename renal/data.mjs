import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dataDirectory = new URL('./data/', import.meta.url);

export async function readData(name) {
  const contents = await readFile(new URL(name, dataDirectory), 'utf8');
  return JSON.parse(contents);
}

export async function writeData(name, value) {
  const destination = fileURLToPath(new URL(name, dataDirectory));
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
