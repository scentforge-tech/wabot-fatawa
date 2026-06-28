# WhatsApp Hajj/Umrah Fatawa Bot

A production-grade, two-phase WhatsApp bot that routes pilgrims' Hajj and Umrah questions (as voice notes) through a Shaikh approval loop before dispatching verified answers back to the group.

---

## Architecture

```
PHASE 1 — Historic Data Seeding
  Text/Audio Files → Whisper → Gemini 1.5 Pro → pgvector Embeddings → Supabase

PHASE 2 — Live WhatsApp Bot
  Pilgrim voice note → Whisper → Embed → Cosine Similarity Search
  → Composite Scoring → Gemini Draft (gated) → TTS
  → Admin group (Shaikh review) → PTT reply to public group
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | ≥ 20 |
| ffmpeg | Any recent (installed system-wide or via Docker) |
| Supabase project | With pgvector enabled |
| OpenAI API key | For Whisper, embeddings, TTS |
| Gemini API key | For Gemini 1.5 Pro |

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys and group JIDs
```

### 3. Run the Supabase Migration

Copy and run `supabase/migrations/001_init_fatawa.sql` in your Supabase SQL Editor.

### 4. Phase 1 — Seed Historical Data

```bash
# From WhatsApp text export
npm run seed -- --text-file ./data/chat.txt

# From audio directory (OGG/MP3 pairs named <name>_q.ogg + <name>_a.ogg)
npm run seed -- --audio-dir ./data/voice_notes

# Both together
npm run seed -- --text-file ./data/chat.json --audio-dir ./data/voice_notes

# Preview without writing to DB
npm run seed -- --text-file ./data/chat.txt --dry-run
```

### 5. Phase 2 — Start the Live Bot

```bash
# Development (with hot-reload friendly ts-node)
npm run dev

# Production (compiled)
npm run build
npm start
```

On first run, a QR code will appear in the console. Scan it with WhatsApp on the bot's dedicated phone number.

---

## Audio File Naming Convention (for Phase 1)

For paired question/answer audio files, use the suffix convention:

```
voice_notes/
  hajj_001_q.ogg    ← Pilgrim's question
  hajj_001_a.ogg    ← Shaikh's answer
  ihram_rules_q.mp3
  ihram_rules_a.mp3
```

Files without a `_q` / `_a` suffix are treated as standalone questions.

---

## Composite Scoring Formula

```
compositeScore = (
  vectorSimilarity   × 0.50  +
  normalizedFrequency × 0.30  +
  confidenceScore     × 0.20
)

normalizedFrequency = min(1.0, log10(frequency_count + 1) / 3)
```

| Composite Score | Tier | Action |
|---|---|---|
| ≥ 0.85 | HIGH | Draft using Shaikh's exact historical wording |
| 0.60 – 0.84 | MEDIUM | Draft with "needs verification" disclaimer |
| < 0.60 | LOW | `FLAG_FOR_SHAIKH_MANUAL_REVIEW` — no draft generated |

---

## Shaikh Approval Keywords

The bot listens for the following voice keywords in the admin group:

**Approval:** `approve`, `approved`, `yes`, `haan`, `han`, `sahi hai`, `sahi he`, `theek hai`, `bilkul`, `bhej do`, ...

**Rejection:** `nahi`, `na`, `no`, `reject`, `galat`, `theek nahi`, `mat bhejo`, ...

> **Important:** The Shaikh must **quote-reply** to the specific draft audio message when approving. This ensures the system can match the approval to the correct pending draft.

---

## Docker Deployment

```bash
# Build and start
docker-compose up -d --build

# View logs (including QR code on first run)
docker-compose logs -f wabot

# The auth session persists in the Docker named volume: wabot_auth_info
```

The `auth_info_baileys/` data is stored in a named Docker volume and persists across container restarts and image rebuilds.

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | Whisper transcription, embeddings, TTS |
| `GEMINI_API_KEY` | ✅ | Gemini 1.5 Pro categorization & drafting |
| `SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Service role key (full DB access) |
| `ADMIN_GROUP_JID` | ✅ | Private admin/Shaikh group WhatsApp JID |
| `PUBLIC_GROUP_JID` | ✅ | Public pilgrim group WhatsApp JID |
| `TTS_PROVIDER` | ❌ | `openai` (default) or `elevenlabs` |
| `OPENAI_TTS_VOICE` | ❌ | `nova` (default) |
| `ELEVENLABS_API_KEY` | ❌ | Required if `TTS_PROVIDER=elevenlabs` |
| `ELEVENLABS_VOICE_ID` | ❌ | Required if `TTS_PROVIDER=elevenlabs` |
| `DEDUP_SIMILARITY_THRESHOLD` | ❌ | Default `0.92` |
| `MATCH_THRESHOLD` | ❌ | Default `0.55` |
| `MATCH_COUNT` | ❌ | Default `5` |
| `LOG_LEVEL` | ❌ | Default `info` |
| `AUTH_DIR` | ❌ | Default `./auth_info_baileys` |
| `TMP_DIR` | ❌ | Default `./tmp` |

---

## Finding Your Group JIDs

Start the bot, join the groups, then temporarily add this to `connection.ts` to log all incoming message JIDs:

```typescript
sock.ev.on('messages.upsert', ({ messages }) => {
  messages.forEach(m => console.log('JID:', m.key.remoteJid));
});
```

---

## Project Structure

```
WABOT/
├── src/
│   ├── config/
│   │   ├── env.ts              # Zod-validated environment
│   │   └── logger.ts           # Pino structured logger
│   ├── services/
│   │   ├── whisper.service.ts  # OpenAI Whisper transcription
│   │   ├── gemini.service.ts   # Gemini 1.5 Pro AI service
│   │   ├── embeddings.service.ts # text-embedding-3-small
│   │   ├── supabase.service.ts # pgvector upsert + cosine search
│   │   ├── tts.service.ts      # OpenAI/ElevenLabs TTS
│   │   └── ffmpeg.service.ts   # Audio format conversion
│   ├── pipeline/               # Phase 1: seeding pipeline
│   │   ├── ingestor.ts
│   │   ├── categorizer.ts
│   │   ├── deduplicator.ts
│   │   └── seeder.ts
│   ├── bot/                    # Phase 2: live bot
│   │   ├── connection.ts       # Baileys WebSocket + reconnect
│   │   ├── scoring.ts          # Composite score calculation
│   │   ├── draft.ts            # Gemini draft gating
│   │   └── handlers/
│   │       ├── audio.handler.ts    # Public group voice note handler
│   │       └── approval.handler.ts # Admin group Shaikh approval
│   └── index.ts
├── scripts/
│   └── seed.ts                 # Phase 1 CLI entrypoint
├── supabase/
│   └── migrations/
│       └── 001_init_fatawa.sql
├── auth_info_baileys/          # WhatsApp session (gitignored)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

## ⚠️ Important Warnings

1. **Dedicated number**: Run this bot on a dedicated WhatsApp number. Running automation on a personal number risks account suspension.
2. **Service role key**: The `SUPABASE_SERVICE_ROLE_KEY` bypasses Row-Level Security. Never expose it client-side.
3. **Auth tokens**: The `auth_info_baileys/` folder contains your WhatsApp session. Treat it like a password — never commit it to git.
4. **WhatsApp ToS**: Baileys uses the WhatsApp Web protocol. Use responsibly.
