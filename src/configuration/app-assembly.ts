import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type Database from "better-sqlite3";
import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../config.js";
import { DEFAULT_DATABASE_PATH } from "../config.js";
import {
  SqliteSourceRepository,
  type SourceRepository,
} from "./source-repository.js";
import {
  SqliteTopicRepository,
  type TopicRepository,
} from "./topic-repository.js";
import { openDatabase } from "../database/open-database.js";
import { initializeDatabase } from "../database/schema.js";
import { CryptoIdGenerator } from "../id/crypto-id-generator.js";
import { registerRoutes } from "./route-registry.js";

export interface ConfigurationRepositories {
  source: SourceRepository;
  topic: TopicRepository;
}

export interface AppDependencies {
  repositories?: ConfigurationRepositories;
}

interface AssembledDependencies {
  repositories: ConfigurationRepositories;
  database?: Database.Database;
}

function createRepositories(db: Database.Database): ConfigurationRepositories {
  const idGenerator = new CryptoIdGenerator();
  return {
    source: new SqliteSourceRepository(db, idGenerator),
    topic: new SqliteTopicRepository(db, idGenerator),
  };
}

function openOwnedDependencies(config: AppConfig): AssembledDependencies {
  const databasePath = resolve(config.databasePath ?? DEFAULT_DATABASE_PATH);
  let database: Database.Database | undefined;

  try {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = openDatabase(databasePath);
    initializeDatabase(database);
    return { repositories: createRepositories(database), database };
  } catch (error) {
    try {
      if (database?.open === true) {
        database.close();
      }
    } catch {
      // Preserve the initialization error that caused assembly to fail.
    }

    throw error;
  }
}

export function assembleApp(
  app: FastifyInstance,
  config: AppConfig,
  dependencies?: AppDependencies,
): void {
  const assembled =
    dependencies?.repositories === undefined
      ? openOwnedDependencies(config)
      : { repositories: dependencies.repositories };

  try {
    registerRoutes(app, config, assembled.repositories);

    if (assembled.database !== undefined) {
      const database = assembled.database;
      let databaseClosed = false;
      const closeOwnedDatabase = (): void => {
        if (databaseClosed || !database.open) {
          return;
        }

        databaseClosed = true;
        database.close();
      };

      app.addHook("onClose", async () => {
        closeOwnedDatabase();
      });

      void Promise.resolve(app.ready()).catch(() => {
        try {
          closeOwnedDatabase();
        } catch {
          // Preserve the ready rejection that caused startup to fail.
        }
      });
    }
  } catch (error) {
    try {
      if (assembled.database?.open === true) {
        assembled.database.close();
      }
    } catch {
      // Preserve the route assembly error that caused startup to fail.
    }

    throw error;
  }
}
