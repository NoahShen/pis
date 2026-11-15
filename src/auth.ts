import { timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

const ASCII_WHITESPACE = /[ \t\r\n\f\v]/u;

function asciiUpperCase(value: string): string {
  return value.replace(/[a-z]/g, (character) => character.toUpperCase());
}

function hasSingleAuthorizationHeader(rawHeaders: readonly string[]): boolean {
  let count = 0;

  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (asciiUpperCase(rawHeaders[index] ?? "") === "AUTHORIZATION") {
      count += 1;
    }
  }

  return count === 1;
}

export function isBearerAuthorized(
  value: string | undefined,
  expectedToken: string,
): boolean {
  if (value === undefined) {
    return false;
  }

  const parts = value.split(" ");
  if (parts.length !== 2) {
    return false;
  }

  const [scheme, token] = parts;
  if (
    scheme === undefined ||
    token === undefined ||
    asciiUpperCase(scheme) !== "BEARER" ||
    token.length === 0 ||
    ASCII_WHITESPACE.test(token)
  ) {
    return false;
  }

  const actualBytes = Buffer.from(token, "utf8");
  const expectedBytes = Buffer.from(expectedToken, "utf8");

  if (actualBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(actualBytes, expectedBytes);
}

export function createBearerPreHandler(
  expectedToken: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request, reply): Promise<void> => {
    const rawHeaders = request.raw.rawHeaders;
    const authorization = request.headers.authorization;
    const hasOneHeader = hasSingleAuthorizationHeader(rawHeaders);

    if (!hasOneHeader || !isBearerAuthorized(authorization, expectedToken)) {
      void reply
        .code(401)
        .header("www-authenticate", "Bearer")
        .send({ error: "unauthorized" });
    }
  };
}
