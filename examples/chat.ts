import { streamText } from 'ai';
import { createCodex } from 'aisdk-codex';

const codex = createCodex();

async function main() {
  const result = streamText({
    model: codex('gpt-5.3-codex'),
    messages: [
      { role: 'system', content: 'You answer in two short sentences.' },
      { role: 'user', content: 'What is the capital of France?' },
      { role: 'assistant', content: 'Paris is the capital of France.' },
      { role: 'user', content: 'Give me one famous museum there.' },
    ],
  });

  for await (const chunk of result.textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');
}

main().catch(console.error);
