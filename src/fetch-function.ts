export interface FetchLikeInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: unknown;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  body: unknown;
}

export type FetchFunction = (
  input: string,
  init?: FetchLikeInit,
) => Promise<FetchLikeResponse>;
