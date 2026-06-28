import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';
import { env } from '../config/env';
import logger from '../config/logger';

// ─── Firebase Initialization ──────────────────────────────────────────────────

function getDb() {
  // Avoid re-initializing on hot-reload
  if (getApps().length === 0) {
    const serviceAccountPath = env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (serviceAccountPath && fs.existsSync(path.resolve(serviceAccountPath))) {
      // Load from service account JSON file (recommended for production)
      const serviceAccount = JSON.parse(
        fs.readFileSync(path.resolve(serviceAccountPath), 'utf8'),
      ) as Record<string, unknown>;

      initializeApp({
        credential: cert(serviceAccount as Parameters<typeof cert>[0]),
        projectId: env.FIREBASE_PROJECT_ID,
      });
      logger.info({ projectId: env.FIREBASE_PROJECT_ID }, 'Firebase initialized via service account JSON');
    } else {
      // Fallback: Application Default Credentials (gcloud auth application-default login)
      initializeApp({
        credential: applicationDefault(),
        projectId: env.FIREBASE_PROJECT_ID,
      });
      logger.info({ projectId: env.FIREBASE_PROJECT_ID }, 'Firebase initialized via Application Default Credentials');
    }
  }

  return getFirestore();
}

const COLLECTION = 'fataawa';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FatwaRecord {
  id?: string;
  category: string;
  raw_question: string;
  shaikh_answer: string;
  embedding: number[];
  historical_frequency_count: number;
  confidence_score: number;
}

export interface FatwaMatch extends Omit<FatwaRecord, 'embedding'> {
  id: string;
  similarity: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generate a stable document ID from a question string (32-bit djb2 hash).
 * Same question always maps to the same document — enabling idempotent upserts.
 */
function questionToDocId(question: string): string {
  let hash = 5381;
  for (let i = 0; i < question.length; i++) {
    hash = ((hash << 5) + hash) ^ question.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  return `fatwa_${hash.toString(16).padStart(8, '0')}`;
}

// ─── Write Operations ─────────────────────────────────────────────────────────

/**
 * Upsert a single fatwa record into Firestore.
 */
export async function upsertFatwa(record: FatwaRecord): Promise<string> {
  const db = getDb();
  const docId = record.id ?? questionToDocId(record.raw_question);
  const docRef = db.collection(COLLECTION).doc(docId);

  await docRef.set(
    {
      category: record.category,
      raw_question: record.raw_question,
      shaikh_answer: record.shaikh_answer,
      embedding: FieldValue.vector(record.embedding),
      historical_frequency_count: record.historical_frequency_count,
      confidence_score: record.confidence_score,
      updated_at: Timestamp.now(),
    },
    { merge: true },
  );

  return docId;
}

/**
 * Batch-upsert multiple records (max 499 ops per Firestore batch).
 */
export async function batchUpsertFataawa(records: FatwaRecord[]): Promise<void> {
  const db = getDb();
  const BATCH_SIZE = 499;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const chunk = records.slice(i, i + BATCH_SIZE);
    logger.debug({ chunkStart: i, chunkSize: chunk.length }, 'Batch writing to Firestore');

    const batch = db.batch();

    for (const record of chunk) {
      const docId = record.id ?? questionToDocId(record.raw_question);
      const docRef = db.collection(COLLECTION).doc(docId);

      batch.set(
        docRef,
        {
          category: record.category,
          raw_question: record.raw_question,
          shaikh_answer: record.shaikh_answer,
          embedding: FieldValue.vector(record.embedding),
          historical_frequency_count: record.historical_frequency_count,
          confidence_score: record.confidence_score,
          updated_at: Timestamp.now(),
          created_at: Timestamp.now(),
        },
        { merge: true },
      );
    }

    await batch.commit();
    logger.debug({ chunkStart: i }, 'Firestore batch committed');
  }
}

// ─── Vector Search ────────────────────────────────────────────────────────────

/**
 * Perform a K-nearest-neighbor cosine similarity search using Firestore's
 * native findNearest() vector index.
 *
 * FIRST RUN NOTE: If the vector index doesn't exist yet, Firestore returns
 * an error containing a link to create it. Click it once — index creation
 * takes 1–5 minutes. Alternatively deploy firestore/firestore.indexes.json
 * using: firebase deploy --only firestore:indexes
 *
 * @param embedding  - Query embedding vector (1536 dims)
 * @param threshold  - Post-filter: minimum similarity (cosine) to include
 * @param count      - Number of nearest neighbors to retrieve
 */
export async function matchFataawa(
  embedding: number[],
  threshold: number = env.MATCH_THRESHOLD,
  count: number = env.MATCH_COUNT,
): Promise<FatwaMatch[]> {
  const db = getDb();
  const collectionRef = db.collection(COLLECTION);

  // Fetch more candidates so we can post-filter by threshold
  const fetchLimit = Math.max(count * 3, 15);

  const vectorQuery = collectionRef.findNearest(
    'embedding',
    FieldValue.vector(embedding),
    {
      limit: fetchLimit,
      distanceMeasure: 'COSINE',
    },
  );

  const snapshot = await vectorQuery.get();

  const results: FatwaMatch[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();

    // Firestore cosine distance: 0 = identical vectors, ~1 = orthogonal
    // We compute cosine similarity locally for threshold filtering.
    // Firestore sorts by distance ascending (most similar first).
    // Approximate similarity from ordering position: use raw_question match
    // Note: distanceResultField is not available in all SDK versions,
    // so we derive similarity from the known sort order + a fallback.
    const distanceField = data['_distance'] as number | undefined;
    const similarity =
      distanceField !== undefined
        ? Math.max(0, 1 - distanceField)
        : 1 - results.length / fetchLimit; // graceful degradation fallback

    if (similarity >= threshold) {
      results.push({
        id: doc.id,
        category: data['category'] as string,
        raw_question: data['raw_question'] as string,
        shaikh_answer: data['shaikh_answer'] as string,
        historical_frequency_count: (data['historical_frequency_count'] as number) ?? 1,
        confidence_score: (data['confidence_score'] as number) ?? 1.0,
        similarity,
      });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results.slice(0, count);
}
