import Fastify from "fastify";

import { buildApp } from "../../dist/app.js";
import { main } from "../../dist/server.js";

let emitSignal = () => {};
let signalSourceOn = false;

const signalSource = {
  on(_signal, listener) {
    emitSignal = listener;
    signalSourceOn = true;
  },
  off() {},
};

function report(event) {
  process.stdout.write(`${JSON.stringify({ event, pid: process.pid })}\n`);
}

process.once("SIGTERM", () => {
  if (!signalSourceOn) {
    process.exitCode = 1;
    return;
  }

  emitSignal();
});

await main({
  env: process.env,
  appFactory(config, logger) {
    const app = buildApp(config, logger);
    const listen = app.listen.bind(app);
    let resolvePendingListen;
    let rejectPendingListen;
    const pendingListen = new Promise((resolve, reject) => {
      resolvePendingListen = resolve;
      rejectPendingListen = reject;
    });

    app.listen = () => pendingListen;
    app.server.once("listening", () => {
      report("late-listening");
    });
    const closeServer = app.server.close.bind(app.server);
    app.server.close = (callback) => {
      closeServer((error) => {
        if (!error) {
          report("late-closed");
        }
        callback(error);
      });
    };

    setTimeout(async () => {
      try {
        const address = await listen({
          host: config.host,
          port: config.port,
        });
        resolvePendingListen(address);
      } catch (error) {
        rejectPendingListen(error);
      }
    }, 100);

    setImmediate(() => report("pending-listen"));
    return app;
  },
  signalSource,
});
