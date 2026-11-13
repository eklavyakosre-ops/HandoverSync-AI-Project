import fs from 'node:fs';
import path from 'node:path';
import type { HandoverDatabase } from '../src/types.ts';
import { createSeedDatabase } from './seedData.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'handoversync_db.json');

export function readDatabase(): HandoverDatabase {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    const seeded = createSeedDatabase();
    writeDatabase(seeded);
    return seeded;
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as HandoverDatabase;
    if (!parsed.projects || !parsed.sources || !parsed.handovers) {
      throw new Error('Malformed database structure');
    }
    return parsed;
  } catch {
    const seeded = createSeedDatabase();
    writeDatabase(seeded);
    return seeded;
  }
}

export function writeDatabase(db: HandoverDatabase): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tempFile = `${DB_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tempFile, DB_FILE);
}
