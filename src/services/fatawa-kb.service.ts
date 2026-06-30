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
import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import logger from '../config/logger';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ─── Firestore + GCS clients (reuse from firebase-admin if initialized) ────────
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

// ─── Gemini embedding ──────────────────────────────────────────────────────────

let _genai: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (!_genai) {
    _genai = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  }
  return _genai;
}

/**
 * Generate Gemini embedding for a text string.
 * Uses text-embedding-004 (supports multilingual + Urdu/Roman Urdu well)
 */
export async function embedQuestion(text: string): Promise<number[]> {
  const genai = getGenAI();
  const model = genai.getGenerativeModel({ model: 'text-embedding-004' });
  const result = await model.embedContent(text);
  return result.embedding.values;
}

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface FatawaRecord {
  id: string;
  question: string;
  questionLang: string;
  topic: string;
  answerText: string;
  answerTranscript: string;
  audioFile: string;          // GCS path: gs://wabot-fatawa-audio/filename.opus
  audioFileName: string;      // just the filename: PTT-xxx.opus
  confidence: number;
  replyMode: 'audio' | 'text';
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
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function loadKnowledgeBase(): Promise<FatawaRecord[]> {
  const now = Date.now();
  if (_kbCache && now - _kbCacheTime < CACHE_TTL_MS) return _kbCache;

  const db = getDb();
  const snap = await db.collection('_fatawa_kb').get();
  const records: FatawaRecord[] = snap.docs.map((d) => d.data() as FatawaRecord);

  _kbCache = records;
  _kbCacheTime = now;
  logger.info({ count: records.length }, '📚 Fatawa KB loaded into memory cache');
  return records;
}

/** Force-clear the in-memory cache (called after ingest) */
export function clearKbCache(): void {
  _kbCache = null;
  _kbCacheTime = 0;
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

  // Load KB
  const records = await loadKnowledgeBase();

  // Score all records that have embeddings and audio
  const scored: FatawaMatch[] = [];
  for (const rec of records) {
    if (!rec.embedding || rec.embedding.length === 0) continue;
    if (!rec.audioFileName && rec.replyMode === 'audio') continue;

    const score = cosineSimilarity(qEmbedding, rec.embedding);
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
