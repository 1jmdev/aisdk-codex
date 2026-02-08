import { streamText } from 'ai';
import { createCodex } from 'aisdk-codex';

const codex = createCodex();

async function main() {
  const result = streamText({
    model: codex('gpt-5.3-codex'),
    prompt: 'Explain AI SDK providers in one short paragraph.',
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
}

main().catch(console.error);
