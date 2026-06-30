// Create FIREBASE_SERVICE_ACCOUNT_JSON secret in Google Secret Manager
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SA_PATH = path.join(ROOT, 'firebase-service-account.json');
const saJson = fs.readFileSync(SA_PATH, 'utf8');
const saKey = JSON.parse(saJson);

const client = new SecretManagerServiceClient({ credentials: saKey });
const PROJECT = 'masjidmap-5yvj5';
const SECRET_ID = 'FIREBASE_SERVICE_ACCOUNT_JSON';

// Create the secret if it doesn't exist
try {
  await client.createSecret({
    parent: `projects/${PROJECT}`,
    secretId: SECRET_ID,
    secret: { replication: { automatic: {} } },
  });
  console.log('✅ Secret created:', SECRET_ID);
} catch (e) {
  if (e.code === 6) {
    console.log('ℹ️  Secret already exists, adding new version...');
  } else {
    throw e;
  }
}

// Add the Firebase SA JSON as the secret value
const [version] = await client.addSecretVersion({
  parent: `projects/${PROJECT}/secrets/${SECRET_ID}`,
  payload: { data: Buffer.from(saJson) },
});
console.log('✅ Secret version added:', version.name);
console.log('Cloud Run can now use FIREBASE_SERVICE_ACCOUNT_JSON to access GCS');
