import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export class Storage {
  constructor(directory, crypto) {
    mkdirSync(directory, { recursive: true });
    this.path = join(directory, 'accounts.enc');
    this.crypto = crypto;
    if (!crypto.isEncryptionAvailable()) throw new Error('Protected Windows storage is unavailable. No credentials were saved.');
    this.data = existsSync(this.path) ? JSON.parse(crypto.decryptString(readFileSync(this.path))) : { hostId: `urn:uuid:${randomUUID()}`, accounts: [], active: null, welcomed: false };
    if (this.data.modelPolicy !== 'luna-max') {
      this.data.selectedModel = 'gpt-6-luna'; this.data.reasoningEffort = 'max'; this.data.modelPolicy = 'luna-max';
    }
    this.save();
    this.db = new DatabaseSync(join(directory, 'checkpoint.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS evidence (id INTEGER PRIMARY KEY, registration TEXT NOT NULL, event TEXT NOT NULL, at TEXT NOT NULL);');
  }
  save() {
    writeFileSync(this.path + '.tmp', this.crypto.encryptString(JSON.stringify(this.data)), { mode: 0o600, flush: true });
    renameSync(this.path + '.tmp', this.path);
  }
  registration() { return createHash('sha256').update(this.data.active ?? '').digest('hex'); }
  record(event) { this.db.prepare('INSERT INTO evidence(registration, event, at) VALUES (?, ?, ?)').run(this.registration(), event, new Date().toISOString()); }
  evidence() { return this.db.prepare('SELECT event, MAX(at) AS at FROM evidence WHERE registration = ? GROUP BY event').all(this.registration()); }
  close() { this.db.close(); }
}
