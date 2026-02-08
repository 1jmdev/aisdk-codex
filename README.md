# aisdk-codex

AI SDK v6 provider for the ChatGPT Codex Responses API.

This package exports a provider compatible with `ai` (`streamText`, `generateText`, tool calling, and chat prompts).

## Installation

```bash
npm install aisdk-codex ai
```

## Authentication

`createCodex()` supports three auth modes:

1. Default (no options): reads `~/.codex/auth.json` from `codex login`
2. `useApiKey: true`: reads `OPENAI_API_KEY`
3. `apiKey: '...'`: explicit key
4. `refreshToken: '...'`: exchanges refresh token for access token and auto-refreshes it

Default base URL is:

```text
https://chatgpt.com/backend-api
```

When using an OpenAI API key, set `baseURL` appropriately (for example `https://api.openai.com/v1`).

Auth precedence is:

1. `apiKey`
2. `refreshToken`
3. `useApiKey`
4. `~/.codex/auth.json`

## Quick Start

```ts
import { streamText } from 'ai';
import { createCodex } from 'aisdk-codex';

const codex = createCodex();

const result = streamText({
  model: codex('gpt-5.3-codex'),
  prompt: 'Explain AI SDK providers in one short paragraph.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
process.stdout.write('\n');
```

## API

### `createCodex(options?)`

Options:

- `baseURL?: string`
- `headers?: Record<string, string>`
- `fetch?: FetchFunction`
- `useApiKey?: boolean`
- `apiKey?: string`
- `refreshToken?: string`

Returns a provider function:

```ts
const codex = createCodex();
const model = codex('gpt-5.3-codex');
```

Refresh-token auth example:

```ts
const codex = createCodex({
  refreshToken: process.env.CODEX_REFRESH_TOKEN!,
});
```

### `codex(modelId, settings?)`

Per-model settings (`CodexSettings`):

- `reasoning?: { effort?: 'low' | 'medium' | 'high'; summary?: 'auto' | 'concise' | 'detailed' }`
- `store?: boolean`
- `seed?: number`

Per-call generation settings are passed through AI SDK options (for example `temperature`, `topP`, `maxOutputTokens`, penalties, stop sequences, and tool configuration).

## Known model IDs

The type includes:

- `gpt-5`
- `gpt-5.1-codex`
- `gpt-5.1-codex-max`
- `gpt-5.1-codex-mini`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gpt-5.3-codex`

Any string model ID is also accepted for forward compatibility.

## Behavior and Limitations

- Uses `POST {baseURL}/codex/responses`.
- `generateText()` works by buffering streamed SSE events in `doGenerate`.
- `topK` is marked unsupported (warning).
- JSON `responseFormat` is marked unsupported (warning).
- Provider tools are filtered; function tools are forwarded.
- System messages are merged into top-level `instructions`.
- User image files are converted to `input_image` URLs (including base64 data URLs).
- Non-image files are converted into placeholder text.
- Embedding and image models are not implemented (`NoSuchModelError`).

## Exports

- `createCodex`, `codex`
- `CodexLanguageModel`
- Types: `CodexProvider`, `CodexProviderSettings`, `CodexModelConfig`, `CodexModelId`, `CodexSettings`
- Auth helper: `CodexAuth` and auth-related types

## Local Development

```bash
npm run build
```

Package scripts currently defined:

- `build`
- `prepublishOnly`

## Examples in repo

- `examples/streaming.ts`
- `examples/non-streaming.ts`
- `examples/chat.ts`
- `examples/model-settings.ts`
- `examples/apikey.ts`

## License

MIT
