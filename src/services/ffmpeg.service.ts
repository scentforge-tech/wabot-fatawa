import ffmpeg from 'fluent-ffmpeg';
import { Readable, PassThrough } from 'stream';
import logger from '../config/logger';

/**
 * Convert any audio buffer to 16 kHz mono WAV (required by Whisper for best results).
 * Uses fluent-ffmpeg in streaming mode — no temp files written to disk.
 */
export async function convertToWav(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const inputStream = Readable.from(inputBuffer);
    const outputStream = new PassThrough();

    ffmpeg(inputStream)
      // No inputFormat hint — let ffmpeg auto-detect from the stream
      .audioFrequency(16000)
      .audioChannels(1)
      .audioCodec('pcm_s16le')
      .format('wav')
      .on('error', (err) => {
        logger.error({ err }, 'ffmpeg WAV conversion failed');
        reject(err);
      })
      .pipe(outputStream, { end: true });

    outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    outputStream.on('error', reject);
  });
}

/**
 * Convert any audio buffer to OGG Opus format for WhatsApp PTT dispatch.
 * WhatsApp expects OGG with the Opus codec for push-to-talk messages.
 */
export async function convertToOggOpus(inputBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const inputStream = Readable.from(inputBuffer);
    const outputStream = new PassThrough();

    ffmpeg(inputStream)
      // Auto-detect input format from stream
      .audioCodec('libopus')
      .audioBitrate('64k')
      .audioChannels(1)
      .audioFrequency(48000)
      .format('ogg')
      .on('error', (err) => {
        logger.error({ err }, 'ffmpeg OGG Opus conversion failed');
        reject(err);
      })
      .pipe(outputStream, { end: true });

    outputStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    outputStream.on('error', reject);
  });
}

/**
 * Probe an audio buffer to detect its duration in seconds.
 * Useful for validating audio before sending to Whisper.
 */
export async function getAudioDuration(inputBuffer: Buffer): Promise<number> {
  return new Promise((resolve, reject) => {
    const inputStream = Readable.from(inputBuffer);
    ffmpeg(inputStream).ffprobe((err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration ?? 0);
    });
  });
}
