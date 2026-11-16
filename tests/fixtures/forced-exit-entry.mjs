import Fastify from "fastify";

import { buildApp } from "../../dist/app.js";
import { main } from "../../dist/server.js";

const databasePath = process.env.DATABASE_PATH;
if (databasePath === undefined || databasePath.trim() === "") {
  throw new Error("DATABASE_PATH must be provided by the smoke harness");
}

let emitSignal = () => {};

const signalSource = {
  on(_signal, listener) {
    emitSignal = listener;
  },
  off() {},
};

await main({
  env: { ...process.env, DATABASE_PATH: databasePath },
  appFactory(config, logger) {
    const app = buildApp(config, logger);

    app.addHook("preClose", async () => {
      await new Promise(() => undefined);
    });
    app.server.once("listening", () => {
      setImmediate(() => emitSignal());
    });

    return app;
  },
  signalSource,
});
