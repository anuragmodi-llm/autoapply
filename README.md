# AutoApply

Chrome extension that auto-fills job application forms on Greenhouse and Lever using AI. You create a profile once, then click "Autofill" on any supported application page.

## Architecture

```
┌─────────────────────────────────────────────┐
│  Chrome Extension (Manifest V3)             │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐ │
│  │  Popup   │  │ Options  │  │  Content  │ │
│  │ (trigger)│  │ (profile)│  │  Script   │ │
│  └────┬─────┘  └──────────┘  └─────┬─────┘ │
│       │ message                     │       │
│       └─────────────────────────────┘       │
│                     │ fetch                 │
└─────────────────────┼───────────────────────┘
                      │
          ┌───────────▼───────────┐
          │  Backend Proxy        │
          │  (Fastify, stateless) │
          │                       │
          │  ┌─────────────────┐  │
          │  │  LLM Router     │  │
          │  │  ┌───────────┐  │  │
          │  │  │ OpenRouter│  │  │
          │  │  │ Together  │  │  │
          │  │  └───────────┘  │  │
          │  └─────────────────┘  │
          └───────────────────────┘
```

## Quick Start

### 1. Start the backend

```bash
cd backend
cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY
npm install
npm run dev
```

### 2. Load the extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `autoapply/extension` folder
4. The options page opens automatically

### 3. Set up your profile

Fill in your personal info, experience, education, skills, Q&A bank, and preferences. Click **Save Profile**.

### 4. Autofill a job application

1. Navigate to a Greenhouse or Lever job application page
2. Click the AutoApply extension icon in the toolbar
3. Click **Autofill This Page**
4. Review the filled fields — the overlay shows status per field
5. Submit manually when you're satisfied

## Swapping LLM Models

Edit `backend/.env`:

```bash
# Use a different model on OpenRouter
LLM_MODEL=microsoft/phi-4-mini-instruct

# Or switch provider entirely
LLM_PROVIDER=together
LLM_MODEL=meta-llama/Llama-3-70b-chat-hf
```

Restart the backend. No code changes needed.

## Adding a New LLM Provider

1. Create `backend/src/llm/providers/your-provider.js`
2. Export a `complete({ model, messages, temperature, maxTokens, responseSchema })` function
3. Return `{ content: string, usage: object }`
4. Add a `case` in `backend/src/llm/index.js` → `loadProvider()`
5. Set `LLM_PROVIDER=your-provider` in `.env`

## Adding a New ATS Adapter

1. In `extension/content/content-script.js`, add a new adapter object following the `greenhouseAdapter` pattern
2. Implement `matches()`, `getLabel()`, `getContext()`, and set `selectors`
3. Add the adapter to the `detectAdapter()` function
4. Add the ATS URL pattern to `manifest.json` → `host_permissions` and `content_scripts.matches`
5. Add the pattern to `popup.js` → `SUPPORTED_PATTERNS`

## Supported ATS Platforms

- **Greenhouse** — `boards.greenhouse.io/*`
- **Lever** — `jobs.lever.co/*`

## Profile Import / Export

Use the **Export** and **Import** buttons on the options page to backup or transfer your profile as a JSON file.

## Edge Cases Handled

- React-controlled inputs (native setter workaround)
- Custom/non-native dropdowns (click-to-open + option matching)
- Dynamic fields loaded after page render (MutationObserver + re-extraction up to 3 rounds)
- Validation errors detected and surfaced after fill
- Multi-page forms detected with user prompt
- Rate limiting with exponential backoff
- Offline detection
- Low-confidence answers flagged for review
- File upload fields skipped with user warning
- Profile trimmed to 5 most recent roles to stay within token limits
- maxLength truncation

## Privacy

- Profile stored locally in `chrome.storage.local` — never sent to any server except the backend you control
- Backend never logs profile contents (only field IDs and types)
- No telemetry, no analytics, no tracking
- Usage counter stored locally only

## Deploy Backend

### Railway

```bash
cd backend
railway init
railway up
```

### Fly.io

```bash
cd backend
fly launch
fly deploy
```

After deploying, update `BACKEND_URL` in `extension/content/content-script.js` to your deployed URL.
