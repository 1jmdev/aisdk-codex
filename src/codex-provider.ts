import type { LanguageModelV3, ProviderV3 } from '@ai-sdk/provider';
import { NoSuchModelError } from '@ai-sdk/provider';
import { loadApiKey, withoutTrailingSlash } from '@ai-sdk/provider-utils';
import { CodexLanguageModel } from './codex-language-model.js';
import type { CodexModelId, CodexSettings } from './codex-settings.js';
import { CodexAuth } from './codex-auth.js';
import type { FetchFunction } from './fetch-function.js';

// ── Provider interface ─────────────────────────────────────────────────

export interface CodexProvider extends ProviderV3 {
  /**
   * Shorthand: `codex('gpt-5.3-codex')` is equivalent to `codex.languageModel('gpt-5.3-codex')`.
   */
  (modelId: CodexModelId, settings?: CodexSettings): LanguageModelV3;

  languageModel(
    modelId: CodexModelId,
    settings?: CodexSettings,
  ): LanguageModelV3;
}

// ── Provider settings ──────────────────────────────────────────────────

export interface CodexProviderSettings {
  /**
   * Base URL for the Codex API.
   * @default 'https://chatgpt.com/backend-api'
   */
  baseURL?: string;

  /**
   * Custom headers to include in requests.
   */
  headers?: Record<string, string>;

  /**
   * Custom fetch implementation.
   */
  fetch?: FetchFunction;

  /**
   * Use an API key from `OPENAI_API_KEY` environment variable
   * instead of ~/.codex/auth.json.
   */
  useApiKey?: boolean;

  /**
   * Explicit API key (overrides both auth.json and env variable).
   */
  apiKey?: string;

  /**
   * Refresh token for ChatGPT/Codex auth flow.
   * When provided, access tokens are exchanged and refreshed automatically.
   */
  refreshToken?: string;
}

// ── Factory ────────────────────────────────────────────────────────────

export function createCodex(
  options: CodexProviderSettings = {},
): CodexProvider {
  const baseURL =
    withoutTrailingSlash(options.baseURL) ?? 'https://chatgpt.com/backend-api';
  let refreshSession:
    | {
        accessToken: string;
        refreshToken: string;
        accountId: string;
        expiresAt: number | null;
      }
    | null = null;
  let refreshSessionPromise: Promise<void> | null = null;

  const ensureRefreshSession = async (): Promise<void> => {
    const now = Date.now();
    if (
      refreshSession &&
      (refreshSession.expiresAt == null || refreshSession.expiresAt - now > 60 * 60 * 1000)
    ) {
      return;
    }

    if (refreshSessionPromise) {
      await refreshSessionPromise;
      return;
    }

    refreshSessionPromise = (async () => {
      const sourceRefreshToken = refreshSession?.refreshToken ?? options.refreshToken;
      if (!sourceRefreshToken) {
        throw new Error('No refresh token was provided.');
      }

      const exchanged = await CodexAuth.exchangeRefreshToken(
        sourceRefreshToken,
        options.fetch,
      );

      refreshSession = {
        accessToken: exchanged.accessToken,
        refreshToken: exchanged.refreshToken,
        accountId: exchanged.accountId,
        expiresAt:
          exchanged.tokenInfo.exp != null
            ? exchanged.tokenInfo.exp * 1000
            : null,
      };
    })();

    try {
      await refreshSessionPromise;
    } finally {
      refreshSessionPromise = null;
    }
  };

  const getHeaders = async (): Promise<Record<string, string>> => {
    // Explicit API key takes priority
    if (options.apiKey) {
      return {
        ...options.headers,
        Authorization: `Bearer ${options.apiKey}`,
        'Content-Type': 'application/json',
      };
    }

    // Exchange and refresh using refresh token
    if (options.refreshToken) {
      await ensureRefreshSession();
      return {
        Authorization: `Bearer ${refreshSession!.accessToken}`,
        'chatgpt-account-id': refreshSession!.accountId,
        'Content-Type': 'application/json',
        originator: 'codex',
        accept: 'text/event-stream',
        ...options.headers,
      };
    }

    // Load from environment variable
    if (options.useApiKey) {
      const apiKey = loadApiKey({
        apiKey: options.apiKey,
        environmentVariableName: 'OPENAI_API_KEY',
        description: 'OpenAI',
      });
      return {
        ...options.headers,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      };
    }

    // Default: use ~/.codex/auth.json
    try {
      const authHeaders = await CodexAuth.getHeaders();
      return {
        ...authHeaders,
        originator: 'codex',
        accept: 'text/event-stream',
        ...options.headers,
      };
    } catch (error) {
      throw new Error(
        `Failed to load authentication from ~/.codex/auth.json. ` +
          `Please run 'codex login' first or provide apiKey/useApiKey/refreshToken. ` +
          `Error: ${error}`,
      );
    }
  };

  const createLanguageModel = (
    modelId: CodexModelId,
    settings: CodexSettings = {},
  ) =>
    new CodexLanguageModel(modelId, settings, {
      provider: 'codex',
      baseURL,
      headers: getHeaders,
      fetch: options.fetch,
    });

  const provider = function (
    modelId: CodexModelId,
    settings?: CodexSettings,
  ) {
    if (new.target) {
      throw new Error(
        'The Codex model function cannot be called with the new keyword.',
      );
    }
    return createLanguageModel(modelId, settings);
  };

  const codexProvider: CodexProvider = Object.assign(provider, {
    specificationVersion: 'v3' as const,
    languageModel: createLanguageModel,
    embeddingModel: (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'embeddingModel',
      });
    },
    imageModel: (modelId: string): never => {
      throw new NoSuchModelError({
        modelId,
        modelType: 'imageModel',
      });
    },
  });

  return codexProvider;
}

/**
 * Default Codex provider instance.
 * Uses authentication from ~/.codex/auth.json.
 */
export const codex = createCodex();
