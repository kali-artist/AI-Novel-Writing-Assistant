/**
 * migrate_csv_to_pg.js
 * Uses only Node.js built-in modules + Prisma
 * No external CSV library needed.
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const CSV_DIR = path.join(__dirname, '..', 'ai-novel-data', 'csv');

function csvLines(filepath) {
  return readline.createInterface({
    input: fs.createReadStream(filepath),
    crlfDelay: Infinity
  });
}

async function importCSV(tableName, filePath) {
  const prisma = new PrismaClient();
  let rowCount = 0;
  const BATCH = 100;

  const lines = [];
  for await (const line of csvLines(filePath)) {
    lines.push(line);
  }

  if (lines.length < 2) { await prisma.$disconnect(); return 0; }

  // Parse header (first line is always the column names)
  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const colList = header.map(c => `"${c}"`).join(', ');

  // Model name mapping (Prisma model names differ from CSV file names)
  const modelMap = {
    AutoDirectorAutoApprovalRecord: 'autoDirectorAutoApprovalRecord',
    ChapterArtifactSyncCheckpoint: 'chapterArtifactSyncCheckpoint',
    ChapterPlanScene: 'chapterPlanScene',
    CharacterCastOptionMember: 'characterCastOptionMember',
    CharacterCastOptionRelation: 'characterCastOptionRelation',
    CharacterFactionTrack: 'characterFactionTrack',
    CharacterResourceEvent: 'characterResourceEvent',
    CharacterResourceLedgerItem: 'characterResourceLedgerItem',
    CharacterState: 'characterState',
    CharacterTimeline: 'characterTimeline',
    CharacterVolumeAssignment: 'characterVolumeAssignment',
    CreativeHubThread: 'creativeHubThread',
    DirectorArtifact: 'directorArtifact',
    DirectorArtifactDependency: 'directorArtifactDependency',
    DirectorEvent: 'directorEvent',
    DirectorLlmUsageRecord: 'directorLlmUsageRecord',
    DirectorRun: 'directorRun',
    DirectorRunCommand: 'directorRunCommand',
    DirectorStepRun: 'directorStepRun',
    ForeshadowState: 'foreshadowState',
    GenerationJob: 'generationJob',
    InformationState: 'informationState',
    ModelRouteConfig: 'modelRouteConfig',
    NovelFactEntry: 'novelFactEntry',
    NovelGenre: 'novelGenre',
    NovelSideEffectJob: 'novelSideEffectJob',
    NovelSnapshot: 'novelSnapshot',
    NovelStoryMode: 'novelStoryMode',
    NovelWorkflowTask: 'novelWorkflowTask',
    NovelWorld: 'novelWorld',
    OpenConflict: 'openConflict',
    PayoffLedgerItem: 'payoffLedgerItem',
    RagIndexJob: 'ragIndexJob',
    RelationState: 'relationState',
    ReplanRun: 'replanRun',
    StateChangeProposal: 'stateChangeProposal',
    StoryMacroPlan: 'storyMacroPlan',
    StoryPlan: 'storyPlan',
    StoryStateSnapshot: 'storyStateSnapshot',
    StyleProfile: 'styleProfile',
    StyleProfileAntiAiRule: 'styleProfileAntiAiRule',
    StyleTemplate: 'styleTemplate',
    TaskCenterArchive: 'taskCenterArchive',
    VolumeChapterPlan: 'volumeChapterPlan',
    VolumePlan: 'volumePlan',
    VolumePlanVersion: 'volumePlanVersion',
    WorldSnapshot: 'worldSnapshot',
  };

  const prismaModel = modelMap[tableName] || tableName.charAt(0).toLowerCase() + tableName.slice(1);

  if (!prisma[prismaModel]) {
    console.log(`  [SKIP] No Prisma model for ${tableName}`);
    await prisma.$disconnect();
    return 0;
  }

  const batch = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== header.length) continue;
    const row = {};
    header.forEach((col, idx) => { row[col] = values[idx] === '' ? null : values[idx]; });
    batch.push(row);
    if (batch.length >= BATCH) {
      try {
        await safeInsertMany(prisma, prismaModel, batch);
        rowCount += batch.length;
      } catch (e) { /* skip batch errors */ }
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    try { await safeInsertMany(prisma, prismaModel, batch); rowCount += batch.length; } catch (e) { /* skip */ }
  }

  await prisma.$disconnect();
  return rowCount;
}

function parseCSVLine(line) {
  const result = [];
  let current = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

async function safeInsertMany(prisma, model, rows) {
  try {
    await prisma[model].createMany({ data: rows, skipDuplicates: true });
  } catch (e) {
    // Fallback: insert one by one
    for (const row of rows) {
      try { await prisma[model].create({ data: row }); } catch (e2) { /* skip */ }
    }
  }
}

async function main() {
  console.log('=== CSV → PostgreSQL Migration ===');
  if (!fs.existsSync(CSV_DIR)) {
    console.error('CSV dir not found:', CSV_DIR);
    process.exit(1);
  }
  const files = fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv')).sort();
  console.log(`Files: ${files.length}\n`);

  let total = 0;
  for (const file of files) {
    const tableName = file.replace('.csv', '');
    process.stdout.write(`Importing ${tableName}... `);
    try {
      const n = await importCSV(tableName, path.join(CSV_DIR, file));
      console.log(`→ ${n} rows`);
      total += n;
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
  }
  console.log(`\nDone. Total rows: ${total}`);
}

main().catch(e => { console.error(e); process.exit(1); });
