/**
 * TauriSqliteProvider
 *
 * Implements IDatabaseService for local SQLite files by delegating all
 * operations to Rust via Tauri commands (db_open, db_query, etc.).
 *
 * Replaces the WASM sql.js SqliteProvider — no browser-side SQLite binary.
 */
import { invoke } from "@tauri-apps/api/core";

import type {
  ColumnInfo,
  ConnectionStatus,
  ExecuteResult,
  IDatabaseService,
  QueryOptions,
  QueryResult,
  SqliteConnectionConfig,
  TableInfo,
} from "../types";
import {
  ConnectionLifecycle,
  requireConnectionLease,
} from "./ConnectionLifecycle";

export class TauriSqliteProvider implements IDatabaseService {
  readonly type = "sqlite" as const;
  readonly config: SqliteConnectionConfig;

  private lifecycle = new ConnectionLifecycle<string>((connectionId) =>
    invoke("db_close", { connectionId })
  );
  constructor(config: SqliteConnectionConfig) {
    this.config = config;
  }

  get status(): ConnectionStatus {
    return this.lifecycle.status;
  }
  connect(): Promise<void> {
    return this.lifecycle.connect(() =>
      invoke<string>("db_open", { filePath: this.config.filePath }).then(
        requireConnectionLease
      )
    );
  }
  disconnect(): Promise<void> {
    return this.lifecycle.disconnect();
  }
  isConnected(): boolean {
    return this.lifecycle.current !== null;
  }

  async getTables(): Promise<TableInfo[]> {
    const id = this.requireConnectionId();
    return invoke<TableInfo[]>("db_get_tables", { connectionId: id });
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    const id = this.requireConnectionId();
    return invoke<ColumnInfo[]>("db_get_table_schema", {
      connectionId: id,
      tableName,
    });
  }

  async getTableData(
    tableName: string,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    const id = this.requireConnectionId();
    return invoke<QueryResult>("db_get_table_data", {
      connectionId: id,
      tableName,
      options,
    });
  }

  async query(sql: string): Promise<QueryResult> {
    const id = this.requireConnectionId();
    return invoke<QueryResult>("db_query", { connectionId: id, sql });
  }

  async execute(sql: string): Promise<ExecuteResult> {
    const id = this.requireConnectionId();
    return invoke<ExecuteResult>("db_execute", { connectionId: id, sql });
  }

  async insert(
    tableName: string,
    data: Record<string, unknown>
  ): Promise<ExecuteResult> {
    const id = this.requireConnectionId();
    return invoke<ExecuteResult>("db_insert", {
      connectionId: id,
      tableName,
      data,
    });
  }

  async update(
    tableName: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    const id = this.requireConnectionId();
    return invoke<ExecuteResult>("db_update", {
      connectionId: id,
      tableName,
      data,
      whereClause: where,
    });
  }

  async delete(
    tableName: string,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    const id = this.requireConnectionId();
    return invoke<ExecuteResult>("db_delete", {
      connectionId: id,
      tableName,
      whereClause: where,
    });
  }

  async save(): Promise<void> {
    // Rust writes directly to the file — no explicit save needed.
  }

  private requireConnectionId(): string {
    if (!this.lifecycle.current) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.lifecycle.current;
  }
}

export default TauriSqliteProvider;
