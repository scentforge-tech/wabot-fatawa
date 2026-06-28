import OpenAI, { toFile } from 'openai';
import { env } from '../config/env';
import logger from '../config/logger';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

export type WhisperLanguage = 'ur' | 'en' | 'hi';

export interface TranscriptionResult {
  text: string;
  detectedLanguage?: string;
}

/**
 * Transcribes an audio buffer using OpenAI Whisper.
 * Supports OGG, MP3, WAV, M4A, and WEBM inputs.
 *
 * @param audioBuffer - Raw audio data as a Buffer
 * @param filename    - Filename hint (e.g. "audio.ogg") — extension determines MIME type
 * @param language    - Optional ISO-639-1 language hint ('ur', 'en', 'hi')
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = 'audio.ogg',
  language?: WhisperLanguage,
): Promise<TranscriptionResult> {
  logger.debug({ filename, sizeBytes: audioBuffer.byteLength }, 'Starting Whisper transcription');

  // Determine MIME type from extension
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'ogg';
  const mimeMap: Record<string, string> = {
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    webm: 'audio/webm',
    opus: 'audio/ogg',
  };
  const mimeType = mimeMap[ext] ?? 'audio/ogg';

  const file = await toFile(audioBuffer, filename, { type: mimeType });

  const params: OpenAI.Audio.TranscriptionCreateParamsNonStreaming = {
    file,
    model: 'whisper-1',
    response_format: 'verbose_json',
    ...(language ? { language } : {}),
  };

  const response = await openai.audio.transcriptions.create(params);

  const text = typeof response === 'string' ? response : response.text;
  const detectedLanguage =
    typeof response === 'object' && 'language' in response
      ? (response as { language?: string }).language
      : undefined;

  logger.debug(
    { textLength: text.length, detectedLanguage },
    'Whisper transcription complete',
  );

  return { text: text.trim(), detectedLanguage };
}
