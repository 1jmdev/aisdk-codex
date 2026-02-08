import type { FetchFunction } from './fetch-function.js';

interface RuntimeCrypto {
  randomUUID?: () => string;
}

interface RuntimeTransformController<TOutput> {
  enqueue: (value: TOutput) => void;
}

interface RuntimeTransformer<TInput, TOutput> {
  transform?: (
    chunk: TInput,
    controller: RuntimeTransformController<TOutput>,
  ) => void | Promise<void>;
}

interface RuntimeTextDecoderStreamLike {}

interface RuntimeTransformStreamLike<TInput, TOutput> {}

interface RuntimeGlobals {
  fetch?: FetchFunction;
  crypto?: RuntimeCrypto;
  TextDecoderStream?: new () => RuntimeTextDecoderStreamLike;
  TransformStream?: new <TInput = unknown, TOutput = unknown>(
    transformer?: RuntimeTransformer<TInput, TOutput>,
  ) => RuntimeTransformStreamLike<TInput, TOutput>;
}

const runtimeGlobals = globalThis as unknown as RuntimeGlobals;

export function getFetchFunction(customFetch?: FetchFunction): FetchFunction {
  const fetchFn = customFetch ?? runtimeGlobals.fetch;
  if (!fetchFn) {
    throw new Error(
      'No fetch implementation available. Provide one via createCodex({ fetch }).',
    );
  }
  return fetchFn;
}

export function createTextDecoderStream(): RuntimeTextDecoderStreamLike {
  if (!runtimeGlobals.TextDecoderStream) {
    throw new Error(
      'TextDecoderStream is not available in this runtime environment.',
    );
  }
  return new runtimeGlobals.TextDecoderStream();
}

export function createTransformStream<TInput, TOutput>(
  transformer?: RuntimeTransformer<TInput, TOutput>,
): RuntimeTransformStreamLike<TInput, TOutput> {
  if (!runtimeGlobals.TransformStream) {
    throw new Error('TransformStream is not available in this runtime environment.');
  }
  return new runtimeGlobals.TransformStream<TInput, TOutput>(transformer);
}

export function randomUUID(): string {
  if (runtimeGlobals.crypto?.randomUUID) {
    return runtimeGlobals.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
