import OpenAI from 'openai';
import { env } from '../config/env';
import logger from '../config/logger';
import { convertToOggOpus } from './ffmpeg.service';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

/**
 * Strip markdown formatting characters so TTS reads cleanly.
 * Removes: **bold**, *italic*, `code`, #headings, [links](url), bullet points
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')          // headings
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1') // bold/italic
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')   // inline code / code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links
    .replace(/^[\s]*[-*+]\s+/gm, '')         // bullet points
    .replace(/\n{3,}/g, '\n\n')              // excess blank lines
    .trim();
}

/**
 * Convert text to a WhatsApp-compatible OGG Opus audio buffer.
 * Uses OpenAI TTS by default; ElevenLabs if configured.
 *
 * @param text - Plain text (markdown will be stripped automatically)
 * @returns OGG Opus Buffer ready for WhatsApp PTT dispatch
 */
export async function textToSpeech(text: string): Promise<Buffer> {
  const cleanText = stripMarkdown(text);
  logger.debug({ textLength: cleanText.length }, 'Starting TTS conversion');

  let mp3Buffer: Buffer;

  if (env.TTS_PROVIDER === 'elevenlabs') {
    mp3Buffer = await elevenLabsTTS(cleanText);
  } else {
    mp3Buffer = await openaiTTS(cleanText);
  }

  // Convert MP3 → OGG Opus (required by WhatsApp for PTT messages)
  const oggBuffer = await convertToOggOpus(mp3Buffer);
  logger.debug({ outputBytes: oggBuffer.length }, 'TTS conversion complete');
  return oggBuffer;
}

// ─── OpenAI TTS ──────────────────────────────────────────────────────────────

async function openaiTTS(text: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: env.OPENAI_TTS_VOICE,
    input: text,
    response_format: 'mp3',
    speed: 0.92, // Slightly slower for clarity in Urdu/Hinglish
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ─── ElevenLabs TTS (optional) ───────────────────────────────────────────────

async function elevenLabsTTS(text: string): Promise<Buffer> {
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
    throw new Error('ElevenLabs API key and Voice ID must be set in .env');
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.65,
          similarity_boost: 0.8,
          style: 0.2,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs TTS error ${response.status}: ${errText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
