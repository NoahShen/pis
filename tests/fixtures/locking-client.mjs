import Database from "better-sqlite3";

const databasePath = process.argv[2];
let db;

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function emitError(error) {
  emit({
    event: "error",
    at: Date.now(),
    code:
      error !== null &&
      typeof error === "object" &&
      typeof error.code === "string"
        ? error.code
        : "UNKNOWN",
  });
}

function closeDatabase() {
  if (db?.open === true) {
    db.close();
  }
}

process.once("SIGTERM", () => {
  closeDatabase();
  process.exitCode = 1;
});

if (typeof databasePath !== "string" || databasePath.length === 0) {
  emitError(new TypeError("database path is required"));
  process.exitCode = 1;
} else {
  try {
    db = new Database(databasePath);
    db.pragma("busy_timeout = 5000");

    emit({ event: "started", pid: process.pid, at: Date.now() });
    emit({ event: "attempting", pid: process.pid, at: Date.now() });

    const result = db
      .prepare("INSERT INTO transaction_probe (id) VALUES (?)")
      .run("locking-client-write");

    emit({
      event: "success",
      pid: process.pid,
      at: Date.now(),
      changes: result.changes,
    });
  } catch (error) {
    emitError(error);
    process.exitCode = 1;
  } finally {
    closeDatabase();
  }
}
