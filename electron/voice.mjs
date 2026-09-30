import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function validateWav(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 46 || value.byteLength > 1_920_044 || value.byteLength % 2) throw new Error('invalid_recording');
  const b = Buffer.from(value);
  if (b.readUInt32LE(4) !== b.length - 8 || b.readUInt32LE(28) !== 32000 || b.readUInt16LE(32) !== 2) throw new Error('invalid_recording');
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.toString('ascii', 12, 16) !== 'fmt ' || b.readUInt32LE(16) !== 16 || b.readUInt16LE(20) !== 1 || b.readUInt16LE(22) !== 1 || b.readUInt32LE(24) !== 16000 || b.readUInt16LE(34) !== 16 || b.toString('ascii', 36, 40) !== 'data' || b.readUInt32LE(40) !== b.length - 44) throw new Error('invalid_recording');
  let energy = 0;
  for (let i = 44; i < b.length; i += 2) energy += (b.readInt16LE(i) / 32768) ** 2;
  if (Math.sqrt(energy / ((b.length - 44) / 2)) < 0.003) throw new Error('recording_silent');
  return b;
}
export class Voice {
  constructor(root) { this.root = root; this.process = null; this.busy = false; this.cancelled = false; }
  get available() { return existsSync(join(this.root, 'Release', 'whisper-cli.exe')) && existsSync(join(this.root, 'ggml-base.bin')); }
  cancel() { this.cancelled = true; this.process?.kill(); }
  async transcribe(wav, language = 'auto') {
    if (!this.available) throw new Error('voice_runtime_missing');
    if (this.busy) throw new Error('voice_busy');
    if (!['auto', 'en', 'es', 'fr', 'de', 'ar', 'hi', 'ur', 'it', 'pt'].includes(language)) throw new Error('invalid_voice_language');
    const bytes = validateWav(wav);
    this.busy = true; this.cancelled = false;
    let directory;
    const started = performance.now();
    try {
      directory = await mkdtemp(join(tmpdir(), 'on-the-spot-voice-'));
      const file = join(directory, 'input.wav'), output = join(directory, 'transcript');
      await writeFile(file, bytes, { mode: 0o600 });
      if (this.cancelled) throw new Error('transcription_interrupted');
      await new Promise((resolve, reject) => {
        const child = spawn(join(this.root, 'Release', 'whisper-cli.exe'), ['-m', join(this.root, 'ggml-base.bin'), '-f', file, '-l', language, '-otxt', '-of', output, '-ng', '-t', '4', '-nt'], { windowsHide: true, stdio: 'ignore' });
        this.process = child;
        const timer = setTimeout(() => { child.kill(); reject(new Error('transcription_timeout')); }, 120000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('transcription_interrupted')); });
      });
      const text = (await readFile(output + '.txt', 'utf8')).trim();
      if (this.cancelled) throw new Error('transcription_interrupted');
      if (!text || /^\[.*\]$/.test(text) || text.length > 4000) throw new Error('transcript_empty');
      return { text, processingMs: Math.round(performance.now() - started) };
    } finally { this.process = null; this.busy = false; if (directory) await rm(directory, { recursive: true, force: true }); }
  }
}
