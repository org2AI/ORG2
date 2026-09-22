import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  type TauriSqlDialect,
  TauriSqlProvider,
} from "../providers/TauriSqlProvider";
import type { PostgresConnectionConfig } from "../types";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

/**
 * A deliberately odd dialect so every assertion below proves the base class
 * routed through the dialect hooks instead of hard-coding either real dialect.
 */
const FAKE_DIALECT: TauriSqlDialect<PostgresConnectionConfig> = {
  type: "postgres",
  buildConnectionString: (config) => `fake://${config.host}/${config.database}`,
  quoteIdentifier: (identifier) => `[${identifier}]`,
  formatValue: (value) => `<${String(value)}>`,
};

class FakeProvider extends TauriSqlProvider<PostgresConnectionConfig> {
  constructor(config: PostgresConnectionConfig) {
    super(config, FAKE_DIALECT);
  }
}

const config: PostgresConnectionConfig = {
  id: "conn-1",
  name: "Fake",
  type: "postgres",
  createdAt: 0,
  updatedAt: 0,
  host: "db.example.com",
  port: 5432,
  database: "app",
  user: "admin",
};

async function connected(): Promise<FakeProvider> {
  const provider = new FakeProvider(config);
  invokeMock.mockResolvedValueOnce("lease-1");
  await provider.connect();
  invokeMock.mockClear();
  return provider;
}

/** Whitespace-normalised SQL of the nth invoke call. */
function sqlAt(index: number): string {
  const call = invokeMock.mock.calls[index];
  return String((call[1] as { sql: string }).sql)
    .replace(/\s+/g, " ")
    .trim();
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("TauriSqlProvider connection lifecycle", () => {
  it("takes its type and connection string from the dialect", async () => {
    const provider = new FakeProvider(config);
    invokeMock.mockResolvedValue("lease-1");

    expect(provider.type).toBe("postgres");
    expect(provider.status).toEqual({ state: "disconnected" });
    expect(provider.isConnected()).toBe(false);

    await provider.connect();

    expect(invokeMock).toHaveBeenCalledWith("db_sql_connect", {
      connectionId: "conn-1",
      dbType: "postgres",
      connectionString: "fake://db.example.com/app",
    });
    expect(provider.status).toMatchObject({ state: "connected" });
    expect(provider.isConnected()).toBe(true);
  });

  it("is idempotent once connected", async () => {
    const provider = await connected();

    await provider.connect();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("records the error status and rethrows when the backend rejects", async () => {
    const provider = new FakeProvider(config);
    invokeMock.mockRejectedValueOnce(new Error("refused"));

    await expect(provider.connect()).rejects.toThrow("refused");

    expect(provider.status).toEqual({ state: "error", error: "refused" });
    expect(provider.isConnected()).toBe(false);
  });

  it("disconnects best-effort and never invokes when not connected", async () => {
    const provider = await connected();
    invokeMock.mockRejectedValueOnce(new Error("already gone"));

    await provider.disconnect();

    expect(invokeMock).toHaveBeenCalledWith("db_sql_disconnect", {
      connectionId: "lease-1",
    });
    expect(provider.status).toEqual({ state: "disconnected" });
    expect(provider.isConnected()).toBe(false);

    invokeMock.mockClear();
    await provider.disconnect();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("rejects data access before connect()", async () => {
    const provider = new FakeProvider(config);
    const notConnected = "Database not connected. Call connect() first.";

    await expect(provider.getTables()).rejects.toThrow(notConnected);
    await expect(provider.query("SELECT 1")).rejects.toThrow(notConnected);
    await expect(provider.execute("DELETE FROM t")).rejects.toThrow(
      notConnected
    );
    expect(invokeMock).not.toHaveBeenCalled();
  });
});

describe("TauriSqlProvider SQL building through the dialect", () => {
  const emptyQueryResult = { columns: [], rows: [], row_count: 0 };

  it("quotes identifiers with the dialect in getTableData and tolerates count failures", async () => {
    const provider = await connected();
    invokeMock
      .mockResolvedValueOnce({ columns: ["id"], rows: [[1]], row_count: 1 })
      .mockRejectedValueOnce(new Error("count failed"));

    const result = await provider.getTableData("users", {
      page: 3,
      pageSize: 20,
      orderBy: "name",
      orderDirection: "desc",
    });

    expect(sqlAt(0)).toBe(
      "SELECT * FROM [users] ORDER BY [name] DESC LIMIT 20 OFFSET 40"
    );
    expect(sqlAt(1)).toBe("SELECT COUNT(*) as count FROM [users]");
    expect(result).toMatchObject({
      columns: ["id"],
      values: [[1]],
      rowCount: 1,
      totalCount: undefined,
    });
  });

  it("formats values with the dialect in insert, update and delete", async () => {
    const provider = await connected();
    invokeMock.mockResolvedValue({ rows_affected: 1 });

    await provider.insert("users", { name: "Ada", age: 36 });
    await provider.update("users", { name: "Grace" }, { id: 7 });
    await provider.delete("users", { id: 7, name: "Grace" });

    expect(sqlAt(0)).toBe(
      "INSERT INTO [users] ([name], [age]) VALUES (<Ada>, <36>)"
    );
    expect(sqlAt(1)).toBe(
      "UPDATE [users] SET [name] = <Grace> WHERE [id] = <7>"
    );
    expect(sqlAt(2)).toBe(
      "DELETE FROM [users] WHERE [id] = <7> AND [name] = <Grace>"
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "db_sql_execute",
      expect.objectContaining({ connectionId: "lease-1" })
    );
  });

  it("turns backend mutation failures into a failed ExecuteResult", async () => {
    const provider = await connected();
    invokeMock.mockRejectedValueOnce(new Error("constraint violated"));

    const result = await provider.execute("INSERT INTO t VALUES (1)");

    expect(result).toMatchObject({
      success: false,
      rowsAffected: 0,
      error: "constraint violated",
    });
  });

  it("passes raw query SQL through untouched", async () => {
    const provider = await connected();
    invokeMock.mockResolvedValueOnce(emptyQueryResult);

    const result = await provider.query("SELECT 1");

    expect(invokeMock).toHaveBeenCalledWith("db_sql_query", {
      connectionId: "lease-1",
      sql: "SELECT 1",
    });
    expect(result).toMatchObject({ columns: [], values: [], rowCount: 0 });
  });
});
