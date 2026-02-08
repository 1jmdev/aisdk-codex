import { generateText, streamText } from 'ai';
import { createCodex } from '../src/codex-provider.js';

// Create a provider instance.
// By default it reads auth from ~/.codex/auth.json (run `codex login` first).
// You can also pass { apiKey: '...' } or { useApiKey: true } to use OPENAI_API_KEY.
const codex = createCodex();

// Pick a model
const model = codex('gpt-5.3-codex');

// ── Example 1: Non-streaming generation ────────────────────────────────

async function nonStreaming() {
  console.log('--- Non-streaming ---\n');

  const { text, usage, finishReason } = await generateText({
    model,
    prompt: 'Write a haiku about TypeScript.',
  });

  console.log(text);
  console.log('\nUsage:', usage);
  console.log('Finish reason:', finishReason);
}

// ── Example 2: Streaming generation ────────────────────────────────────

async function streaming() {
  console.log('\n--- Streaming ---\n');

  const result = streamText({
    model,
    prompt: 'Explain what the AI SDK provider spec is in 2-3 sentences.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }

  console.log('\n\nUsage:', await result.usage);
  console.log('Finish reason:', await result.finishReason);
}

// ── Run ────────────────────────────────────────────────────────────────

async function main() {
  await nonStreaming();
  await streaming();
}

main().catch(console.error);
