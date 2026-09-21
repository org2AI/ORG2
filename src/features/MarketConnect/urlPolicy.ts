const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const APP_SCHEME = process.env.ORGII_DEEP_LINK_SCHEME ?? "orgii";
const CONSOLE_ORIGIN =
  process.env.ORGII_MARKET_CONSOLE_ORIGIN ?? "https://market.org2.dev";

export function marketConsoleUrl(pathname = "/buyer/connect"): string {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("Invalid Market path");
  }
  const url = new URL(pathname, CONSOLE_ORIGIN);
  const expected = new URL(CONSOLE_ORIGIN);
  if (url.origin !== expected.origin) throw new Error("Invalid Market origin");
  return url.toString();
}

export function isMarketAppUrl(url: URL): boolean {
  return url.hostname === "market" && url.protocol === `${APP_SCHEME}:`;
}

export function isTrustedMarketPage(url: URL, pathname: string): boolean {
  const expected = new URL(CONSOLE_ORIGIN);
  const transport =
    expected.protocol === "https:" ||
    (expected.protocol === "http:" && LOCAL_HOSTS.has(expected.hostname));
  return (
    transport &&
    url.origin === expected.origin &&
    url.pathname === pathname &&
    !url.username &&
    !url.password &&
    !url.hash
  );
}
