import type Database from "better-sqlite3";

const CONFIGURATION_TABLE_PATTERN = /^(?:sources|topics)$/u;
const CONFIGURATION_UPDATE_PATTERN = /\bUPDATE\s+(sources|topics)\s+SET\b/iu;
const CONFIGURATION_INSERT_PATTERN = /\bINSERT\s+INTO\s+(sources|topics)\b/iu;
const CONFIGURATION_SELECT_PATTERN =
  /\bSELECT\b[\s\S]*\bFROM\s+(sources|topics)\b/iu;

export class ConfigurationReadBackFailure extends Error {
  constructor(
    readonly successfulUpdates: number,
    readonly rowDuringTransaction: unknown,
  ) {
    super("injected configuration read-back failure");
    this.name = "ConfigurationReadBackFailure";
  }
}

export class ConfigurationCreateReadBackFailure extends Error {
  constructor(
    readonly successfulInserts: number,
    readonly rowDuringTransaction: unknown,
  ) {
    super("injected configuration create read-back failure");
    this.name = "ConfigurationCreateReadBackFailure";
  }
}

export interface SourceRowSnapshot {
  id: string;
  name: string;
  type: string;
  url: string;
  cron: string;
  enabled: number;
  description: string | null;
  last_collected_at: string | null;
}

export interface TopicRowSnapshot {
  id: string;
  name: string;
  description: string;
  enabled: number;
}

export function readSourceRows(db: Database.Database): SourceRowSnapshot[] {
  return db
    .prepare(
      `
        SELECT id, name, type, url, cron, enabled, description,
          last_collected_at
        FROM sources
        ORDER BY id COLLATE BINARY ASC
      `,
    )
    .all() as SourceRowSnapshot[];
}

export function readTopicRows(db: Database.Database): TopicRowSnapshot[] {
  return db
    .prepare(
      `
        SELECT id, name, description, enabled
        FROM topics
        ORDER BY id COLLATE BINARY ASC
      `,
    )
    .all() as TopicRowSnapshot[];
}

export function createConfigurationUpdateFailureDatabase(
  db: Database.Database,
  options: { failReadAfterSuccessfulUpdates: number },
): Database.Database {
  let successfulUpdates = 0;
  let updatedTable: string | null = null;

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          const updateTable = CONFIGURATION_UPDATE_PATTERN.exec(source)?.[1];
          const selectTable = CONFIGURATION_SELECT_PATTERN.exec(source)?.[1];
          if (
            !CONFIGURATION_TABLE_PATTERN.test(updateTable ?? "") &&
            !CONFIGURATION_TABLE_PATTERN.test(selectTable ?? "")
          ) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "run" && updateTable !== undefined) {
                return (...parameters: unknown[]) => {
                  const result = statementTarget.run(...parameters);
                  successfulUpdates += 1;
                  updatedTable = updateTable.toLowerCase();
                  return result;
                };
              }

              if (
                statementProperty === "get" &&
                selectTable?.toLowerCase() === updatedTable &&
                successfulUpdates >= options.failReadAfterSuccessfulUpdates
              ) {
                return (...parameters: unknown[]) => {
                  const rowDuringTransaction = statementTarget.get(
                    ...parameters,
                  );
                  throw new ConfigurationReadBackFailure(
                    successfulUpdates,
                    rowDuringTransaction,
                  );
                };
              }

              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createConfigurationCreateReadBackFailureDatabase(
  db: Database.Database,
): Database.Database {
  let successfulInserts = 0;
  let insertedTable: string | null = null;

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          const insertTable = CONFIGURATION_INSERT_PATTERN.exec(source)?.[1];
          const selectTable = CONFIGURATION_SELECT_PATTERN.exec(source)?.[1];
          if (
            !CONFIGURATION_TABLE_PATTERN.test(insertTable ?? "") &&
            !CONFIGURATION_TABLE_PATTERN.test(selectTable ?? "")
          ) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "run" && insertTable !== undefined) {
                return (...parameters: unknown[]) => {
                  const result = statementTarget.run(...parameters);
                  successfulInserts += 1;
                  insertedTable = insertTable.toLowerCase();
                  return result;
                };
              }

              if (
                statementProperty === "get" &&
                selectTable?.toLowerCase() === insertedTable &&
                successfulInserts >= 1
              ) {
                return (...parameters: unknown[]) => {
                  const rowDuringTransaction = statementTarget.get(
                    ...parameters,
                  );
                  throw new ConfigurationCreateReadBackFailure(
                    successfulInserts,
                    rowDuringTransaction,
                  );
                };
              }

              const value = Reflect.get(
                statementTarget,
                statementProperty,
                statementReceiver,
              );
              return typeof value === "function"
                ? value.bind(statementTarget)
                : value;
            },
          });
        };
      }

      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
