import { TextToSpeechClient, protos } from '@google-cloud/text-to-speech';
import * as path from 'path';
import * as fs from 'fs';
import { env } from '../config/env';
import logger from '../config/logger';
import { convertToOggOpus } from './ffmpeg.service';

// ─── Client ───────────────────────────────────────────────────────────────────

let _client: TextToSpeechClient | null = null;

function getClient(): TextToSpeechClient {
  if (!_client) {
    const serviceAccountPath = path.resolve(env.FIREBASE_SERVICE_ACCOUNT_PATH);
    if (fs.existsSync(serviceAccountPath)) {
      _client = new TextToSpeechClient({
        keyFilename: serviceAccountPath,
        projectId: env.FIREBASE_PROJECT_ID,
      });
    } else {
      _client = new TextToSpeechClient({ projectId: env.FIREBASE_PROJECT_ID });
    }
    logger.debug('Google Cloud TTS client initialized');
  }
  return _client;
}

// ─── Voice Config ─────────────────────────────────────────────────────────────

type SsmlGender = protos.google.cloud.texttospeech.v1.SsmlVoiceGender;

interface VoiceConfig {
  languageCode: string;
  name: string;
  ssmlGender: SsmlGender;
}

const VOICE_MAP: Record<string, VoiceConfig> = {
  'ur-PK': {
    languageCode: 'ur-PK',
    name: 'ur-PK-Wavenet-A',
    ssmlGender: 2, // FEMALE
  },
  'en-US': {
    languageCode: 'en-US',
    name: 'en-US-Neural2-D',
    ssmlGender: 1, // MALE
  },
};

/** Detect primary language from Unicode content */
function detectLanguage(text: string): string {
  if (env.TTS_LANGUAGE_OVERRIDE !== 'auto') return env.TTS_LANGUAGE_OVERRIDE;
  const urduChars = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  return urduChars > text.length * 0.1 ? 'ur-PK' : 'en-US';
}

// ─── Markdown Stripper ────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Convert text to a WhatsApp-compatible OGG Opus buffer.
 * Uses Google Cloud TTS — authenticated via Firebase service account.
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const cleanText = stripMarkdown(text);
  logger.debug({ textLength: cleanText.length }, 'Starting Google Cloud TTS');

  const client = getClient();
  const langCode = detectLanguage(cleanText);
  const voice = VOICE_MAP[langCode] ?? VOICE_MAP['en-US'];

  const [response] = await client.synthesizeSpeech({
    input: { text: cleanText },
    voice: {
      languageCode: voice.languageCode,
      name: voice.name,
      ssmlGender: voice.ssmlGender,
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: 0.9,
      pitch: 0.0,
      volumeGainDb: 1.0,
    },
  });

  if (!response.audioContent) {
    throw new Error('Google Cloud TTS returned empty audio content');
  }

  const mp3Buffer = Buffer.from(response.audioContent as Uint8Array);
  logger.debug({ mp3Bytes: mp3Buffer.length, langCode }, 'TTS synthesis complete');

  return convertToOggOpus(mp3Buffer);
}
