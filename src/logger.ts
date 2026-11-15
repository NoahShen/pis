import pino from "pino";

import type { LogLevel } from "./config.js";

export interface ReadyLogMetadata {
  host: string;
  port: number;
}

export interface ShutdownLogMetadata {
  outcome: "closed" | "failed" | "timeout";
  forced: boolean;
}

export interface ErrorLogMetadata {
  operation: string;
  reason: string;
}

export interface RequestLogMetadata {
  requestId: string;
  method: string;
  path: string;
  status: number;
  duration: number;
}

export interface Logger {
  ready(metadata: ReadyLogMetadata): void;
  shutdown(metadata: ShutdownLogMetadata): void;
  error(metadata: ErrorLogMetadata): void;
  request(metadata: RequestLogMetadata): void;
  flush(): Promise<void>;
}

export function createLogger(
  level: LogLevel,
  destination?: pino.DestinationStream,
): Logger {
  const instance = pino(
    {
      level,
      base: undefined,
      redact: {
        paths: [
          "authorization",
          "cookie",
          "headers.authorization",
          "headers.cookie",
          "req.headers.authorization",
          "req.headers.cookie",
        ],
        censor: "[Redacted]",
      },
    },
    destination,
  );

  return {
    ready(metadata): void {
      instance.info(
        {
          event: "ready",
          host: metadata.host,
          port: metadata.port,
          pid: process.pid,
        },
        "server ready",
      );
    },
    shutdown(metadata): void {
      instance.info(
        {
          event: "shutdown",
          outcome: metadata.outcome,
          forced: metadata.forced,
        },
        "server shutdown",
      );
    },
    error(metadata): void {
      instance.error(
        {
          event: "error",
          operation: metadata.operation,
          reason: metadata.reason,
        },
        "server error",
      );
    },
    request(metadata): void {
      instance.info(
        {
          requestId: metadata.requestId,
          method: metadata.method,
          path: metadata.path,
          status: metadata.status,
          duration: metadata.duration,
        },
        "request",
      );
    },
    flush(): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          instance.flush((error?: Error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          });
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}
