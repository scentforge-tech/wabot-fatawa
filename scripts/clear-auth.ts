// One-shot script: clears _wabot_auth collection from Firestore
// Run with: npx ts-node --project tsconfig.scripts.json scripts/clear-auth.ts
import 'dotenv/config';
import { clearFirestoreAuth } from '../src/bot/auth-firestore';

(async () => {
  console.log('Clearing _wabot_auth from Firestore...');
  await clearFirestoreAuth();
  console.log('Done. You can now restart the bot — it will show a fresh QR.');
  process.exit(0);
})();
