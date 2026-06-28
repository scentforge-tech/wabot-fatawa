import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env';
import logger from '../config/logger';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Use Flash for fast transcription (cheaper, lower latency than Pro)
const TRANSCRIPTION_MODEL = 'gemini-1.5-flash';

export type TranscriptionLanguageHint = 'ur' | 'en' | 'hi' | 'auto';

export interface TranscriptionResult {
  text: string;
  detectedLanguage?: string;
}

/**
 * Transcribes an audio buffer using Gemini 1.5 Flash's native multimodal audio input.
 * Supports OGG (WhatsApp PTT), MP3, WAV, M4A, WEBM.
 *
 * @param audioBuffer - Raw audio as Buffer
 * @param filename    - Filename hint for MIME type detection (e.g. 'audio.ogg')
 * @param languageHint - Optional language hint for better accuracy
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  filename: string = 'audio.ogg',
  languageHint?: TranscriptionLanguageHint,
): Promise<TranscriptionResult> {
  logger.debug({ filename, sizeBytes: audioBuffer.byteLength }, 'Starting Gemini transcription');

  // Determine MIME type from extension
  const ext = filename.split('.').pop()?.toLowerCase() ?? 'ogg';
  const mimeMap: Record<string, string> = {
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    webm: 'audio/webm',
    opus: 'audio/ogg',
    mp4: 'audio/mp4',
  };
  const mimeType = mimeMap[ext] ?? 'audio/ogg';

  const model = genAI.getGenerativeModel({ model: TRANSCRIPTION_MODEL });

  const languageInstruction =
    languageHint && languageHint !== 'auto'
      ? ` The audio is primarily in ${languageHint === 'ur' ? 'Urdu' : languageHint === 'hi' ? 'Hindi' : 'English'} but may contain mixed language (Urdu/Hinglish/English).`
      : ' The audio may be in Urdu, English, or a mix (Hinglish).';

  const prompt =
    `Transcribe this audio message verbatim and completely.${languageInstruction}` +
    ' Return ONLY the transcription text — no labels, no explanations, no timestamps.' +
    ' Preserve the exact words spoken. If inaudible, write [inaudible].';

  const audioPart = {
    inlineData: {
      data: audioBuffer.toString('base64'),
      mimeType,
    },
  };

  let attempt = 0;
  while (true) {
    try {
      const result = await model.generateContent([prompt, audioPart]);
      const text = result.response.text().trim();

      logger.debug({ textLength: text.length }, 'Gemini transcription complete');
      return { text };
    } catch (err: unknown) {
      attempt++;
      if (attempt > 3) {
        logger.error({ err, filename }, 'Gemini transcription failed after 3 attempts');
        throw err;
      }
      const delay = 1000 * attempt;
      logger.warn({ attempt, delay }, 'Gemini transcription retry');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}
