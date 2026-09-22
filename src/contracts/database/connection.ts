/**
 * Database connection configuration.
 *
 * Persisted by `store/workstation/database` and consumed by the
 * `engines/DatabaseCore` provider factory, so the config shapes live here.
 * Connection behavior (the service interface, type guards, query shapes)
 * stays in `engines/DatabaseCore/types`.
 */

export const DATABASE_TYPES = [
  "sqlite",
  "supabase",
  "turso",
  "neon",
  "postgres",
  "mysql",
] as const;

export type DatabaseType = (typeof DATABASE_TYPES)[number];

interface BaseConnectionConfig {
  id: string;
  name: string;
  type: DatabaseType;
  createdAt: number;
  updatedAt: number;
}

export interface SqliteConnectionConfig extends BaseConnectionConfig {
  type: "sqlite";
  filePath: string;
}

export interface SupabaseConnectionConfig extends BaseConnectionConfig {
  type: "supabase";
  url: string;
  accessToken: string;
  schema?: string;
}

export interface TursoConnectionConfig extends BaseConnectionConfig {
  type: "turso";
  url: string;
  authToken?: string;
}

export interface NeonConnectionConfig extends BaseConnectionConfig {
  type: "neon";
  connectionString: string;
}

export interface PostgresConnectionConfig extends BaseConnectionConfig {
  type: "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
}

export interface MySQLConnectionConfig extends BaseConnectionConfig {
  type: "mysql";
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  ssl?: boolean;
}

export type DatabaseConnectionConfig =
  | SqliteConnectionConfig
  | SupabaseConnectionConfig
  | TursoConnectionConfig
  | NeonConnectionConfig
  | PostgresConnectionConfig
  | MySQLConnectionConfig;
