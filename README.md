# Codex AI Provider

An AI SDK provider for ChatGPT's Codex API, enabling seamless integration with the Vercel AI SDK using authentication from the `codex` CLI tool.

## Features

- 🔐 Automatic authentication using `~/.codex/auth.json` (created by `codex login`)
- 🌊 Full streaming support for real-time responses
- 🛠️ Tool/function calling capabilities
- 💬 Chat conversations with system, user, and assistant messages
- 🖼️ Multimodal support (text and images)
- 🧠 Reasoning mode support for capable models
- ⚙️ Configurable settings (temperature, max tokens, etc.)

## Installation

```bash
npm install codex-ai-provider
# or
yarn add codex-ai-provider
# or
pnpm add codex-ai-provider
```

## Prerequisites

Before using this provider, you need to authenticate with the ChatGPT Codex service:

1. Install the `codex` CLI tool (if not already installed)
2. Run `codex login` to authenticate
3. This creates `~/.codex/auth.json` with your authentication tokens

## Quick Start

```typescript
import { streamText } from 'ai';
import { codex } from 'codex-ai-provider';

// Simple text generation (streaming only)
const result = await streamText({
  model: codex('gpt-5'),
  prompt: 'Write a haiku about coding.',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## Usage Examples

### Streaming Chat Conversations

```typescript
import { streamText } from 'ai';
import { codex } from 'codex-ai-provider';

const result = await streamText({
  model: codex('gpt-5'),
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'What is the capital of France?' },
    { role: 'assistant', content: 'The capital of France is Paris.' },
    { role: 'user', content: 'Tell me more about it.' },
  ],
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

### Usage Statistics

```typescript
import { streamText } from 'ai';
import { codex } from 'codex-ai-provider';

const result = await streamText({
  model: codex('gpt-5'),
  prompt: 'Explain quantum computing.',
});

// Stream the response
for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}

// Get usage statistics
const usage = await result.usage;
console.log('\nTokens:', usage);
// Output includes: inputTokens, outputTokens, totalTokens, reasoningTokens, cachedInputTokens
```

### Tool/Function Calling

```typescript
import { streamText } from 'ai';
import { codex } from 'codex-ai-provider';
import { z } from 'zod';

const result = await streamText({
  model: codex('gpt-5'),
  prompt: 'What is the weather in NYC?',
  tools: {
    getWeather: {
      description: 'Get weather for a location',
      inputSchema: z.object({
        location: z.string().describe('City name'),
      }),
      execute: async ({ location }) => {
        // Your weather API call here
        return { temperature: 72, conditions: 'sunny' };
      },
    },
  },
  toolChoice: 'required', // Force tool usage for better results
});

// Get the tool calls
const toolCalls = await result.toolCalls;
console.log('Tool calls:', toolCalls);
```

### Custom Configuration

```typescript
import { createCodex } from 'codex-ai-provider';

// Use custom authentication
const customCodex = createCodex({
  // Use API key from OPENAI_API_KEY env var
  useApiKey: true,
  baseURL: 'https://api.openai.com/v1',
});

// Or provide API key directly
const codexWithKey = createCodex({
  apiKey: 'your-api-key',
  baseURL: 'https://api.openai.com/v1',
});

// Use with custom settings
const result = await streamText({
  model: codex('gpt-5', {
    temperature: 0.7,
    maxOutputTokens: 1000,
    topP: 0.9,
    reasoning: {
      effort: 'medium',
      summary: 'auto'
    }
  }),
  prompt: 'Explain quantum computing',
});
```

## Supported Models

- `gpt-5` - Latest GPT-5 model
- `gpt-4o` - GPT-4 Optimized
- `gpt-4o-mini` - GPT-4 Optimized Mini
- `o1` - OpenAI o1 reasoning model
- `o1-mini` - OpenAI o1 mini
- Any other model ID supported by the Codex API

**Note:** The Codex API only supports streaming responses. Use `streamText()` instead of `generateText()`.

## Authentication Options

### 1. Default: Use ~/.codex/auth.json

```typescript
import { codex } from 'codex-ai-provider';

// Automatically uses ~/.codex/auth.json
const model = codex('gpt-4o');
```

### 2. Use OpenAI API Key

```typescript
import { createCodex } from 'codex-ai-provider';

const codex = createCodex({
  useApiKey: true, // Uses OPENAI_API_KEY env var
  baseURL: 'https://api.openai.com/v1',
});
```

### 3. Provide Custom API Key

```typescript
import { createCodex } from 'codex-ai-provider';

const codex = createCodex({
  apiKey: 'sk-...',
  baseURL: 'https://api.openai.com/v1',
});
```

## API Reference

### `createCodex(options?: CodexProviderSettings)`

Creates a new Codex provider instance.

**Options:**
- `baseURL?: string` - API endpoint (default: `https://chatgpt.com/backend-api`)
- `apiKey?: string` - Custom API key
- `useApiKey?: boolean` - Use OPENAI_API_KEY env var
- `headers?: Record<string, string>` - Custom headers
- `fetch?: FetchFunction` - Custom fetch implementation

### `codex(modelId: string, settings?: CodexSettings)`

Creates a language model instance.

**Settings:**
- `temperature?: number` - Sampling temperature (0.0-1.0)
- `maxOutputTokens?: number` - Maximum tokens to generate
- `topP?: number` - Top-p sampling
- `frequencyPenalty?: number` - Frequency penalty (-2.0 to 2.0)
- `presencePenalty?: number` - Presence penalty (-2.0 to 2.0)
- `stopSequences?: string[]` - Stop sequences
- `reasoning?: { effort?: 'low'|'medium'|'high', summary?: 'auto'|'none' }` - Reasoning mode
- `verbosity?: 'low'|'medium'|'high'` - Response verbosity
- `seed?: number` - Seed for deterministic generation

### `CodexAuth`

Authentication utility class.

**Methods:**
- `validateAuth(): Promise<boolean>` - Check if authentication is valid
- `getAuthFilePath(): string` - Get path to auth.json
- `getAccessToken(): Promise<string>` - Get current access token
- `getAccountId(): Promise<string>` - Get account ID

## Error Handling

```typescript
import { CodexAuth } from 'codex-ai-provider';

// Check authentication before making requests
const isValid = await CodexAuth.validateAuth();
if (!isValid) {
  console.error('Please run "codex login" first');
  process.exit(1);
}

// Handle API errors
try {
  const result = await generateText({
    model: codex('gpt-4o'),
    prompt: 'Hello',
  });
} catch (error) {
  if (error.message.includes('Authentication')) {
    console.error('Auth error:', error.message);
  } else {
    console.error('API error:', error.message);
  }
}
```

## Development

```bash
# Install dependencies
pnpm install

# Build the project
pnpm build

# Run examples
pnpm run example:simple        # Basic text generation
pnpm run example:streaming     # Streaming with tools
pnpm run example:auth          # Check authentication
pnpm run example:refresh       # Test token refresh

# Development mode
pnpm dev                        # Watch mode for development
pnpm typecheck                  # Type checking
```

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Related Projects

- [Vercel AI SDK](https://github.com/vercel/ai)
- [OpenAI Codex](https://github.com/openai/codex)
