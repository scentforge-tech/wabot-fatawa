import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Google Gemini — used for transcription, embeddings, categorization, drafting
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  // Firebase — Firestore vector DB + Auth + Cloud Run hosting
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('./firebase-service-account.json'),

  // WhatsApp Groups (leave blank on first run — fill after QR scan)
  ADMIN_GROUP_JID: z.string().default(''),
  PUBLIC_GROUP_JID: z.string().default(''),

  // TTS (Google Cloud TTS via same Firebase service account — no extra key needed)
  // Voice options: ur-PK-Wavenet-A (Urdu female), en-US-Neural2-D (English male)
  TTS_LANGUAGE_OVERRIDE: z.enum(['ur-PK', 'en-US', 'auto']).default('auto'),

  // Pipeline thresholds
  DEDUP_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.92),
  MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.55),
  MATCH_COUNT: z.coerce.number().int().positive().default(5),

  // Logging
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .default('info'),

  // Auth & Temp
  AUTH_DIR: z.string().default('./auth_info_baileys'),
  TMP_DIR: z.string().default('./tmp'),

  // Cloud Run health-check port
  PORT: z.coerce.number().default(8080),
});

const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('\n❌  Environment variable validation failed:\n');
  parseResult.error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('\nCopy .env.example to .env and fill in your values.\n');
  process.exit(1);
}

export const env = parseResult.data;
export type Env = typeof env;
