import type Database from "better-sqlite3";

const EVENT_SEARCH_INSERT =
  "INSERT INTO event_search (event_id, search_text) VALUES (?, ?)";

function normalizeSql(source: string): string {
  return source.replace(/\s+/g, " ").trim();
}

export function createFaultyDatabase(
  db: Database.Database,
  failEventSearchInsertAt: number,
): Database.Database {
  let eventSearchInsertCount = 0;

  return new Proxy(db, {
    get(target, property, receiver) {
      if (property === "prepare") {
        return (source: string): Database.Statement => {
          const statement = target.prepare(source);
          if (normalizeSql(source) !== EVENT_SEARCH_INSERT) {
            return statement;
          }

          return new Proxy(statement, {
            get(statementTarget, statementProperty, statementReceiver) {
              if (statementProperty === "run") {
                return (...parameters: unknown[]) => {
                  eventSearchInsertCount += 1;
                  if (eventSearchInsertCount === failEventSearchInsertAt) {
                    throw new Error("injected event_search insert failure");
                  }

                  return statementTarget.run(...parameters);
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
