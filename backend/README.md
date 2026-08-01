# AutoApply Backend

Minimal stateless proxy that keeps your LLM API key secret. Receives form fields + profile from the Chrome extension, calls the configured LLM, and returns fill values.

## Setup

```bash
cp .env.example .env
# Edit .env — add your OPENROUTER_API_KEY (required)
npm install
npm run dev
```

Server starts on `http://localhost:3001`.

## API

### `GET /health`
Returns `{ "status": "ok" }`.

### `POST /api/fill`

Request:
```json
{
  "fields": [
    { "id": "#first_name", "label": "First Name", "type": "text" },
    { "id": "#email", "label": "Email", "type": "email" }
  ],
  "profile": { "personal": { "name": "John Doe", "email": "john@example.com" } },
  "jobContext": { "jobTitle": "Engineer", "company": "Acme" }
}
```

Response:
```json
{
  "fills": [
    { "id": "#first_name", "value": "John", "confidence": 1.0, "reasoning": "Exact match from profile.personal.name" }
  ],
  "errors": []
}
```

## Test with curl

```bash
curl -X POST http://localhost:3001/api/fill \
  -H "Content-Type: application/json" \
  -d @sample-payload.json
```

## Deploy

### Railway
```bash
railway init && railway up
```

### Fly.io
```bash
fly launch && fly deploy
```

Set `OPENROUTER_API_KEY` as an environment variable in your deployment platform.
