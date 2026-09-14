/**
 * Database Service Factory
 *
 * Creates database service instances based on connection configuration.
 * Decoupled from any store — callers provide configs directly, and
 * can optionally pass a config loader for reconnection.
 */
import { createLogger } from "@src/hooks/logger";

import type { DatabaseConnectionConfig, IDatabaseService } from "./types";

const log = createLogger("DatabaseFactory");

const MAX_SERVICE_CACHE = 50;
let activeCreations = 0;
const serviceCache = new Map<string, IDatabaseService>();
const pending = new Map<
  string,
  { token: string; cancelled: boolean; promise: Promise<IDatabaseService> }
>();

async function createSqliteProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { TauriSqliteProvider } =
    await import("./providers/TauriSqliteProvider");
  return new TauriSqliteProvider(
    config as ConstructorParameters<typeof TauriSqliteProvider>[0]
  );
}

async function createSupabaseProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { SupabaseProvider } = await import("./providers/SupabaseProvider");
  return new SupabaseProvider(
    config as ConstructorParameters<typeof SupabaseProvider>[0]
  );
}

async function createTursoProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { TursoProvider } = await import("./providers/TursoProvider");
  return new TursoProvider(
    config as ConstructorParameters<typeof TursoProvider>[0]
  );
}

async function createNeonProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { NeonProvider } = await import("./providers/NeonProvider");
  return new NeonProvider(
    config as ConstructorParameters<typeof NeonProvider>[0]
  );
}

async function createPostgresProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { PostgresProvider } = await import("./providers/PostgresProvider");
  return new PostgresProvider(
    config as ConstructorParameters<typeof PostgresProvider>[0]
  );
}

async function createMySQLProvider(
  config: DatabaseConnectionConfig
): Promise<IDatabaseService> {
  const { MySQLProvider } = await import("./providers/MySQLProvider");
  return new MySQLProvider(
    config as ConstructorParameters<typeof MySQLProvider>[0]
  );
}

export type ConfigLoader = () => DatabaseConnectionConfig[];

export const DatabaseServiceFactory = {
  async create(
    config: DatabaseConnectionConfig,
    forceNew = false
  ): Promise<IDatabaseService> {
    const token = JSON.stringify(config);
    const flight = pending.get(config.id);
    if (flight && !forceNew && flight.token === token) return flight.promise;
    const cached = serviceCache.get(config.id);
    if (
      activeCreations >= MAX_SERVICE_CACHE &&
      !(cached && !forceNew && JSON.stringify(cached.config) === token)
    )
      throw new Error(
        "Database service creation limit reached. Try again after pending work completes."
      );
    if (flight) {
      flight.cancelled = true;
      pending.delete(config.id);
    }
    if (cached && !forceNew && JSON.stringify(cached.config) === token)
      return cached;
    if (cached) serviceCache.delete(config.id);
    const request = {
      token,
      cancelled: false,
      promise: null as unknown as Promise<IDatabaseService>,
    };
    const run = async () => {
      if (cached) await cached.disconnect();
      let service: IDatabaseService;

      switch (config.type) {
        case "sqlite":
          service = await createSqliteProvider(config);
          break;
        case "supabase":
          service = await createSupabaseProvider(config);
          break;
        case "turso":
          service = await createTursoProvider(config);
          break;
        case "neon":
          service = await createNeonProvider(config);
          break;
        case "postgres":
          service = await createPostgresProvider(config);
          break;
        case "mysql":
          service = await createMySQLProvider(config);
          break;
        default:
          throw new Error(
            `Unsupported database type: ${(config as DatabaseConnectionConfig).type}`
          );
      }

      if (request.cancelled) {
        await service.disconnect();
        throw new Error("Database service creation cancelled");
      }
      if (serviceCache.size >= MAX_SERVICE_CACHE) {
        const idle = [...serviceCache].find(
          ([, item]) =>
            !item.isConnected() && item.status.state !== "connecting"
        );
        if (!idle)
          throw new Error(
            "Database service limit reached. Close a database first."
          );
        serviceCache.delete(idle[0]);
        void idle[1].disconnect().catch(log.error);
      }
      serviceCache.set(config.id, service);
      return service;
    };
    activeCreations++;
    request.promise = run().finally(() => {
      activeCreations--;
      if (pending.get(config.id) === request) pending.delete(config.id);
    });
    pending.set(config.id, request);
    return request.promise;
  },

  get(connectionId: string): IDatabaseService | undefined {
    return serviceCache.get(connectionId);
  },

  /**
   * Get a service, auto-reconnecting via the provided config loader if
   * the instance is not cached (e.g. after hot-reload).
   */
  async getOrReconnect(
    connectionId: string,
    loadConfigs: ConfigLoader
  ): Promise<IDatabaseService | undefined> {
    const config = loadConfigs().find((cfg) => cfg.id === connectionId);
    if (!config) return undefined;
    const service = await this.create(config);
    await service.connect();
    return service;
  },

  has(connectionId: string): boolean {
    return serviceCache.has(connectionId);
  },

  remove(connectionId: string): boolean {
    const flight = pending.get(connectionId);
    if (flight) {
      flight.cancelled = true;
      pending.delete(connectionId);
    }
    const service = serviceCache.get(connectionId);
    serviceCache.delete(connectionId);
    if (service) void service.disconnect().catch(log.error);
    return !!service || !!flight;
  },

  async clearAll(): Promise<void> {
    for (const flight of pending.values()) flight.cancelled = true;
    const flights = [...pending.values()].map((flight) => flight.promise);
    pending.clear();
    const services = [...serviceCache.values()];
    serviceCache.clear();
    await Promise.allSettled([
      ...flights,
      ...services.map((service) => service.disconnect()),
    ]);
  },

  getConnectionIds(): string[] {
    return Array.from(serviceCache.keys());
  },

  getAllServices(): IDatabaseService[] {
    return Array.from(serviceCache.values());
  },
};

export default DatabaseServiceFactory;
