/**
 * Fatawa Knowledge Base Service
 *
 * Manages the Sheikh's historical Q&A audio fatawa:
 *   - Semantic search using Gemini text embeddings over Firestore _fatawa_kb
 *   - Audio file download from Cloud Storage
 *   - Pending question state in Firestore _fatawa_pending
 */

import { Firestore, Timestamp } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { env } from '../config/env';
import logger from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Embedding (gemini-embedding-001 via REST — same as embeddings.service.ts) ─
const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta';

// ─── Firestore + GCS clients ───────────────────────────────────────────────────
let _db: Firestore;
let _storage: Storage;

function getDb(): Firestore {
  if (!_db) {
    const serviceAccount = JSON.parse(
      fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'),
    );
    _db = new Firestore({
      projectId: env.FIREBASE_PROJECT_ID,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });
  }
  return _db;
}

function getStorage(): Storage {
  if (!_storage) {
    const serviceAccount = JSON.parse(
      fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, 'utf-8'),
    );
    _storage = new Storage({
      projectId: env.FIREBASE_PROJECT_ID,
      credentials: {
        client_email: serviceAccount.client_email,
        private_key: serviceAccount.private_key,
      },
    });
  }
  return _storage;
}

// ─── Gemini embedding via REST ────────────────────────────────────────────────

/**
 * Generate a 768-dim embedding vector via gemini-embedding-001 REST API.
 * Uses the same approach as src/services/embeddings.service.ts
 */
export async function embedQuestion(text: string): Promise<number[]> {
  const url = `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: text.trim().slice(0, 2000) }] },
      outputDimensionality: 768,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini embed error ${res.status}: ${err}`);
  }
  const json = await res.json() as { embedding: { values: number[] } };
  return json.embedding.values;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single authentic Quran ayah or Hadith citation, sourced and verified against
 * quran.com/corpus.quran.com (Quran) or sunnah.com (Hadith) — see scripts/apply-topic-references.mjs.
 */
export interface AuthenticReference {
  type: 'quran' | 'hadith';
  citation: string;   // e.g. "Quran 22:29" or "Sahih al-Bukhari 1719"
  arabic: string;
  english: string;
  urdu: string;
  romanUrdu: string;
  grading?: string;   // hadith authenticity grading, e.g. "Sahih (agreed upon)"
  sourceUrl: string;
  relevance: string;
}

export interface FatawaRecord {
  id: string;
  question: string;
  questionExpanded?: string;
  questionLang: string;
  topic: string;
  answerText: string;
  answerTranscript: string;
  answerTranscriptProcessed?: string;
  audioFile: string;          // GCS path: gs://wabot-fatawa-audio/filename.opus
  audioFileName: string;      // just the filename: PTT-xxx.opus
  confidence: number;
  accuracyLabel?: string;
  replyMode: 'audio' | 'text';
  // v3 Islamic ruling fields (verified from internet cross-reference)
  authenticRuling?: string;   // e.g. "Fragrance forbidden in Ihram (Quran 2:197)"
  rulingKeyPoints?: string;   // key points as newline-separated text
  // Verified Quran/Hadith citations backing authenticRuling (topic-level, shared by all
  // records in the same topic) — see scripts/apply-topic-references.mjs
  authenticReferences?: AuthenticReference[];
  // Multilingual augmentation
  romanUrduTranscript?: string;
  englishTranslation?: string;
  questionVariants?: string;
  combinedSearchText?: string;
  keywords: string[];
  embedding?: number[];       // stored for search, optional on retrieval
}

export interface FatawaMatch {
  record: FatawaRecord;
  score: number;              // cosine similarity 0..1
}

export interface PendingQuestion {
  questionId: string;
  publicGroupJid: string;
  quotedMessageId: string;
  senderJid: string;
  senderName?: string;
  questionText: string;
  suggestedAudioFile: string;
  suggestedAudioFileName: string;
  suggestedTranscript: string;
  confidence: number;
  status: 'pending' | 'approved' | 'rejected' | 'manual';
  createdAt: Timestamp;
}

// ─── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-10);
}

// ─── Search ────────────────────────────────────────────────────────────────────

/**
 * Search the _fatawa_kb collection for the most semantically similar Q&A pairs.
 *
 * Strategy:
 *   1. Embed the incoming question with Gemini
 *   2. Fetch all records from Firestore (cached in-memory for performance)
 *   3. Compute cosine similarity against stored embeddings
 *   4. Return top N matches above threshold
 *
 * Note: Firestore native vector search (KNN) is used when available,
 *       otherwise falls back to in-memory scan.
 */

let _kbCache: FatawaRecord[] | null = null;
let _kbCacheTime = 0;
// Cache is explicitly invalidated by clearKbCache() on every KB write (dashboard
// CRUD, ingest scripts), so this TTL is just a safety net against a stale process
// missing an invalidation — not the primary invalidation mechanism.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
let _kbLoadPromise: Promise<FatawaRecord[]> | null = null;

async function loadKnowledgeBase(): Promise<FatawaRecord[]> {
  const now = Date.now();
  if (_kbCache && now - _kbCacheTime < CACHE_TTL_MS) return _kbCache;
  if (_kbLoadPromise) return _kbLoadPromise; // de-dupe concurrent cold-start loads

  _kbLoadPromise = (async () => {
    const db = getDb();
    const snap = await db.collection('_fatawa_kb').get();
    const records: FatawaRecord[] = snap.docs.map((d) => d.data() as FatawaRecord);

    _kbCache = records;
    _kbCacheTime = Date.now();
    logger.info({ count: records.length }, '📚 Fatawa KB loaded into memory cache');
    return records;
  })();

  try {
    return await _kbLoadPromise;
  } finally {
    _kbLoadPromise = null;
  }
}

/** Pre-warm the KB cache — call once at startup so the first pilgrim question
 *  doesn't pay the full Firestore load cost (can take 20-30s for 600+ records). */
export function warmKnowledgeBaseCache(): void {
  loadKnowledgeBase().catch((err) => logger.error({ err }, '⚠️  KB cache warm-up failed'));
}

/** Force-clear the in-memory cache (called after ingest) */
export function clearKbCache(): void {
  _kbCache = null;
  _kbCacheTime = 0;
}

// ─── Keyword overlap (hybrid search) ────────────────────────────────────────
//
// Pure embedding similarity underperforms on very short/terse queries (e.g.
// "Tawaf wida" — 2 words carry the whole intent, so cosine similarity against
// a long multilingual embedding can dilute below threshold). Blending in a
// literal keyword-overlap score fixes this without needing per-query LLM calls.

const KEYWORD_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'that', 'this', 'with', 'from', 'they',
  'have', 'been', 'will', 'also', 'more', 'when', 'can', 'not', 'but', 'what',
  'how', 'you', 'your', 'please', 'thank', 'jazak', 'khair', 'salam', 'alaikum',
  'assalam', 'wa', 'rahmatullahi', 'wabarakatuhu',
  'aur', 'hai', 'hain', 'kya', 'koi', 'bhi', 'mein', 'main', 'hum',
  'yeh', 'woh', 'kaise', 'kyun', 'kab', 'kaun', 'kahan', 'kis', 'ka', 'ki', 'ke',
  'se', 'ko', 'sakte', 'sakti', 'karna', 'karein', 'chahiye',
]);

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !KEYWORD_STOP_WORDS.has(w));
}

/** Fraction of the query's meaningful tokens found among a record's keywords/text. */
function keywordOverlapScore(queryTokens: string[], rec: FatawaRecord): number {
  if (!queryTokens.length) return 0;
  const haystack = new Set([
    ...(rec.keywords || []).map((k) => k.toLowerCase()),
    ...tokenize(rec.question),
    ...tokenize(rec.questionExpanded || ''),
  ]);
  if (!haystack.size) return 0;
  let hits = 0;
  for (const t of queryTokens) if (haystack.has(t)) hits++;
  return hits / queryTokens.length;
}

export async function searchFatawa(
  question: string,
  options: { topN?: number; threshold?: number } = {},
): Promise<FatawaMatch[]> {
  const topN      = options.topN      ?? 3;
  const threshold = options.threshold ?? env.MATCH_THRESHOLD; // default 0.55

  // Embed the question
  let qEmbedding: number[];
  try {
    qEmbedding = await embedQuestion(question);
  } catch (err) {
    logger.error({ err }, 'Gemini embedding failed for question search');
    throw err;
  }

  const queryTokens = tokenize(question);

  // Load KB
  const records = await loadKnowledgeBase();

  // Hybrid score: cosine similarity (primary signal) blended with literal
  // keyword overlap (rescues short/terse queries embeddings alone miss).
  const scored: FatawaMatch[] = [];
  for (const rec of records) {
    if (!rec.embedding || rec.embedding.length === 0) continue;
    if (!rec.audioFileName && rec.replyMode === 'audio') continue;

    const cosine  = cosineSimilarity(qEmbedding, rec.embedding);
    const overlap = keywordOverlapScore(queryTokens, rec);
    const score   = cosine * 0.85 + overlap * 0.15;
    if (score >= threshold) {
      scored.push({ record: rec, score });
    }
  }

  // Sort descending
  scored.sort((a, b) => b.score - a.score);
  const results = scored.slice(0, topN);

  logger.info(
    { found: results.length, topScore: results[0]?.score?.toFixed(3) ?? 'none' },
    '🔍 Fatawa search complete',
  );

  return results;
}

// ─── GCS Audio Download ────────────────────────────────────────────────────────

/**
 * Download a Sheikh audio file from GCS into a Buffer.
 * Caches locally in TMP_DIR to avoid repeated downloads.
 */
export async function downloadAudioFile(audioFileName: string): Promise<Buffer> {
  // Check local cache first
  const localPath = path.join(env.TMP_DIR, audioFileName);
  if (fs.existsSync(localPath)) {
    logger.debug({ audioFileName }, 'Audio file served from local cache');
    return fs.readFileSync(localPath);
  }

  // Download from GCS
  const storage = getStorage();
  const bucket  = storage.bucket(env.GCS_BUCKET_NAME);
  const file    = bucket.file(audioFileName);

  logger.info({ audioFileName, bucket: env.GCS_BUCKET_NAME }, 'Downloading audio from GCS');

  const [buffer] = await file.download();

  // Cache locally
  fs.mkdirSync(env.TMP_DIR, { recursive: true });
  fs.writeFileSync(localPath, buffer);

  return buffer;
}

/** Upload a freshly-recorded Sheikh audio answer to GCS (used by self-training). */
export async function uploadAudioBuffer(buffer: Buffer, fileName: string): Promise<void> {
  const storage = getStorage();
  const bucket  = storage.bucket(env.GCS_BUCKET_NAME);
  await bucket.file(fileName).save(buffer, {
    metadata: { contentType: 'audio/ogg; codecs=opus' },
  });
  // Cache locally too, so an immediate downloadAudioFile() call doesn't re-fetch from GCS
  fs.mkdirSync(env.TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(env.TMP_DIR, fileName), buffer);
}

// ─── Self-training ───────────────────────────────────────────────────────────
//
// Whenever the Sheikh answers a question the KB didn't already have a good
// match for (fresh voice note or typed text in the admin group), fold that
// answer straight back into _fatawa_kb — so the next similar pilgrim question
// finds it automatically instead of going to the Sheikh again.

/** Derive a multi-language keyword set from any combination of English/Urdu/Roman-Urdu text fields. */
export function deriveMultilingualKeywords(sources: (string | undefined)[]): string[] {
  const words = sources
    .filter((s): s is string => Boolean(s && s.trim()))
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !KEYWORD_STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 40);
}

export interface SelfTrainInput {
  questionText: string;
  topic?: string;
  answerText?: string;        // Sheikh typed a text answer
  answerAudioBuffer?: Buffer; // Sheikh recorded a fresh voice answer
  answerTranscript?: string;  // transcript of the voice answer, if transcribed
}

/**
 * Write a Sheikh-provided answer back into the KB as a new searchable record.
 * Best-effort — throws only on a hard failure so callers can log/ignore; never
 * blocks the actual approval/forward flow.
 */
export async function selfTrainFromAnswer(input: SelfTrainInput): Promise<string> {
  const db = getDb();
  const docId = `self_${crypto.randomBytes(6).toString('hex')}`;

  let audioFileName = '';
  if (input.answerAudioBuffer && input.answerAudioBuffer.length > 100) {
    audioFileName = `self-trained-${docId}.ogg`;
    await uploadAudioBuffer(input.answerAudioBuffer, audioFileName);
  }

  const keywords = deriveMultilingualKeywords([
    input.questionText,
    input.answerText,
    input.answerTranscript,
    input.topic,
  ]);

  const embedText = [
    input.questionText,
    input.topic ? `Topic: ${input.topic}` : '',
    input.answerText ? `Answer: ${input.answerText}` : '',
    input.answerTranscript ? `Transcript: ${input.answerTranscript}` : '',
  ].filter(Boolean).join('\n');

  let embedding: number[] = [];
  try {
    embedding = await embedQuestion(embedText);
  } catch (err) {
    logger.error({ err, docId }, 'Self-train embedding failed — record saved without embedding');
  }

  const record: FatawaRecord = {
    id: docId,
    question: input.questionText,
    questionLang: 'unknown',
    topic: input.topic || 'GENERAL',
    answerText: input.answerText || '',
    answerTranscript: input.answerTranscript || '',
    audioFile: audioFileName ? `gs://${env.GCS_BUCKET_NAME}/${audioFileName}` : '',
    audioFileName,
    confidence: 0.75, // Sheikh-provided live answer — trusted, but below vetted-topic citations
    accuracyLabel: 'Self-trained (Sheikh live answer)',
    replyMode: audioFileName ? 'audio' : 'text',
    keywords,
    embedding,
  };

  await db.collection('_fatawa_kb').doc(docId).set(record, { merge: true });
  clearKbCache();
  logger.info({ docId, topic: record.topic, hasAudio: !!audioFileName }, '🧠 Self-trained new KB record from Sheikh answer');
  return docId;
}

// ─── Pending Question State ────────────────────────────────────────────────────

const PENDING_COLLECTION = '_fatawa_pending';

export async function savePendingQuestion(data: Omit<PendingQuestion, 'createdAt'>): Promise<void> {
  const db = getDb();
  await db.collection(PENDING_COLLECTION).doc(data.questionId).set({
    ...data,
    createdAt: Timestamp.now(),
  });
  logger.info({ questionId: data.questionId }, '💾 Pending question saved to Firestore');
}

export async function getPendingQuestion(questionId: string): Promise<PendingQuestion | null> {
  const db = getDb();
  const doc = await db.collection(PENDING_COLLECTION).doc(questionId).get();
  if (!doc.exists) return null;
  return doc.data() as PendingQuestion;
}

export async function getMostRecentPending(): Promise<PendingQuestion | null> {
  const db = getDb();
  const snap = await db
    .collection(PENDING_COLLECTION)
    .where('status', '==', 'pending')
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data() as PendingQuestion;
}

export async function updatePendingStatus(
  questionId: string,
  status: PendingQuestion['status'],
): Promise<void> {
  const db = getDb();
  await db.collection(PENDING_COLLECTION).doc(questionId).update({ status });
}

/** Find pending question by the admin message ID (sent when question was forwarded to admin group) */
export async function getPendingByAdminMsgId(adminMsgId: string): Promise<PendingQuestion | null> {
  const db = getDb();
  const snap = await db
    .collection(PENDING_COLLECTION)
    .where('adminMsgId', '==', adminMsgId)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (snap.empty) return null;
  return snap.docs[0].data() as PendingQuestion;
}

export async function savePendingAdminMsgId(questionId: string, adminMsgId: string): Promise<void> {
  const db = getDb();
  await db.collection(PENDING_COLLECTION).doc(questionId).update({ adminMsgId });
}

/** Generate a short unique ID for pending questions */
export function generateQuestionId(): string {
  return crypto.randomBytes(6).toString('hex');
}

// ─── Reference formatting ───────────────────────────────────────────────────

/**
 * Render a KB record's verified Quran/Hadith citations as a compact WhatsApp
 * message block for the Sheikh's approval notification. Shows at most `max`
 * citations (Quran first, then Hadith) to keep the message readable.
 */
export function formatReferencesForWhatsApp(
  refs: AuthenticReference[] | undefined,
  max = 2,
): string {
  if (!refs || refs.length === 0) return '';

  const ordered = [...refs].sort((a, b) => (a.type === b.type ? 0 : a.type === 'quran' ? -1 : 1));
  const shown = ordered.slice(0, max);
  const extra = ordered.length - shown.length;

  const lines = shown.map((r) => {
    const icon = r.type === 'quran' ? '📗' : '📘';
    const grading = r.grading ? ` _(${r.grading})_` : '';
    return (
      `${icon} *${r.citation}*${grading}\n` +
      `${r.arabic}\n` +
      `EN: ${r.english}\n` +
      `Roman Urdu: ${r.romanUrdu}`
    );
  });

  return (
    `\n\n*📖 Authentic References:*\n` +
    lines.join('\n\n') +
    (extra > 0 ? `\n\n_+${extra} more reference(s) — see Knowledge Base tab_` : '')
  );
}
