// Speech for the simulated caller: macOS say + afconvert, no shell.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Parse a 16-bit PCM WAV buffer into { sampleRate, channels, samples }.
export function wavPcm(buffer) {
  const bad = () => new Error('not a 16-bit PCM WAV');
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw bad();
  let fmt = null, data = null;
  let at = 12;
  while (at + 8 <= buffer.length) {
    const id = buffer.toString('ascii', at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(body), channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4), bits: buffer.readUInt16LE(body + 14),
      };
    } else if (id === 'data') {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }
    at = body + size + (size % 2);
  }
  if (!fmt || !data || (fmt.format !== 1 && fmt.format !== 0xfffe) || fmt.bits !== 16) throw bad();
  const samples = new Int16Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, samples };
}

// Text to 48 kHz mono 16-bit samples.
export async function speechPcm(text) {
  if (typeof text !== 'string' || !text.trim() || text.startsWith('-')) throw new Error('bad speech text');
  const dir = await mkdtemp(join(tmpdir(), 'sim-say-'));
  try {
    const aiff = join(dir, 's.aiff');
    const wav = join(dir, 's.wav');
    await run('say', ['-o', aiff, text]);
    await run('afconvert', ['-f', 'WAVE', '-d', 'LEI16@48000', '-c', '1', aiff, wav]);
    const pcm = wavPcm(await readFile(wav));
    if (pcm.sampleRate !== 48000 || pcm.channels !== 1) throw new Error('unexpected speech format');
    return pcm.samples;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
