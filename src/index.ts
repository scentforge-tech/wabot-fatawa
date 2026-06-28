import 'dotenv/config';
import { startBot } from './bot/connection';
import logger from './config/logger';

async function main(): Promise<void> {
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  WhatsApp Hajj/Umrah Fatawa Bot — Starting Up');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('Phase 2: Live Inference + Shaikh Approval Loop');
  logger.info('');

  await startBot();
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
