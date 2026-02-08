/**
 * Known Codex model IDs. Accepts any string for forward compatibility.
 */
export type CodexModelId =
  | 'gpt-5'
  | 'gpt-5.1-codex'
  | 'gpt-5.1-codex-max'
  | 'gpt-5.1-codex-mini'
  | 'gpt-5.2'
  | 'gpt-5.2-codex'
  | 'gpt-5.3-codex'
  | (string & {});

/**
 * Per-model settings passed when constructing a language model instance.
 */
export interface CodexSettings {
  /**
   * Reasoning effort level. Controls how much "thinking" the model does.
   */
  reasoning?: {
    effort?: 'low' | 'medium' | 'high';
    summary?: 'auto' | 'concise' | 'detailed';
  };

  /**
   * Whether to store the response on the server.
   * Defaults to false.
   */
  store?: boolean;

  /**
   * Random seed for deterministic generation.
   */
  seed?: number;
}
