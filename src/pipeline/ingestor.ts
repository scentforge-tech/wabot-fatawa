import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { transcribeAudio } from '../services/whisper.service';
import logger from '../config/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawRecord {
  raw_question: string;
  shaikh_answer: string;
  source: string;
}

// ─── Text File Parsers ───────────────────────────────────────────────────────

/**
 * Parse a WhatsApp group chat export (.txt).
 * Format: "[DD/MM/YYYY, HH:MM:SS] Contact Name: message text"
 *
 * Heuristic: groups consecutive messages by the same sender into
 * question-answer pairs (Pilgrim → Shaikh alternation).
 */
function parseWhatsAppTxt(filePath: string): RawRecord[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Regex for WA export lines
  const lineRe =
    /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\]?\s+-?\s*([^:]+):\s+(.+)$/i;

  interface ParsedLine {
    sender: string;
    message: string;
  }

  const parsed: ParsedLine[] = [];
  let currentSender = '';
  let currentText = '';

  for (const line of lines) {
    const match = line.match(lineRe);
    if (match) {
      if (currentSender && currentText) {
        parsed.push({ sender: currentSender.trim(), message: currentText.trim() });
      }
      currentSender = match[3];
      currentText = match[4];
    } else if (currentSender) {
      // Continuation of multi-line message
      currentText += ' ' + line.trim();
    }
  }
  if (currentSender && currentText) {
    parsed.push({ sender: currentSender.trim(), message: currentText.trim() });
  }

  // Pair consecutive messages: odd = question, even = answer
  const records: RawRecord[] = [];
  for (let i = 0; i + 1 < parsed.length; i += 2) {
    const q = parsed[i];
    const a = parsed[i + 1];
    if (q.message.length > 5 && a.message.length > 5) {
      records.push({
        raw_question: q.message,
        shaikh_answer: a.message,
        source: path.basename(filePath),
      });
    }
  }

  logger.info(
    { source: path.basename(filePath), count: records.length },
    'Parsed WhatsApp text export',
  );
  return records;
}

/**
 * Parse a JSON file containing an array of Q&A objects.
 * Supports flexible field names: question/answer, q/a, raw_question/shaikh_answer
 */
function parseJsonFile(filePath: string): RawRecord[] {
  const content = fs.readFileSync(filePath, 'utf8');
  const data: unknown[] = JSON.parse(content);

  return data
    .filter((item): item is Record<string, string> => typeof item === 'object' && item !== null)
    .map((item) => ({
      raw_question:
        item['raw_question'] ?? item['question'] ?? item['q'] ?? '',
      shaikh_answer:
        item['shaikh_answer'] ?? item['answer'] ?? item['a'] ?? '',
      source: path.basename(filePath),
    }))
    .filter((r) => r.raw_question.length > 0 && r.shaikh_answer.length > 0);
}

// ─── Audio File Processor ────────────────────────────────────────────────────

/**
 * Process a directory of audio files (OGG/MP3).
 * Audio files are expected in pairs:
 *   <name>_q.ogg (question) + <name>_a.ogg (answer)
 * OR as individual files that will be transcribed as standalone content.
 */
export async function processAudioDirectory(
  audioDir: string,
  dryRun: boolean = false,
): Promise<RawRecord[]> {
  const audioFiles = await glob(`${audioDir}/**/*.{ogg,mp3,m4a,wav}`, {
    nocase: true,
  });

  logger.info({ count: audioFiles.length, audioDir }, 'Found audio files');

  if (dryRun) {
    logger.info('[DRY RUN] Would transcribe audio files — skipping API calls');
    return audioFiles.map((f) => ({
      raw_question: `[AUDIO: ${path.basename(f)}]`,
      shaikh_answer: '[Would be transcribed by Whisper]',
      source: path.basename(f),
    }));
  }

  // Pair files by base name (strip _q / _a suffix)
  const pairs: Map<string, { q?: string; a?: string }> = new Map();

  for (const f of audioFiles) {
    const base = path.basename(f, path.extname(f));
    if (base.endsWith('_q') || base.endsWith('-q')) {
      const key = base.slice(0, -2);
      pairs.set(key, { ...pairs.get(key), q: f });
    } else if (base.endsWith('_a') || base.endsWith('-a')) {
      const key = base.slice(0, -2);
      pairs.set(key, { ...pairs.get(key), a: f });
    } else {
      // Standalone file — treat as question with no paired answer
      pairs.set(base, { q: f });
    }
  }

  const records: RawRecord[] = [];

  for (const [key, pair] of pairs) {
    try {
      let question = '';
      let answer = '';

      if (pair.q) {
        const qBuf = fs.readFileSync(pair.q);
        const ext = path.extname(pair.q).slice(1);
        const res = await transcribeAudio(qBuf, `audio.${ext}`, 'ur');
        question = res.text;
      }

      if (pair.a) {
        const aBuf = fs.readFileSync(pair.a);
        const ext = path.extname(pair.a).slice(1);
        const res = await transcribeAudio(aBuf, `audio.${ext}`, 'ur');
        answer = res.text;
      }

      if (question) {
        records.push({
          raw_question: question,
          shaikh_answer: answer || '(No paired answer audio found)',
          source: key,
        });
      }
    } catch (err) {
      logger.error({ err, key }, 'Failed to transcribe audio pair');
    }
  }

  logger.info({ recordCount: records.length }, 'Audio processing complete');
  return records;
}

// ─── Main Ingestor ───────────────────────────────────────────────────────────

export interface IngestOptions {
  textFile?: string;
  audioDir?: string;
  dryRun?: boolean;
}

export async function ingest(options: IngestOptions): Promise<RawRecord[]> {
  const allRecords: RawRecord[] = [];

  // Process text file
  if (options.textFile && fs.existsSync(options.textFile)) {
    const ext = path.extname(options.textFile).toLowerCase();
    if (ext === '.json') {
      allRecords.push(...parseJsonFile(options.textFile));
    } else if (ext === '.txt') {
      allRecords.push(...parseWhatsAppTxt(options.textFile));
    } else {
      logger.warn({ ext }, 'Unsupported text file format — must be .txt or .json');
    }
  }

  // Process audio directory
  if (options.audioDir && fs.existsSync(options.audioDir)) {
    const audioRecords = await processAudioDirectory(
      options.audioDir,
      options.dryRun,
    );
    allRecords.push(...audioRecords);
  }

  logger.info({ totalRecords: allRecords.length }, 'Ingestion complete');
  return allRecords;
}
