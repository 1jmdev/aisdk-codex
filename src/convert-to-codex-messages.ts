import type {
  LanguageModelV3Prompt,
  LanguageModelV3FunctionTool,
  LanguageModelV3ProviderTool,
  LanguageModelV3ToolChoice,
} from '@ai-sdk/provider';

// ── Codex Responses API types ──────────────────────────────────────────

/**
 * Input item for the Codex Responses API (`/codex/responses`).
 * This mirrors the OpenAI Responses API format.
 */
export type CodexInputItem =
  | CodexSystemMessage
  | CodexUserMessage
  | CodexAssistantMessage
  | CodexFunctionCall
  | CodexFunctionCallOutput;

export interface CodexSystemMessage {
  type: 'message';
  role: 'system';
  content: Array<{ type: 'input_text'; text: string }>;
}

export interface CodexUserMessage {
  type: 'message';
  role: 'user';
  content: Array<CodexInputText | CodexInputImage>;
}

export interface CodexAssistantMessage {
  type: 'message';
  role: 'assistant';
  content: Array<CodexInputText | CodexOutputText>;
}

export interface CodexFunctionCall {
  type: 'function_call';
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface CodexFunctionCallOutput {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

interface CodexInputText {
  type: 'input_text';
  text: string;
}

interface CodexOutputText {
  type: 'output_text';
  text: string;
}

interface CodexInputImage {
  type: 'input_image';
  image_url: string;
}

// ── Codex tool format ──────────────────────────────────────────────────

export interface CodexTool {
  type: 'function';
  name: string;
  description?: string;
  strict?: boolean;
  parameters?: unknown;
}

// ── Conversion logic ───────────────────────────────────────────────────

/**
 * Convert AI SDK V3 prompt into Codex Responses API format.
 *
 * The Codex API requires system instructions in a top-level `instructions`
 * field rather than as system messages in the `input` array. This function
 * extracts system messages and returns them separately.
 */
export function convertToCodexInput(prompt: LanguageModelV3Prompt): {
  instructions: string;
  input: CodexInputItem[];
} {
  const systemParts: string[] = [];
  const items: CodexInputItem[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'system': {
        // Collect system messages for the top-level `instructions` field
        systemParts.push(message.content);
        break;
      }

      case 'user': {
        const content: Array<CodexInputText | CodexInputImage> = [];

        for (const part of message.content) {
          switch (part.type) {
            case 'text': {
              content.push({ type: 'input_text', text: part.text });
              break;
            }
            case 'file': {
              if (part.mediaType.startsWith('image/')) {
                let imageUrl: string;
                if (part.data instanceof URL) {
                  imageUrl = part.data.toString();
                } else if (typeof part.data === 'string') {
                  // base64 encoded
                  imageUrl = `data:${part.mediaType};base64,${part.data}`;
                } else {
                  // Uint8Array
                  const base64 = Buffer.from(part.data).toString('base64');
                  imageUrl = `data:${part.mediaType};base64,${base64}`;
                }
                content.push({ type: 'input_image', image_url: imageUrl });
              } else {
                // Non-image files: include as text placeholder
                content.push({
                  type: 'input_text',
                  text: `[File: ${part.filename ?? 'unnamed'} (${part.mediaType})]`,
                });
              }
              break;
            }
          }
        }

        items.push({ type: 'message', role: 'user', content });
        break;
      }

      case 'assistant': {
        const textParts: Array<CodexInputText | CodexOutputText> = [];
        const functionCalls: CodexFunctionCall[] = [];

        for (const part of message.content) {
          switch (part.type) {
            case 'text': {
              textParts.push({ type: 'output_text', text: part.text });
              break;
            }
            case 'reasoning': {
              // Include reasoning as text for context
              textParts.push({
                type: 'output_text',
                text: `<reasoning>\n${part.text}\n</reasoning>`,
              });
              break;
            }
            case 'tool-call': {
              const args =
                typeof part.input === 'string'
                  ? part.input
                  : JSON.stringify(part.input);
              functionCalls.push({
                type: 'function_call',
                id: part.toolCallId,
                call_id: part.toolCallId,
                name: part.toolName,
                arguments: args,
              });
              break;
            }
            case 'file':
            case 'tool-result':
              // Skip file/tool-result parts in assistant messages
              break;
          }
        }

        // Add assistant message with text content
        if (textParts.length > 0) {
          items.push({ type: 'message', role: 'assistant', content: textParts });
        }

        // Add function calls as separate items
        for (const fc of functionCalls) {
          items.push(fc);
        }
        break;
      }

      case 'tool': {
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            let outputText: string;
            switch (part.output.type) {
              case 'text':
              case 'error-text':
                outputText = part.output.value;
                break;
              case 'json':
              case 'error-json':
                outputText = JSON.stringify(part.output.value);
                break;
              case 'execution-denied':
                outputText = part.output.reason ?? 'Tool execution denied';
                break;
              case 'content': {
                // Flatten content array to text
                const textPieces: string[] = [];
                for (const item of part.output.value) {
                  if (item.type === 'text') {
                    textPieces.push(item.text);
                  }
                }
                outputText = textPieces.join('\n');
                break;
              }
              default:
                outputText = '';
            }

            items.push({
              type: 'function_call_output',
              call_id: part.toolCallId,
              output: outputText,
            });
          }
          // Skip tool-approval-response parts
        }
        break;
      }
    }
  }

  // Join all system messages into a single instructions string.
  // The Codex API requires this field — use a sensible default if none provided.
  const instructions =
    systemParts.length > 0
      ? systemParts.join('\n\n')
      : 'You are a helpful assistant.';

  return { instructions, input: items };
}

/**
 * Convert AI SDK tool definitions to Codex API tool format.
 */
export function convertTools(
  tools: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool>,
): CodexTool[] {
  return tools
    .filter(
      (tool): tool is LanguageModelV3FunctionTool => tool.type === 'function',
    )
    .map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      strict: false,
      parameters: tool.inputSchema,
    }));
}

/**
 * Convert AI SDK tool choice to Codex API tool_choice format.
 */
export function convertToolChoice(
  toolChoice: LanguageModelV3ToolChoice | undefined,
): string | { type: 'function'; function: { name: string } } | undefined {
  if (!toolChoice) return undefined;

  switch (toolChoice.type) {
    case 'auto':
      return 'auto';
    case 'none':
      return 'none';
    case 'required':
      return 'required';
    case 'tool':
      return { type: 'function', function: { name: toolChoice.toolName } };
  }
}
