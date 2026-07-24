import type { z } from "zod";
import { corsHeadersFor } from "./cors.ts";
import { AppError, logSafeError, toAppError, type PublicErrorDetails } from "./errors.ts";

interface RequestContext {
  corsHeaders: Record<string, string>;
  requestId: string;
}

interface EdgeRequestOptions {
  allowedMethods?: readonly string[];
}

interface ErrorBody {
  error: {
    code: string;
    details?: PublicErrorDetails;
    message: string;
    requestId: string;
  };
  ok: false;
}

interface SuccessBody<T> {
  data: T;
  ok: true;
  requestId: string;
}

function jsonResponse(
  body: ErrorBody | SuccessBody<unknown>,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
    status,
  });
}

function requestIdFor(request: Request): string {
  const supplied = request.headers.get("x-request-id");
  if (supplied && /^[A-Za-z0-9._:-]{8,100}$/.test(supplied)) {
    return supplied;
  }

  return crypto.randomUUID();
}

export async function withEdgeRequest<T>(
  request: Request,
  handler: (context: RequestContext) => Promise<T>,
  options: EdgeRequestOptions = {},
): Promise<Response> {
  const requestId = requestIdFor(request);
  let corsHeaders: Record<string, string> = {};

  try {
    corsHeaders = corsHeadersFor(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders,
        status: 204,
      });
    }

    const allowedMethods = options.allowedMethods ?? ["POST"];
    if (!allowedMethods.includes(request.method)) {
      throw new AppError("METHOD_NOT_ALLOWED");
    }

    const data = await handler({ corsHeaders, requestId });
    return jsonResponse(
      {
        data,
        ok: true,
        requestId,
      },
      200,
      corsHeaders,
    );
  } catch (error) {
    const appError = toAppError(error);
    logSafeError(error, requestId);

    return jsonResponse(
      {
        error: {
          code: appError.code,
          ...(appError.details ? { details: appError.details } : {}),
          message: appError.message,
          requestId,
        },
        ok: false,
      },
      appError.status,
      corsHeaders,
    );
  }
}

export async function parseJson<TSchema extends z.ZodType>(
  request: Request,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let input: unknown;

  try {
    input = await request.json();
  } catch (error) {
    throw new AppError("INVALID_JSON", { cause: error });
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError("VALIDATION_FAILED", {
      details: {
        fields: result.error.issues.map((issue) => ({
          message: issue.message,
          path: issue.path.join(".") || "request",
        })),
      },
    });
  }

  return result.data;
}
