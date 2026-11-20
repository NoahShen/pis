import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

const productionFactories = vi.hoisted(() => ({
  buildProductionApp: vi.fn(),
  createProductionAssembly: vi.fn(),
}));

vi.mock("../../src/production/application.js", () => ({
  buildProductionApp: productionFactories.buildProductionApp,
  createProductionAssembly: productionFactories.createProductionAssembly,
}));

import { main } from "../../src/lifecycle.js";
import { testEnvironment } from "../fixtures/app-config.js";
import { CapturedLogger } from "../fixtures/captured-logger.js";

function failingListenApp(): FastifyInstance {
  return {
    listen: vi.fn(async () => {
      throw new Error("private listen detail");
    }),
    close: vi.fn(async () => undefined),
    server: {},
  } as unknown as FastifyInstance;
}

afterEach(() => {
  productionFactories.buildProductionApp.mockReset();
  productionFactories.createProductionAssembly.mockReset();
  vi.restoreAllMocks();
});

describe("production lifecycle factory selection", () => {
  it("uses buildProductionApp by default without falling back to lightweight buildApp", async () => {
    const app = failingListenApp();
    productionFactories.buildProductionApp.mockReturnValue(app);
    const logger = new CapturedLogger();
    const forceExit = vi.fn();

    await main({
      env: testEnvironment(),
      loggerFactory: () => logger,
      forceExit,
    });

    expect(
      productionFactories.buildProductionApp,
    ).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        databasePath: expect.any(String),
        llmEndpoint: expect.any(String),
        llmApiKey: expect.any(String),
        llmModel: expect.any(String),
        promptsDirectory: expect.any(String),
        rssSsrfProtection: true,
        cronTimezone: "Asia/Shanghai",
      }),
      logger,
    );
    expect(productionFactories.createProductionAssembly).not.toHaveBeenCalled();
    expect(app.listen).toHaveBeenCalledExactlyOnceWith({
      host: "127.0.0.1",
      port: 3000,
    });
    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("honors an injected appFactory and does not invoke the production default", async () => {
    const app = failingListenApp();
    const appFactory = vi.fn(() => app);
    const logger = new CapturedLogger();
    const forceExit = vi.fn();

    await main({
      env: testEnvironment(),
      loggerFactory: () => logger,
      appFactory,
      forceExit,
    });

    expect(appFactory).toHaveBeenCalledOnce();
    expect(productionFactories.buildProductionApp).not.toHaveBeenCalled();
    expect(productionFactories.createProductionAssembly).not.toHaveBeenCalled();
    expect(forceExit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
