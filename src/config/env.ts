import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // OpenAI
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // Google Gemini
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),

  // Firebase
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  // Path to the downloaded service account JSON key file
  FIREBASE_SERVICE_ACCOUNT_PATH: z.string().default('./firebase-service-account.json'),

  // WhatsApp Groups
  ADMIN_GROUP_JID: z.string().default(''),
  PUBLIC_GROUP_JID: z.string().default(''),

  // TTS
  TTS_PROVIDER: z.enum(['openai', 'elevenlabs']).default('openai'),
  OPENAI_TTS_VOICE: z
    .enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])
    .default('nova'),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().optional(),

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
