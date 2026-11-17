import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { connect as tcpConnect, type Socket } from "node:net";

import { Agent, Dispatcher } from "undici";

import {
  createPinnedLookup,
  type DnsAddress,
} from "../../src/adapters/http/address-policy.js";
import type { RestrictedConnector } from "../../src/adapters/http/restricted-client.js";

export interface FixtureRequest {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly connectionId: number;
}

export type FixtureHandler = (request: FixtureRequest) => void | Promise<void>;

export interface FixtureTeardownReport {
  readonly residualSockets: number;
  readonly residualDispatchers: number;
  readonly dispatcherCloseStarted: number;
  readonly dispatcherCloseFailed: number;
  readonly dispatchersClosed: number;
  readonly dispatcherDestroyStarted: number;
  readonly dispatcherDestroyFailed: number;
  readonly dispatchersDestroyed: number;
  readonly serverCloseStarted: number;
  readonly serverClosed: number;
  readonly serverCloseFailed: number;
}

export interface ProductionConnectorCall {
  readonly hostname: string;
  readonly host: string | undefined;
  readonly protocol: string;
  readonly port: string;
  readonly servername: string | undefined;
}

const SERVER_CLOSE_TIMEOUT_MS = 1_000;

class CountingDispatcher extends Dispatcher {
  constructor(
    private readonly agent: Agent,
    private readonly onClose: () => void,
    private readonly onCloseFailure: () => void,
    private readonly onDestroy: () => void,
    private readonly onDestroyFailure: () => void,
  ) {
    super();
  }

  override dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    return this.agent.dispatch(options, handler);
  }

  override async close(): Promise<void> {
    try {
      await this.agent.close();
      this.onClose();
    } catch (error) {
      this.onCloseFailure();
      throw error;
    }
  }

  override async destroy(): Promise<void> {
    try {
      await this.agent.destroy();
      this.onDestroy();
    } catch (error) {
      this.onDestroyFailure();
      throw error;
    }
  }
}

export class HttpFixture {
  readonly host = "fixture.example.test";
  readonly origin = `http://${this.host}`;
  readonly sockets = new Set<Socket>();
  readonly requests: string[] = [];
  readonly hosts: string[] = [];
  readonly connectServernames: string[] = [];
  readonly productionConnectorCalls: ProductionConnectorCall[] = [];
  readonly dispatcherAddresses: DnsAddress[] = [];
  readonly pinnedLookupResults: DnsAddress[] = [];
  readonly requestConnectionIds: number[] = [];
  readonly dispatchers = new Set<Dispatcher>();
  readonly dispatchersCreatedInOrder: Dispatcher[] = [];
  readonly closeCompletedDispatchers = new Set<Dispatcher>();
  readonly destroyCompletedDispatchers = new Set<Dispatcher>();
  dispatchersCreated = 0;
  dispatcherCloseStarted = 0;
  dispatcherCloseFailed = 0;
  dispatchersClosed = 0;
  dispatcherDestroyStarted = 0;
  dispatcherDestroyFailed = 0;
  dispatchersDestroyed = 0;
  serverCloseStarted = 0;
  serverClosed = 0;
  serverCloseFailed = 0;
  private nextConnectionId = 1;
  private readonly connectionIds = new WeakMap<Socket, number>();
  private server = createServer((request, response) => {
    this.requests.push(request.url ?? "");
    this.hosts.push(request.headers.host ?? "");
    const socket = request.socket as Socket;
    const connectionId = this.connectionIds.get(socket) ?? 0;
    this.requestConnectionIds.push(connectionId);
    const handler = this.routes.get(request.url ?? "/");
    if (handler === undefined) {
      response.statusCode = 404;
      response.end("not found");
      return;
    }
    Promise.resolve(handler({ request, response, connectionId })).catch(() => {
      response.destroy();
    });
  });
  private readonly routes = new Map<string, FixtureHandler>();
  private port = 0;
  private started = false;

  constructor() {
    this.server.on("connection", (socket) => {
      this.sockets.add(socket);
      this.connectionIds.set(socket, this.nextConnectionId);
      this.nextConnectionId += 1;
      socket.once("close", () => this.sockets.delete(socket));
    });
  }

  route(path: string, handler: FixtureHandler): this {
    this.routes.set(path, handler);
    return this;
  }

  async start(): Promise<this> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.server.once("error", onError);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.removeListener("error", onError);
        resolve();
      });
    });
    const address = this.server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Fixture failed to bind");
    }
    this.port = address.port;
    this.started = true;
    return this;
  }

  resolver = async (): Promise<readonly DnsAddress[]> => [
    { address: "93.184.216.34", family: 4 },
  ];

  connector: RestrictedConnector = (options, callback) => {
    this.productionConnectorCalls.push({
      hostname: options.hostname,
      host: options.host,
      protocol: options.protocol,
      port: options.port,
      servername: options.servername,
    });
    if (typeof options.lookup !== "function") {
      callback(
        new Error("The production dispatcher lost its pinned lookup"),
        null,
      );
      return;
    }
    options.lookup(options.hostname, { all: true }, (error, resolved) => {
      if (error !== null || !Array.isArray(resolved)) {
        callback(error ?? new Error("Production pinned lookup failed"), null);
        return;
      }
      this.pinnedLookupResults.push(...resolved);
      if (resolved.length !== 1) {
        callback(
          new Error("Production connector did not receive one pinned address"),
          null,
        );
        return;
      }
      const socket = tcpConnect({ host: "127.0.0.1", port: this.port });
      socket.once("connect", () => callback(null, socket));
      socket.once("error", (connectError) => callback(connectError, null));
    });
  };

  dispatcherFactory = (address: DnsAddress): Dispatcher => {
    this.dispatchersCreated += 1;
    this.dispatcherAddresses.push(address);
    const pinnedLookup = createPinnedLookup(address);
    const agent = new Agent({
      connect: (options, callback) => {
        const hostname = String(options.servername ?? options.host ?? "");
        this.connectServernames.push(hostname);
        pinnedLookup(hostname, { all: true }, (error, resolved) => {
          if (error !== null || !Array.isArray(resolved)) {
            callback(error ?? new Error("Fixture pinned lookup failed"), null);
            return;
          }
          this.pinnedLookupResults.push(...resolved);
          if (
            resolved.length !== 1 ||
            resolved[0]?.address !== address.address ||
            resolved[0]?.family !== address.family
          ) {
            callback(
              new Error("Fixture connector ignored validated address"),
              null,
            );
            return;
          }
          const socket = tcpConnect({ host: "127.0.0.1", port: this.port });
          socket.once("connect", () => callback(null, socket));
          socket.once("error", (connectError) => callback(connectError, null));
        });
      },
      maxHeaderSize: 16 * 1024,
    });
    const dispatcher = new CountingDispatcher(
      agent,
      () => {
        this.dispatchersClosed += 1;
        this.dispatchers.delete(dispatcher);
      },
      () => {
        this.dispatcherCloseFailed += 1;
      },
      () => {
        this.dispatchersDestroyed += 1;
        this.dispatchers.delete(dispatcher);
      },
      () => {
        this.dispatcherDestroyFailed += 1;
      },
    );
    const close = dispatcher.close.bind(dispatcher);
    dispatcher.close = async () => {
      this.dispatcherCloseStarted += 1;
      try {
        await close();
      } finally {
        this.closeCompletedDispatchers.add(dispatcher);
      }
    };
    const destroy = dispatcher.destroy.bind(dispatcher);
    dispatcher.destroy = async () => {
      this.dispatcherDestroyStarted += 1;
      try {
        await destroy();
      } finally {
        this.destroyCompletedDispatchers.add(dispatcher);
      }
    };
    this.dispatchers.add(dispatcher);
    this.dispatchersCreatedInOrder.push(dispatcher);
    return dispatcher;
  };

  private async closeServerBounded(): Promise<void> {
    if (!this.server.listening) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: NodeJS.Timeout | undefined;
      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (error === undefined) resolve();
        else reject(error);
      };
      timer = setTimeout(() => {
        try {
          this.server.closeAllConnections();
          finish(new Error("Timed out closing fixture server"));
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }, SERVER_CLOSE_TIMEOUT_MS);
      try {
        this.server.close((error) => finish(error));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  async close(): Promise<FixtureTeardownReport> {
    const residualSockets = this.sockets.size;
    const residualDispatchers = this.dispatchers.size;
    if (this.started) {
      this.started = false;
      for (const socket of this.sockets) {
        socket.destroy();
      }
      this.serverCloseStarted += 1;
      try {
        await this.closeServerBounded();
        this.serverClosed += 1;
      } catch {
        this.serverCloseFailed += 1;
      }
    }
    await Promise.allSettled(
      [...this.dispatchers].map((dispatcher) => dispatcher.destroy()),
    );
    const fallbackFailed =
      this.dispatcherCloseFailed > 0 ||
      this.dispatcherDestroyFailed > 0 ||
      this.serverCloseFailed > 0;
    const report: FixtureTeardownReport = {
      residualSockets,
      residualDispatchers,
      dispatcherCloseStarted: this.dispatcherCloseStarted,
      dispatcherCloseFailed: this.dispatcherCloseFailed,
      dispatchersClosed: this.dispatchersClosed,
      dispatcherDestroyStarted: this.dispatcherDestroyStarted,
      dispatcherDestroyFailed: this.dispatcherDestroyFailed,
      dispatchersDestroyed: this.dispatchersDestroyed,
      serverCloseStarted: this.serverCloseStarted,
      serverClosed: this.serverClosed,
      serverCloseFailed: this.serverCloseFailed,
    };
    this.sockets.clear();
    this.requests.length = 0;
    this.hosts.length = 0;
    this.connectServernames.length = 0;
    this.productionConnectorCalls.length = 0;
    this.dispatcherAddresses.length = 0;
    this.pinnedLookupResults.length = 0;
    this.requestConnectionIds.length = 0;
    this.dispatchers.clear();
    this.dispatchersCreatedInOrder.length = 0;
    this.closeCompletedDispatchers.clear();
    this.destroyCompletedDispatchers.clear();
    this.dispatchersCreated = 0;
    this.dispatcherCloseStarted = 0;
    this.dispatcherCloseFailed = 0;
    this.dispatchersClosed = 0;
    this.dispatcherDestroyStarted = 0;
    this.dispatcherDestroyFailed = 0;
    this.dispatchersDestroyed = 0;
    this.serverCloseStarted = 0;
    this.serverClosed = 0;
    this.serverCloseFailed = 0;
    this.nextConnectionId = 1;
    this.routes.clear();
    if (residualSockets > 0 || residualDispatchers > 0 || fallbackFailed) {
      throw new Error(
        `Fixture teardown found residual resources: sockets=${residualSockets}, dispatchers=${residualDispatchers}, failures=${fallbackFailed ? 1 : 0}, serverCloseFailed=${report.serverCloseFailed}`,
      );
    }
    return report;
  }
}
