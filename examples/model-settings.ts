import { streamText } from 'ai';
import { createCodex } from 'aisdk-codex';

const codex = createCodex();

async function main() {
  const result = streamText({
    model: codex('gpt-5.3-codex', {
      reasoning: { effort: 'medium', summary: 'auto' },
      seed: 42,
    }),
    temperature: 0.2,
    topP: 0.9,
    maxOutputTokens: 120,
    prompt: 'Give 3 concise tips for writing safer TypeScript.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
}

main().catch(console.error);
