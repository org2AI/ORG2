import { invoke } from "@tauri-apps/api/core";

import type {
  ColumnInfo,
  ConnectionStatus,
  ExecuteResult,
  IDatabaseService,
  MySQLConnectionConfig,
  PostgresConnectionConfig,
  QueryOptions,
  QueryResult,
  TableInfo,
} from "../types";
import {
  ConnectionLifecycle,
  requireConnectionLease,
} from "./ConnectionLifecycle";

type TauriSqlConnectionConfig =
  | PostgresConnectionConfig
  | MySQLConnectionConfig;

export interface TauriSqlDialect<Config extends TauriSqlConnectionConfig> {
  readonly type: Config["type"];
  buildConnectionString(config: Config): string;
  quoteIdentifier(identifier: string): string;
  formatValue(value: unknown): string;
}

interface TauriQueryResult {
  columns: string[];
  rows: unknown[][];
  row_count: number;
}

interface TauriExecuteResult {
  rows_affected: number;
}

interface TauriTableInfo {
  name: string;
  table_type: string;
  row_count: number | null;
}

interface TauriColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  primary_key: boolean;
  default_value: string | null;
  auto_increment: boolean;
}

/**
 * Shared lifecycle and command adapter for the sqlx-backed database providers.
 * Provider-specific connection strings and SQL syntax stay in a dialect object.
 */
export abstract class TauriSqlProvider<
  Config extends TauriSqlConnectionConfig,
> implements IDatabaseService {
  readonly type: Config["type"];
  readonly config: Config;

  private lifecycle = new ConnectionLifecycle<string>((connectionId) =>
    invoke<void>("db_sql_disconnect", { connectionId }).catch(() => {})
  );

  protected constructor(
    config: Config,
    private readonly dialect: TauriSqlDialect<Config>
  ) {
    this.config = config;
    this.type = dialect.type;
  }

  get status(): ConnectionStatus {
    return this.lifecycle.status;
  }

  connect(): Promise<void> {
    return this.lifecycle.connect(() =>
      invoke<string>("db_sql_connect", {
        connectionId: this.config.id,
        dbType: this.type,
        connectionString: this.dialect.buildConnectionString(this.config),
      }).then(requireConnectionLease)
    );
  }

  disconnect(): Promise<void> {
    return this.lifecycle.disconnect();
  }

  isConnected(): boolean {
    return this.lifecycle.current !== null;
  }

  async getTables(): Promise<TableInfo[]> {
    this.ensureConnected();

    const result = await invoke<TauriTableInfo[]>("db_sql_get_tables", {
      connectionId: this.lifecycle.current,
    });

    return result.map((table) => ({
      name: table.name,
      type:
        table.table_type === "VIEW" ? ("view" as const) : ("table" as const),
      rowCount: table.row_count ?? undefined,
    }));
  }

  async getTableSchema(tableName: string): Promise<ColumnInfo[]> {
    this.ensureConnected();

    const result = await invoke<TauriColumnInfo[]>("db_sql_get_table_schema", {
      connectionId: this.lifecycle.current,
      tableName,
    });

    return result.map((column) => ({
      name: column.name,
      type: column.data_type,
      nullable: column.nullable,
      primaryKey: column.primary_key,
      defaultValue: column.default_value,
      autoIncrement: column.auto_increment,
    }));
  }

  async getTableData(
    tableName: string,
    options: QueryOptions = {}
  ): Promise<QueryResult> {
    this.ensureConnected();

    const {
      page = 1,
      pageSize = 100,
      orderBy,
      orderDirection = "asc",
    } = options;
    const offset = (page - 1) * pageSize;
    const startTime = performance.now();
    const table = this.dialect.quoteIdentifier(tableName);
    const orderColumn = orderBy
      ? this.dialect.quoteIdentifier(orderBy)
      : undefined;

    let sql = `SELECT * FROM ${table}`;
    if (orderColumn) {
      sql += ` ORDER BY ${orderColumn} ${orderDirection.toUpperCase()}`;
    }
    sql += ` LIMIT ${pageSize} OFFSET ${offset}`;

    const result = await invoke<TauriQueryResult>("db_sql_query", {
      connectionId: this.lifecycle.current,
      sql,
    });
    const duration = performance.now() - startTime;

    let totalCount: number | undefined;
    try {
      const countResult = await invoke<TauriQueryResult>("db_sql_query", {
        connectionId: this.lifecycle.current,
        sql: `SELECT COUNT(*) as count FROM ${table}`,
      });
      if (countResult.rows.length > 0) {
        totalCount = Number(countResult.rows[0][0]);
      }
    } catch {
      // Count metadata is optional; return the requested page when it fails.
    }

    return {
      columns: result.columns,
      values: result.rows,
      rowCount: result.row_count,
      totalCount,
      duration,
    };
  }

  async query(sql: string): Promise<QueryResult> {
    this.ensureConnected();

    const startTime = performance.now();
    const result = await invoke<TauriQueryResult>("db_sql_query", {
      connectionId: this.lifecycle.current,
      sql,
    });

    return {
      columns: result.columns,
      values: result.rows,
      rowCount: result.row_count,
      duration: performance.now() - startTime,
    };
  }

  async execute(sql: string): Promise<ExecuteResult> {
    this.ensureConnected();
    return this.executeMutation(sql);
  }

  async insert(
    tableName: string,
    data: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();
    const startTime = performance.now();

    const table = this.dialect.quoteIdentifier(tableName);
    const columns = Object.keys(data);
    const quotedColumns = columns.map((column) =>
      this.dialect.quoteIdentifier(column)
    );
    const values = columns.map((column) =>
      this.dialect.formatValue(data[column])
    );
    const sql = `
      INSERT INTO ${table} (${quotedColumns.join(", ")})
      VALUES (${values.join(", ")})
    `;

    return this.executeMutation(sql, startTime);
  }

  async update(
    tableName: string,
    data: Record<string, unknown>,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();
    const startTime = performance.now();

    const table = this.dialect.quoteIdentifier(tableName);
    const setClause = this.formatAssignments(data, ", ");
    const whereClause = this.formatAssignments(where, " AND ");
    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;

    return this.executeMutation(sql, startTime);
  }

  async delete(
    tableName: string,
    where: Record<string, unknown>
  ): Promise<ExecuteResult> {
    this.ensureConnected();
    const startTime = performance.now();

    const table = this.dialect.quoteIdentifier(tableName);
    const whereClause = this.formatAssignments(where, " AND ");
    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;

    return this.executeMutation(sql, startTime);
  }

  async save(): Promise<void> {
    // No-op for remote databases
  }

  private formatAssignments(
    values: Record<string, unknown>,
    separator: string
  ): string {
    return Object.entries(values)
      .map(
        ([column, value]) =>
          `${this.dialect.quoteIdentifier(column)} = ${this.dialect.formatValue(value)}`
      )
      .join(separator);
  }

  private async executeMutation(
    sql: string,
    startTime = performance.now()
  ): Promise<ExecuteResult> {
    try {
      const result = await invoke<TauriExecuteResult>("db_sql_execute", {
        connectionId: this.lifecycle.current,
        sql,
      });
      return {
        success: true,
        rowsAffected: result.rows_affected,
        duration: performance.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        rowsAffected: 0,
        duration: performance.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private ensureConnected(): void {
    if (this.lifecycle.current === null) {
      throw new Error("Database not connected. Call connect() first.");
    }
  }
}
