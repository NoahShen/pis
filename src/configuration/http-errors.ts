import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";

import { classifySqliteError } from "../database/error-classification.js";
import { ConfigurationInputError } from "./contracts.js";

export class InvalidRequestError extends Error {
  constructor() {
    super("Invalid request");
    this.name = "InvalidRequestError";
  }
}

export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super("Unsupported media type");
    this.name = "UnsupportedMediaTypeError";
  }
}

type ErrorBody = {
  error:
    | "invalid_request"
    | "not_found"
    | "payload_too_large"
    | "unsupported_media_type"
    | "storage_unavailable"
    | "internal_error";
};

function errorCode(error: unknown): string | undefined {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  ) {
    return undefined;
  }

  try {
    const code = (error as Pick<FastifyError, "code">).code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

function sendError(
  reply: FastifyReply,
  statusCode: number,
  body: ErrorBody,
): void {
  void reply.code(statusCode).send(body);
}

export function registerScopedErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (
      error instanceof ConfigurationInputError ||
      error instanceof InvalidRequestError
    ) {
      sendError(reply, 400, { error: "invalid_request" });
      return;
    }

    if (error instanceof UnsupportedMediaTypeError) {
      sendError(reply, 415, { error: "unsupported_media_type" });
      return;
    }

    const code = errorCode(error);
    if (
      code === "FST_ERR_CTP_EMPTY_JSON_BODY" ||
      code === "FST_ERR_CTP_INVALID_JSON_BODY"
    ) {
      sendError(reply, 400, { error: "invalid_request" });
      return;
    }

    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      sendError(reply, 413, { error: "payload_too_large" });
      return;
    }

    if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
      sendError(reply, 415, { error: "unsupported_media_type" });
      return;
    }

    if (classifySqliteError(error) === "busy_locked") {
      sendError(reply, 503, { error: "storage_unavailable" });
      return;
    }

    sendError(reply, 500, { error: "internal_error" });
  });
}

export function requireNoQuery(request: FastifyRequest): void {
  if (request.raw.url?.includes("?") === true) {
    throw new InvalidRequestError();
  }
}

export function isJsonMediaType(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}
