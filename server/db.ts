import fs from 'node:fs';
import path from 'node:path';
import type { HandoverDatabase } from '../src/types.ts';
import { createSeedDatabase } from './seedData.ts';

function getDbFile(): string {
  if (process.env.HANDOVERSYNC_DB_FILE) {
    return path.resolve(process.env.HANDOVERSYNC_DB_FILE);
  }
  return path.join(path.resolve(process.cwd(), 'data'), 'handoversync_db.json');
}

export function readDatabase(dbFilePath = getDbFile()): HandoverDatabase {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(dbFilePath)) {
    const seeded = createSeedDatabase();
    writeDatabase(seeded, dbFilePath);
    return seeded;
  }
  try {
    const raw = fs.readFileSync(dbFilePath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<HandoverDatabase>;
    if (!parsed.projects || !parsed.sources || !parsed.handovers) {
      throw new Error('Malformed database structure');
    }
    return {
      projects: parsed.projects,
      sources: parsed.sources,
      handovers: parsed.handovers,
      knowledgeGaps: Array.isArray(parsed.knowledgeGaps) ? parsed.knowledgeGaps : [],
      gapAnalysisRuns: Array.isArray(parsed.gapAnalysisRuns) ? parsed.gapAnalysisRuns : [],
      qaConversations: Array.isArray(parsed.qaConversations) ? parsed.qaConversations : [],
      botConversations: Array.isArray(parsed.botConversations) ? parsed.botConversations : [],
      integrations:
        parsed.integrations && typeof parsed.integrations === 'object' ? parsed.integrations : {},
      integrationConfigurations: Array.isArray(parsed.integrationConfigurations)
        ? parsed.integrationConfigurations
        : [],
      integrationSecrets:
        parsed.integrationSecrets && typeof parsed.integrationSecrets === 'object'
          ? parsed.integrationSecrets
          : {},
      syncRuns: Array.isArray(parsed.syncRuns) ? parsed.syncRuns : [],
      externalSources: Array.isArray(parsed.externalSources) ? parsed.externalSources : [],
    };
  } catch {
    const seeded = createSeedDatabase();
    writeDatabase(seeded, dbFilePath);
    return seeded;
  }
}

export function writeDatabase(db: HandoverDatabase, dbFilePath = getDbFile()): void {
  const dir = path.dirname(dbFilePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempFile = `${dbFilePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2), 'utf-8');
  fs.renameSync(tempFile, dbFilePath);
}
