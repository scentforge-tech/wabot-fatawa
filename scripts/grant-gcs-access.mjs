// Grant Firebase SA storage access to the GCS auth bucket
import { Storage } from '@google-cloud/storage';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUCKET = process.env.GCS_AUTH_BUCKET || 'masjidmap-5yvj5-wabot-auth';
const SA_PATH = path.join(ROOT, 'firebase-service-account.json');

if (!fs.existsSync(SA_PATH)) { console.error('firebase-service-account.json not found'); process.exit(1); }
const saKey = JSON.parse(fs.readFileSync(SA_PATH, 'utf8'));
const storage = new Storage({ projectId: saKey.project_id, keyFilename: SA_PATH });
const bucket = storage.bucket(BUCKET);

const [policy] = await bucket.iam.getPolicy({ requestedPolicyVersion: 3 });
const member = `serviceAccount:${saKey.client_email}`;
const role = 'roles/storage.objectAdmin';

let binding = policy.bindings?.find(b => b.role === role);
if (binding) {
  if (!binding.members?.includes(member)) { binding.members.push(member); }
} else {
  if (!policy.bindings) policy.bindings = [];
  policy.bindings.push({ role, members: [member] });
}
await bucket.iam.setPolicy(policy);
console.log(`✅ Granted ${role} to ${member}`);
console.log('Cloud Run now has access to gs://' + BUCKET);
