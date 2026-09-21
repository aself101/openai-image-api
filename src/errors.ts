/**
 * The error type shared by every client in this package.
 */

/**
 * Error thrown for every failed API interaction.
 *
 * `message` is the package's stable, human-readable vocabulary (kept from
 * 2.x). The fields carry what a consumer needs to branch on without parsing
 * the message: the HTTP `status`, and the API body's `code`/`type` when
 * present — the guide names `error.code` as the stable discriminator and
 * `image_generation_user_error` as the type for prompt/input problems that
 * must not be retried unchanged. `cause` is the original axios error.
 */
export class OpenAIImageAPIError extends Error {
  /** HTTP status, when the API answered at all */
  readonly status?: number;
  /** `error.code` from the API body, when present */
  readonly code?: string;
  /**
   * `error.type` from the API body when the API answered; otherwise one of the
   * package's own: `validation_error` (rejected by the client-side constraint
   * check), `input_error` (an input file failed the pre-upload check),
   * `configuration_error` (no API key), `stream_error` (terminal error event
   * or early stream end). `status` is undefined for all four.
   */
  readonly type?: string;
  /**
   * `error.message` from the API body, when present — deliberately NOT subject
   * to the `NODE_ENV=production` sanitization applied to `message`. That
   * sanitization protects a server's end users from internal detail; the key
   * holder reading this field is the party the API's message is addressed to,
   * and OpenAI's error text names the rejected parameter or policy, not
   * internal paths. Do not forward it to end users unreviewed.
   */
  readonly apiMessage?: string;

  constructor(
    message: string,
    details: { status?: number; code?: string; type?: string; apiMessage?: string; cause?: unknown } = {}
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'OpenAIImageAPIError';
    this.status = details.status;
    this.code = details.code;
    this.type = details.type;
    this.apiMessage = details.apiMessage;
  }
}

/** The `error` object the API returns in a non-2xx JSON body */
export interface ApiErrorBody {
  message?: string;
  code?: string;
  type?: string;
}

/** Read the API error body off an axios rejection, if it carries one */
export function apiErrorBody(error: unknown): ApiErrorBody | undefined {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (typeof data !== 'object' || data === null) return undefined;
  const body = (data as { error?: unknown }).error;
  if (typeof body !== 'object' || body === null) return undefined;
  const { message, code, type } = body as Record<string, unknown>;
  return {
    message: typeof message === 'string' ? message : undefined,
    code: typeof code === 'string' ? code : undefined,
    type: typeof type === 'string' ? type : undefined,
  };
}
