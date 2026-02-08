import { generateText } from 'ai';
import { createCodex } from 'aisdk-codex';

// Just pass refresh token from ~/.codex/auth.json
const codex = createCodex({
    refreshToken: "your_refresh_token"
});

async function main() {
  const { text } = await generateText({
    model: codex('gpt-5.3-codex'),
    prompt: 'Write a one-line haiku about TypeScript.',
  });

  console.log(text);
}

main().catch(console.error);
