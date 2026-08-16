import type { Context, Next } from 'koa';
import { logger } from './logger';

type SummaryValue = Record<string, unknown>;
type ControllerHandler = (ctx: Context, next: Next) => Promise<unknown> | unknown;
type WrappedControllerHandler = (ctx: Context, next?: Next) => Promise<void>;

const MAX_ARRAY_ITEMS = 3;
const MAX_OBJECT_KEYS = 6;
const MAX_STRING_LENGTH = 80;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

const trimString = (value: string) =>
  value.length > MAX_STRING_LENGTH
    ? {
        length: value.length,
        preview: `${value.slice(0, MAX_STRING_LENGTH)}...`,
      }
    : value;

export const summarizeValue = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return trimString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Buffer.isBuffer(value)) {
    return {
      type: 'buffer',
      length: value.length,
    };
  }

  if (Array.isArray(value)) {
    if (depth >= 1) {
      return {
        type: 'array',
        length: value.length,
      };
    }

    return {
      type: 'array',
      length: value.length,
      items: value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth + 1)),
    };
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (depth >= 1) {
      return {
        type: 'object',
        keys: keys.slice(0, MAX_OBJECT_KEYS),
      };
    }

    const entries = keys
      .slice(0, MAX_OBJECT_KEYS)
      .map((key) => [key, summarizeValue(value[key], depth + 1)]);
    return Object.fromEntries(entries);
  }

  return String(value);
};

const compactRecord = (record: Record<string, unknown>): SummaryValue =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null),
  );

export const summarizeRequestContext = (ctx: Context): SummaryValue => {
  const requestBody = (ctx.request as { body?: unknown }).body;

  return compactRecord({
    query: Object.keys(ctx.query || {}).length ? summarizeValue(ctx.query) : undefined,
    params: Object.keys((ctx.params as Record<string, unknown>) || {}).length
      ? summarizeValue(ctx.params)
      : undefined,
    body: requestBody !== undefined ? summarizeValue(requestBody) : undefined,
  });
};

export const summarizeResponseBody = (body: unknown): unknown => summarizeValue(body);

const createControllerMeta = (controller: string, ctx: Context): SummaryValue => ({
  scope: 'controller',
  controller,
  route: ctx.path,
  method: ctx.method,
  params: summarizeRequestContext(ctx),
});

export const withControllerLogging =
  (controller: string, handler: ControllerHandler): WrappedControllerHandler =>
  async (ctx: Context, next?: Next) => {
    const startedAt = Date.now();
    const baseMeta = createControllerMeta(controller, ctx);

    logger.info('request.received', baseMeta);

    try {
      const nextHandler: Next = next || (async () => Promise.resolve());
      await handler(ctx, nextHandler);

      const status = ctx.status || 200;
      const meta = {
        ...baseMeta,
        status,
        durationMs: Date.now() - startedAt,
        result: summarizeResponseBody(ctx.body),
      };

      if (status >= 500) {
        logger.error('request.failed', meta);
        return;
      }

      if (status >= 400) {
        logger.warn('request.validation_failed', meta);
        return;
      }

      logger.info('request.succeeded', meta);
    } catch (error) {
      const normalizedError =
        error instanceof Error
          ? error
          : new Error(typeof error === 'string' ? error : 'Unknown error');

      logger.error('request.failed', {
        ...baseMeta,
        status: 500,
        durationMs: Date.now() - startedAt,
        error: summarizeValue(normalizedError),
      });

      ctx.status = 500;
      if (ctx.body === undefined) {
        ctx.body = {
          error: normalizedError.message,
        };
      }
    }
  };

const createServiceMeta = (service: string, upstream: string, params?: unknown): SummaryValue =>
  compactRecord({
    scope: 'service',
    service,
    upstream,
    params: params === undefined ? undefined : summarizeValue(params),
  });

export const logServiceRequest = (
  service: string,
  upstream: string,
  params?: unknown,
  extras: Record<string, unknown> = {},
): void => {
  logger.info('service.requesting', {
    ...createServiceMeta(service, upstream, params),
    ...compactRecord(extras),
  });
};

export const logServiceSuccess = (
  service: string,
  upstream: string,
  result?: unknown,
  extras: Record<string, unknown> = {},
): void => {
  logger.info('service.succeeded', {
    ...createServiceMeta(service, upstream),
    result: summarizeValue(result),
    ...compactRecord(extras),
  });
};

export const logServiceFailure = (
  service: string,
  upstream: string,
  error: unknown,
  params?: unknown,
  extras: Record<string, unknown> = {},
): void => {
  logger.error('service.failed', {
    ...createServiceMeta(service, upstream, params),
    error: summarizeValue(error),
    ...compactRecord(extras),
  });
};

export const logServiceBranch = (
  service: string,
  upstream: string,
  branch: string,
  details: Record<string, unknown> = {},
): void => {
  logger.debug('service.branch_selected', {
    ...createServiceMeta(service, upstream),
    branch,
    ...compactRecord(details),
  });
};
