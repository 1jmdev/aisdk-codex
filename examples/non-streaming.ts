import { generateText } from 'ai';
import { createCodex } from 'aisdk-codex';

const codex = createCodex();

async function main() {
  const { text, usage } = await generateText({
    model: codex('gpt-5.3-codex'),
    prompt: 'Write a one-line haiku about TypeScript.',
  });

  console.log(text);
  console.log(usage);
}

main().catch(console.error);
