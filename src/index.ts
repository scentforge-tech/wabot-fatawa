import 'dotenv/config';
import * as http from 'http';
import { startBot } from './bot/connection';
import { env } from './config/env';
import logger from './config/logger';

// ─── Cloud Run Health Check Server ───────────────────────────────────────────
// Cloud Run requires a process listening on $PORT.
// This minimal HTTP server handles health checks while the bot runs in parallel.

const healthServer = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'wabot-fatawa', timestamp: new Date().toISOString() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

healthServer.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, `Health check server listening on port ${env.PORT}`);
});

// ─── Bot Startup ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  WhatsApp Hajj/Umrah Fatawa Bot — Starting Up');
  logger.info('  Powered by: Gemini + Firebase + Google Cloud TTS');
  logger.info('═══════════════════════════════════════════════════════');

  await startBot();
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
