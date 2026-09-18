import { beforeEach, expect, it, vi } from "vitest";

import { MySQLProvider } from "../providers/MySQLProvider";
import { NeonProvider } from "../providers/NeonProvider";
import { PostgresProvider } from "../providers/PostgresProvider";
import { SupabaseProvider } from "../providers/SupabaseProvider";
import { TursoProvider } from "../providers/TursoProvider";
import { quoteIdentifier, quoteLiteral } from "../providers/sqlSyntax";
import type { IDatabaseService } from "../types";

const { sql, invoke } = vi.hoisted(() => ({
  sql: [] as string[],
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/plugin-shell", () => ({
  Command: {
    create: (_: string, args: string[]) => ({
      execute: async () => {
        sql.push(JSON.parse(args[args.indexOf("-d") + 1]).query);
        return {
          code: 0,
          stderr: "",
          stdout: args.some((v) => v.includes("neon.tech"))
            ? JSON.stringify({ rows: [{ fields: [], rows: [], rowCount: 0 }] })
            : "[]",
        };
      },
    }),
  },
}));
vi.mock("@libsql/client", () => ({
  createClient: () => ({
    close() {},
    async execute(query: string | { sql: string }) {
      sql.push(typeof query === "string" ? query : query.sql);
      return { columns: [], rows: [], rowsAffected: 0 };
    },
  }),
}));
const base = { id: "config", name: "test", createdAt: 0, updatedAt: 0 };
const providers: [string, () => IDatabaseService][] = [
  [
    "postgres",
    () =>
      new PostgresProvider({
        ...base,
        type: "postgres",
        host: "db.invalid",
        port: 5432,
        user: "fake",
        database: "fake",
      }),
  ],
  [
    "mysql",
    () =>
      new MySQLProvider({
        ...base,
        type: "mysql",
        host: "db.invalid",
        port: 3306,
        user: "fake",
        database: "fake",
      }),
  ],
  [
    "neon",
    () =>
      new NeonProvider({
        ...base,
        type: "neon",
        connectionString: "postgres://fake:fake@fake.neon.tech/fake",
      }),
  ],
  [
    "supabase",
    () =>
      new SupabaseProvider({
        ...base,
        type: "supabase",
        url: "https://fake.supabase.co",
        accessToken: "fake",
        schema: 'schema"name',
      }),
  ],
  [
    "turso",
    () =>
      new TursoProvider({
        ...base,
        type: "turso",
        url: "libsql://fake.invalid",
      }),
  ],
];
beforeEach(() => {
  sql.length = 0;
  invoke.mockReset().mockImplementation(async (name, args) => {
    if (name === "db_sql_connect") return "returned-lease";
    if (args.sql) sql.push(args.sql);
    if (name === "db_sql_get_table_schema") return [];
    return { columns: [], rows: [], row_count: 0, rows_affected: 1 };
  });
});
it.each(providers)(
  "%s quotes table/column boundaries in page and all CRUD paths",
  async (name, create) => {
    const provider = create();
    await provider.connect();
    sql.length = 0;
    const table = "a\"b`c'd";
    const column = "x\"y`z'w";
    const delimiter = name === "mysql" ? "`" : '"';
    await provider.getTableData(table, { orderBy: column });
    await provider.insert(table, { [column]: "value" });
    await provider.update(table, { [column]: "new" }, { [column]: "value" });
    await provider.delete(table, { [column]: "new" });
    expect(sql.length).toBeGreaterThanOrEqual(5);
    for (const statement of sql)
      expect(statement).toContain(quoteIdentifier(table, delimiter));
    expect(sql[0]).toContain(quoteIdentifier(column, delimiter));
    for (const statement of sql.slice(-3))
      expect(statement).toContain(quoteIdentifier(column, delimiter));
    if (name === "supabase")
      for (const statement of sql)
        expect(statement).toContain('"schema""name".');
    await provider.disconnect();
  }
);
it.each(
  providers.filter(([name]) => ["neon", "supabase", "turso"].includes(name))
)("%s uses an escaped literal for schema lookup", async (_, create) => {
  const provider = create();
  await provider.connect();
  sql.length = 0;
  const table = "name' OR '1'='1";
  await provider.getTableSchema(table);
  expect(sql.some((statement) => statement.includes(quoteLiteral(table)))).toBe(
    true
  );
  await provider.disconnect();
});
it.each(["postgres", "mysql"] as const)(
  "%s preserves reserved credentials/database characters in its connection URI",
  async (type) => {
    const config = {
      ...base,
      type,
      host: "db.invalid",
      port: 5432,
      user: "user@/:?",
      password: "password#%/",
      database: "database/?#",
    };
    const provider =
      type === "postgres"
        ? new PostgresProvider({ ...config, type: "postgres" })
        : new MySQLProvider({ ...config, type: "mysql" });
    await provider.connect();
    const call = invoke.mock.calls.find(([name]) => name === "db_sql_connect");
    const uri = new URL(call![1].connectionString);
    expect(uri.hostname).toBe(config.host);
    expect(decodeURIComponent(uri.username)).toBe(config.user);
    expect(decodeURIComponent(uri.password)).toBe(config.password);
    expect(decodeURIComponent(uri.pathname.slice(1))).toBe(config.database);
    expect(uri.hash).toBe("");
    await provider.disconnect();
  }
);
