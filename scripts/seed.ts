#!/usr/bin/env ts-node
/**
 * Phase 1 — Seeding CLI
 *
 * Usage:
 *   npm run seed -- --text-file ./data/chat.txt
 *   npm run seed -- --audio-dir ./data/voice_notes
 *   npm run seed -- --text-file ./data/chat.json --audio-dir ./data/voice_notes --dry-run
 */

import 'dotenv/config';
import { program } from 'commander';
import logger from '../src/config/logger';
import { ingest } from '../src/pipeline/ingestor';
import { categorize } from '../src/pipeline/categorizer';
import { deduplicateRecords } from '../src/pipeline/deduplicator';
import { seedDatabase } from '../src/pipeline/seeder';

program
  .name('seed')
  .description('Phase 1: Ingest, categorize, deduplicate, and seed Supabase with fatawa data')
  .option('--text-file <path>', 'Path to WhatsApp .txt export or .json Q&A file')
  .option('--audio-dir <path>', 'Path to directory of historical .ogg/.mp3 voice notes')
  .option('--dry-run', 'Preview pipeline output without writing to the database', false)
  .option('--dedup-threshold <number>', 'Cosine similarity dedup threshold (0-1)', '0.92');

program.parse();

const opts = program.opts<{
  textFile?: string;
  audioDir?: string;
  dryRun: boolean;
  dedupThreshold: string;
}>();

async function main(): Promise<void> {
  const isDryRun = opts.dryRun;
  const dedupThreshold = parseFloat(opts.dedupThreshold);

  if (!opts.textFile && !opts.audioDir) {
    logger.error('❌  You must provide at least one of --text-file or --audio-dir');
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log('  WhatsApp Fatawa Bot — Phase 1: Seeding Pipeline');
  console.log('══════════════════════════════════════════════════\n');

  if (isDryRun) {
    console.log('⚠️  DRY RUN MODE — no data will be written to the database\n');
  }

  // ── Step 1: Ingest ───────────────────────────────────────────────────────
  console.log('📥  Step 1/4: Ingesting source data...');
  const rawRecords = await ingest({
    textFile: opts.textFile,
    audioDir: opts.audioDir,
    dryRun: isDryRun,
  });

  if (rawRecords.length === 0) {
    logger.error('No records could be ingested from the provided sources. Exiting.');
    process.exit(1);
  }
  console.log(`   ✓  Ingested ${rawRecords.length} raw records\n`);

  // ── Step 2: Categorize ───────────────────────────────────────────────────
  console.log('🧠  Step 2/4: Categorizing with Gemini 1.5 Pro...');
  const categorized = await categorize(rawRecords, isDryRun);
  console.log(`   ✓  Categorized ${categorized.length} records\n`);

  // ── Step 3: Deduplicate ──────────────────────────────────────────────────
  console.log(`🔀  Step 3/4: Deduplicating (threshold: ${dedupThreshold})...`);
  const deduped = await deduplicateRecords(categorized, dedupThreshold, isDryRun);
  const saved = rawRecords.length - deduped.length;
  console.log(`   ✓  Merged into ${deduped.length} unique records (removed ${saved} duplicates)\n`);

  // ── Step 4: Seed Database ────────────────────────────────────────────────
  console.log('💾  Step 4/4: Seeding Supabase...');
  await seedDatabase(deduped, isDryRun);
  console.log(`   ✓  ${isDryRun ? '[DRY RUN] Would have inserted' : 'Inserted'} ${deduped.length} records\n`);

  console.log('══════════════════════════════════════════════════');
  console.log(`  ✅  Pipeline complete! (${isDryRun ? 'DRY RUN' : 'LIVE'})`);
  console.log('══════════════════════════════════════════════════\n');
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal error in seeding pipeline');
  process.exit(1);
});
