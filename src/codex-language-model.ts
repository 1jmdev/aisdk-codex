import type {
  JSONObject,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3Usage,
  SharedV3Warning,
} from '@ai-sdk/provider';
import { EventSourceParserStream } from 'eventsource-parser/stream';
import type { CodexModelId, CodexSettings } from './codex-settings.js';
import {
  convertToCodexInput,
  convertTools,
  convertToolChoice,
} from './convert-to-codex-messages.js';
import type { FetchFunction } from './fetch-function.js';
import {
  createTextDecoderStream,
  createTransformStream,
  getFetchFunction,
  randomUUID,
} from './runtime-globals.js';

// ── Config ─────────────────────────────────────────────────────────────

export interface CodexModelConfig {
  provider: string;
  baseURL: string;
  headers: () => Promise<Record<string, string>>;
  fetch?: FetchFunction;
}

interface StreamReaderLike<T = unknown> {
  read(): Promise<{ value?: T; done: boolean }>;
}

interface ReadableStreamLike<T = unknown> {
  pipeThrough<TNext>(transform: unknown): ReadableStreamLike<TNext>;
  getReader(): StreamReaderLike<T>;
}

interface EventSourceChunk {
  data?: string;
}

// ── Language model ─────────────────────────────────────────────────────

export class CodexLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider: string;
  readonly modelId: string;

  private readonly config: CodexModelConfig;
  private readonly settings: CodexSettings;

  constructor(
    modelId: CodexModelId,
    settings: CodexSettings,
    config: CodexModelConfig,
  ) {
    this.modelId = modelId;
    this.settings = settings;
    this.config = config;
    this.provider = config.provider;
  }

  get supportedUrls(): Record<string, RegExp[]> {
    return {
      'image/*': [
        /^https:\/\/cdn\.openai\.com\/.*/,
        /^https:\/\/.+\.cloudfront\.net\/.*/,
        /^https:\/\/.+\.s3\.amazonaws\.com\/.*/,
      ],
    };
  }

  // ── Build request body ─────────────────────────────────────────────

  private buildRequestBody(options: LanguageModelV3CallOptions) {
    const warnings: SharedV3Warning[] = [];

    const { instructions, input } = convertToCodexInput(options.prompt);

    // Unsupported settings warnings
    if (options.topK != null) {
      warnings.push({ type: 'unsupported', feature: 'topK' });
    }
    if (options.responseFormat?.type === 'json') {
      warnings.push({
        type: 'unsupported',
        feature: 'responseFormat',
        details: 'JSON response format is not supported by the Codex API',
      });
    }

    // Tools
    const tools =
      options.tools && options.tools.length > 0
        ? convertTools(options.tools)
        : undefined;

    const toolChoice = tools
      ? convertToolChoice(options.toolChoice)
      : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      model: this.modelId,
      instructions,
      input,
      store: this.settings.store ?? false,
      stream: false,
    };

    // Optional parameters — only include when set
    if (options.maxOutputTokens != null) {
      body['max_output_tokens'] = options.maxOutputTokens;
    }
    if (options.temperature != null) {
      body['temperature'] = options.temperature;
    }
    if (options.topP != null) {
      body['top_p'] = options.topP;
    }
    if (options.frequencyPenalty != null) {
      body['frequency_penalty'] = options.frequencyPenalty;
    }
    if (options.presencePenalty != null) {
      body['presence_penalty'] = options.presencePenalty;
    }
    if (options.stopSequences != null) {
      body['stop'] = options.stopSequences;
    }
    if (options.seed != null || this.settings.seed != null) {
      body['seed'] = options.seed ?? this.settings.seed;
    }
    if (tools) {
      body['tools'] = tools;
    }
    if (toolChoice != null) {
      body['tool_choice'] = toolChoice;
    }
    if (this.settings.reasoning) {
      body['reasoning'] = {
        effort: this.settings.reasoning.effort ?? 'medium',
        summary: this.settings.reasoning.summary ?? 'auto',
      };
    }

    return { body, warnings };
  }

  // ── doGenerate (non-streaming, implemented via buffered stream) ─────

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const { body, warnings } = this.buildRequestBody(options);
    body['stream'] = true;

    const headers = await this.config.headers();
    const fetchFn = getFetchFunction(this.config.fetch);

    const endpoint = `${this.config.baseURL}/codex/responses`;

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Codex API error ${response.status}: ${tryParseErrorMessage(errorBody) ?? errorBody}`,
      );
    }

    // Buffer the SSE stream into a single result
    let accumulatedText = '';
    const toolCallInfo = new Map<string, { name: string; id: string }>();
    const functionCallArgs = new Map<string, string>();
    const toolCalls: LanguageModelV3Content[] = [];
    let finishReason = mapFinishReason('stop');
    let usage = emptyUsage();
    let responseId: string | undefined;
    let responseModelId: string | undefined;

    const reader = (response.body as ReadableStreamLike)
      .pipeThrough(createTextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .getReader() as StreamReaderLike<EventSourceChunk>;

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value?.data || value.data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(value.data) as Record<string, unknown>;
        const type = parsed['type'] as string | undefined;

        if (type === 'response.output_text.delta') {
          accumulatedText += (parsed['delta'] as string) ?? '';
        } else if (type === 'response.output_item.added') {
          const item = parsed['item'] as Record<string, unknown> | undefined;
          if (item?.['type'] === 'function_call' && item['name']) {
            const itemId =
              (item['id'] as string) ?? (parsed['item_id'] as string);
            if (itemId) {
              toolCallInfo.set(itemId, {
                name: item['name'] as string,
                id: itemId,
              });
            }
          }
        } else if (type === 'response.function_call_arguments.delta') {
          const itemId = parsed['item_id'] as string | undefined;
          if (itemId && parsed['delta']) {
            const current = functionCallArgs.get(itemId) ?? '';
            functionCallArgs.set(itemId, current + (parsed['delta'] as string));
          }
        } else if (type === 'response.function_call_arguments.done') {
          const itemId = parsed['item_id'] as string | undefined;
          const toolInfo = itemId ? toolCallInfo.get(itemId) : undefined;
          const toolName = toolInfo?.name ?? (parsed['name'] as string) ?? 'unknown';

          let args = parsed['arguments'] as string | undefined;
          if (itemId && functionCallArgs.has(itemId)) {
            args = functionCallArgs.get(itemId)!;
            functionCallArgs.delete(itemId);
          }

          const argsString =
            typeof args === 'string' ? args : JSON.stringify(args);

          toolCalls.push({
            type: 'tool-call',
            toolCallId:
              (parsed['call_id'] as string) ?? itemId ?? randomUUID(),
            toolName,
            input: argsString,
          });
        } else if (type === 'response.completed') {
          const resp = parsed['response'] as Record<string, unknown> | undefined;
          finishReason = mapFinishReason(
            (resp?.['status'] as string) ?? 'stop',
          );
          usage = extractUsage(resp);
          responseId = resp?.['id'] as string | undefined;
          responseModelId = resp?.['model'] as string | undefined;
        }
      } catch {
        // Ignore malformed chunks
      }
    }

    const content: LanguageModelV3Content[] = [];
    if (accumulatedText) {
      content.push({ type: 'text', text: accumulatedText });
    }
    content.push(...toolCalls);

    return {
      content,
      finishReason,
      usage,
      warnings,
      request: { body },
      response: {
        id: responseId,
        modelId: responseModelId ?? this.modelId,
        timestamp: new Date(),
      },
    };
  }

  // ── doStream ───────────────────────────────────────────────────────

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const { body, warnings } = this.buildRequestBody(options);
    body['stream'] = true;

    const headers = await this.config.headers();
    const fetchFn = getFetchFunction(this.config.fetch);

    const endpoint = `${this.config.baseURL}/codex/responses`;

    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.abortSignal,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Codex API error ${response.status}: ${tryParseErrorMessage(errorBody) ?? errorBody}`,
      );
    }

    // State for accumulating tool call info during streaming
    const toolCallInfo = new Map<string, { name: string; id: string }>();
    const functionCallArgs = new Map<string, string>();
    let isFirstChunk = true;

    // ID counters for text/reasoning segments
    let currentTextId: string | undefined;
    let currentReasoningId: string | undefined;

    const stream = (response.body as ReadableStreamLike)
      .pipeThrough(createTextDecoderStream())
      .pipeThrough(new EventSourceParserStream())
      .pipeThrough(
        createTransformStream<
          { data?: string; event?: string; id?: string },
          LanguageModelV3StreamPart
        >({
          transform(chunk, controller) {
            if (!chunk.data || chunk.data === '[DONE]') return;

            try {
              const parsed = JSON.parse(chunk.data) as Record<string, unknown>;
              const type = parsed['type'] as string | undefined;

              // Emit stream-start on first chunk
              if (isFirstChunk) {
                controller.enqueue({ type: 'stream-start', warnings });
                isFirstChunk = false;
              }

              // Include raw chunks if requested
              if (options.includeRawChunks) {
                controller.enqueue({ type: 'raw', rawValue: parsed });
              }

              if (type === 'response.output_text.delta') {
                if (!currentTextId) {
                  currentTextId = randomUUID();
                  controller.enqueue({
                    type: 'text-start',
                    id: currentTextId,
                  });
                }
                controller.enqueue({
                  type: 'text-delta',
                  id: currentTextId,
                  delta: (parsed['delta'] as string) ?? '',
                });
              } else if (type === 'response.output_text.done') {
                if (currentTextId) {
                  controller.enqueue({
                    type: 'text-end',
                    id: currentTextId,
                  });
                  currentTextId = undefined;
                }
              } else if (type === 'response.reasoning_summary_text.delta') {
                if (!currentReasoningId) {
                  currentReasoningId = randomUUID();
                  controller.enqueue({
                    type: 'reasoning-start',
                    id: currentReasoningId,
                  });
                }
                controller.enqueue({
                  type: 'reasoning-delta',
                  id: currentReasoningId,
                  delta: (parsed['delta'] as string) ?? '',
                });
              } else if (
                type === 'response.reasoning_summary_text.done'
              ) {
                if (currentReasoningId) {
                  controller.enqueue({
                    type: 'reasoning-end',
                    id: currentReasoningId,
                  });
                  currentReasoningId = undefined;
                }
              } else if (type === 'response.output_item.added') {
                const item = parsed['item'] as
                  | Record<string, unknown>
                  | undefined;
                if (
                  item?.['type'] === 'function_call' &&
                  item['name']
                ) {
                  const itemId =
                    (item['id'] as string) ??
                    (parsed['item_id'] as string);
                  if (itemId) {
                    toolCallInfo.set(itemId, {
                      name: item['name'] as string,
                      id: itemId,
                    });

                    // Emit tool-input-start
                    controller.enqueue({
                      type: 'tool-input-start',
                      id: itemId,
                      toolName: item['name'] as string,
                    });
                  }
                }
              } else if (
                type === 'response.function_call_arguments.delta'
              ) {
                const itemId = parsed['item_id'] as string | undefined;
                if (itemId && parsed['delta']) {
                  const delta = parsed['delta'] as string;
                  const current = functionCallArgs.get(itemId) ?? '';
                  functionCallArgs.set(itemId, current + delta);

                  controller.enqueue({
                    type: 'tool-input-delta',
                    id: itemId,
                    delta,
                  });
                }
              } else if (
                type === 'response.function_call_arguments.done'
              ) {
                const itemId = parsed['item_id'] as string | undefined;
                const toolInfo = itemId
                  ? toolCallInfo.get(itemId)
                  : undefined;
                const toolName =
                  toolInfo?.name ??
                  (parsed['name'] as string) ??
                  'unknown';

                let args = parsed['arguments'] as string | undefined;
                if (itemId && functionCallArgs.has(itemId)) {
                  args = functionCallArgs.get(itemId)!;
                  functionCallArgs.delete(itemId);
                }

                const argsString =
                  typeof args === 'string' ? args : JSON.stringify(args);

                const toolCallId =
                  (parsed['call_id'] as string) ??
                  itemId ??
                  randomUUID();

                // Emit tool-input-end first
                if (itemId) {
                  controller.enqueue({
                    type: 'tool-input-end',
                    id: itemId,
                  });
                }

                // Then emit the complete tool-call
                controller.enqueue({
                  type: 'tool-call',
                  toolCallId,
                  toolName,
                  input: argsString,
                });
              } else if (type === 'response.completed') {
                // Close any open text/reasoning segments
                if (currentTextId) {
                  controller.enqueue({
                    type: 'text-end',
                    id: currentTextId,
                  });
                  currentTextId = undefined;
                }
                if (currentReasoningId) {
                  controller.enqueue({
                    type: 'reasoning-end',
                    id: currentReasoningId,
                  });
                  currentReasoningId = undefined;
                }

                const resp = parsed['response'] as
                  | Record<string, unknown>
                  | undefined;

                // Emit response metadata
                controller.enqueue({
                  type: 'response-metadata',
                  id: resp?.['id'] as string | undefined,
                  modelId:
                    (resp?.['model'] as string | undefined) ?? undefined,
                  timestamp: new Date(),
                });

                // Emit finish
                controller.enqueue({
                  type: 'finish',
                  finishReason: mapFinishReason(
                    (resp?.['status'] as string) ?? 'stop',
                  ),
                  usage: extractUsage(resp),
                });
              }
            } catch (error) {
              controller.enqueue({ type: 'error', error });
            }
          },
        }),
      ) as unknown as ReadableStream<LanguageModelV3StreamPart>;

    return {
      stream,
      request: { body },
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function mapFinishReason(reason: string): LanguageModelV3FinishReason {
  switch (reason) {
    case 'stop':
    case 'completed':
      return { unified: 'stop', raw: reason };
    case 'length':
    case 'max_output_tokens':
      return { unified: 'length', raw: reason };
    case 'tool_calls':
    case 'incomplete':
      return { unified: 'tool-calls', raw: reason };
    case 'content_filter':
      return { unified: 'content-filter', raw: reason };
    case 'error':
    case 'failed':
      return { unified: 'error', raw: reason };
    default:
      return { unified: 'other', raw: reason };
  }
}

function extractUsage(
  response: Record<string, unknown> | undefined,
): LanguageModelV3Usage {
  const usage = response?.['usage'] as Record<string, unknown> | undefined;
  const outputDetails = usage?.['output_tokens_details'] as
    | Record<string, unknown>
    | undefined;
  const inputDetails = usage?.['input_tokens_details'] as
    | Record<string, unknown>
    | undefined;

  const inputTotal = (usage?.['input_tokens'] as number) ?? undefined;
  const outputTotal = (usage?.['output_tokens'] as number) ?? undefined;
  const cachedTokens = (inputDetails?.['cached_tokens'] as number) ?? undefined;
  const reasoningTokens =
    (outputDetails?.['reasoning_tokens'] as number) ?? undefined;

  return {
    inputTokens: {
      total: inputTotal,
      noCache:
        inputTotal != null && cachedTokens != null
          ? inputTotal - cachedTokens
          : undefined,
      cacheRead: cachedTokens,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: outputTotal,
      text:
        outputTotal != null && reasoningTokens != null
          ? outputTotal - reasoningTokens
          : undefined,
      reasoning: reasoningTokens,
    },
    raw: usage as JSONObject | undefined,
  };
}

function emptyUsage(): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: undefined,
      text: undefined,
      reasoning: undefined,
    },
  };
}

function tryParseErrorMessage(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const error = parsed['error'] as Record<string, unknown> | undefined;
    return (error?.['message'] as string) ?? undefined;
  } catch {
    return undefined;
  }
}
