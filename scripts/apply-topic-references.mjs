#!/usr/bin/env node
/**
 * Apply Topic-Level Authentic References
 *
 * Reads OUTPUT/topic_references.json (produced by the citation research workflow)
 * and, for each topic:
 *   - Writes authenticReferences (verified Quran/Hadith citations) onto every
 *     _fatawa_kb record with that topic.
 *   - If the topic had no authenticRuling/rulingKeyPoints before, also writes the
 *     newly-researched rulingSummary/keyPoints (GENERAL is intentionally skipped —
 *     it stays without a single ruling; only its foundational citations are applied).
 *   - Rebuilds the multilingual embedding text to include the new reference content
 *     and re-embeds via Gemini, so citation terms are searchable too.
 *
 * Run:
 *   node --env-file=.env scripts/apply-topic-references.mjs
 *
 * Options:
 *   APPLY_DRY_RUN=true   Print what would change, write nothing
 *   APPLY_TOPIC=IHRAM    Only process one topic (for spot-testing)
 */

import { Firestore } from '@google-cloud/firestore';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');

const PROJECT_ID      = process.env.FIREBASE_PROJECT_ID;
const SA_PATH         = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? './firebase-service-account.json';
const GEMINI_KEY      = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta';
const DRY_RUN         = process.env.APPLY_DRY_RUN === 'true';
const ONLY_TOPIC      = process.env.APPLY_TOPIC || null;

if (!PROJECT_ID || !GEMINI_KEY) {
  console.error('❌  FIREBASE_PROJECT_ID and GEMINI_API_KEY must be set in .env');
  process.exit(1);
}

const sa = JSON.parse(readFileSync(resolve(ROOT, SA_PATH), 'utf-8'));
const db = new Firestore({ projectId: PROJECT_ID, credentials: { client_email: sa.client_email, private_key: sa.private_key } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getEmbedding(text) {
  const url = `${GEMINI_BASE}/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text: text.trim().slice(0, 3000) }] },
      outputDimensionality: 768,
    }),
  });
  if (!res.ok) throw new Error(`Gemini embed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j.embedding.values;
}

function referencesToSearchText(refs) {
  if (!refs || !refs.length) return '';
  return refs
    .map((r) => `${r.citation}: ${r.english} (${r.romanUrdu})`)
    .join('\n');
}

// Mirrors deriveMultilingualKeywords() in src/services/fatawa-kb.service.ts —
// Unicode-aware so it naturally captures English, Urdu script, and Roman Urdu
// tokens from whichever fields are passed in.
const KEYWORD_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'that', 'this', 'with', 'from', 'they',
  'have', 'been', 'will', 'also', 'more', 'when', 'can', 'not', 'but', 'what',
  'how', 'you', 'your', 'please', 'thank', 'jazak', 'khair', 'salam', 'alaikum',
  'assalam', 'wa', 'rahmatullahi', 'wabarakatuhu',
  'aur', 'hai', 'hain', 'kya', 'koi', 'bhi', 'mein', 'main', 'hum',
  'yeh', 'woh', 'kaise', 'kyun', 'kab', 'kaun', 'kahan', 'kis', 'ka', 'ki', 'ke',
  'se', 'ko', 'sakte', 'sakti', 'karna', 'karein', 'chahiye',
]);

function deriveMultilingualKeywords(sources) {
  const words = sources
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !KEYWORD_STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 40);
}

async function main() {
  console.log('\n🕋 Apply Topic-Level Authentic References\n');
  if (DRY_RUN) console.log('   ⚠️  DRY RUN — no writes will be made\n');

  const refsPath = join(ROOT, 'OUTPUT', 'topic_references.json');
  if (!existsSync(refsPath)) {
    console.error(`❌ ${refsPath} not found — run the citation research workflow first`);
    process.exit(1);
  }
  const packs = JSON.parse(readFileSync(refsPath, 'utf-8'));
  console.log(`📂 Loaded ${packs.length} topic reference packs\n`);

  let totalRecordsUpdated = 0;
  let totalCitations = 0;
  const summary = [];

  for (const pack of packs) {
    if (ONLY_TOPIC && pack.topic !== ONLY_TOPIC) continue;
    const citations = pack.citations || [];
    if (!citations.length) {
      console.log(`⏭️  ${pack.topic}: 0 verified citations — skipping`);
      summary.push({ topic: pack.topic, recordsUpdated: 0, citations: 0, note: 'no verified citations' });
      continue;
    }

    // GENERAL is intentionally left without a single ruling — only citations applied.
    const isGeneral = pack.topic === 'GENERAL';
    const newRulingSummary = !isGeneral && pack.rulingSummary ? pack.rulingSummary : undefined;
    const newKeyPoints = !isGeneral && Array.isArray(pack.keyPoints) && pack.keyPoints.length
      ? pack.keyPoints.join('\n')
      : undefined;

    console.log(`\n📌 ${pack.topic}: ${citations.length} verified citation(s)${newRulingSummary ? ' + new ruling summary' : ''}`);

    const snap = await db.collection('_fatawa_kb').where('topic', '==', pack.topic).get();
    console.log(`   ${snap.size} matching KB record(s)`);

    let updated = 0;
    for (const doc of snap.docs) {
      const rec = doc.data();
      try {
        const existingSearchText = rec.multilingualText || rec.combinedSearchText || rec.question || '';
        const refText = referencesToSearchText(citations);
        const embedText = [
          existingSearchText,
          newRulingSummary ? `Islamic ruling: ${newRulingSummary}` : '',
          newKeyPoints ? `Key points: ${newKeyPoints}` : '',
          refText ? `Authentic references: ${refText}` : '',
        ].filter(Boolean).join('\n');

        const patch = {
          authenticReferences: citations,
          keywords: deriveMultilingualKeywords([
            ...(rec.keywords || []),
            rec.question, rec.questionExpanded, rec.answerTranscript, rec.answerTranscriptProcessed,
            rec.romanUrduTranscript, rec.englishTranslation, rec.topic,
            newRulingSummary, newKeyPoints,
            ...citations.map((c) => `${c.english} ${c.romanUrdu} ${c.urdu}`),
          ]),
        };
        if (newRulingSummary) patch.authenticRuling = newRulingSummary;
        if (newKeyPoints) patch.rulingKeyPoints = newKeyPoints;

        if (!DRY_RUN) {
          await sleep(300);
          patch.embedding = await getEmbedding(embedText);
          patch.multilingualText = embedText.slice(0, 2000);
          await db.collection('_fatawa_kb').doc(doc.id).set(patch, { merge: true });
        }
        updated++;
        process.stdout.write(`   ✅ ${doc.id}\r`);
      } catch (err) {
        console.error(`\n   ❌ ${doc.id}: ${err.message.slice(0, 100)}`);
      }
    }
    console.log(`\n   → ${updated}/${snap.size} records updated`);
    totalRecordsUpdated += updated;
    totalCitations += citations.length;
    summary.push({ topic: pack.topic, recordsUpdated: updated, citations: citations.length, newRuling: !!newRulingSummary });
  }

  console.log(`
╔════════════════════════════════════════════════╗
║   TOPIC REFERENCES APPLIED                     ║
╠════════════════════════════════════════════════╣
║  Records updated:  ${String(totalRecordsUpdated).padEnd(28)}║
║  Total citations:  ${String(totalCitations).padEnd(28)}║
╚════════════════════════════════════════════════╝
`);

  writeFileSync(join(ROOT, 'OUTPUT', 'apply_summary.json'), JSON.stringify(summary, null, 2));
  console.log('📝 Summary written to OUTPUT/apply_summary.json');
  if (!DRY_RUN) console.log('\n⚠️  Restart the bot process to pick up the refreshed KB cache.\n');
}

main().catch((err) => { console.error('\n❌ Fatal:', err); process.exit(1); });
