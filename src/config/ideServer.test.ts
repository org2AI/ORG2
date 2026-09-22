import { afterEach, describe, expect, it } from "vitest";

import {
  IDE_SERVER_HTTP_URL,
  IDE_SERVER_PORT,
  IDE_SERVER_WS_URL,
  configureIdeServerForIdentifier,
  configureIdeServerToken,
  ideServerAuthHeaders,
  withIdeServerToken,
} from "./ideServer";

afterEach(() => {
  configureIdeServerForIdentifier("org2ai.org2");
  configureIdeServerToken("");
});

describe("configureIdeServerForIdentifier", () => {
  it("switches every local transport URL to the isolated backend", () => {
    expect(configureIdeServerForIdentifier("org2ai.org2.instance2")).toBe(
      13_848
    );
    expect(IDE_SERVER_PORT).toBe("13848");
    expect(IDE_SERVER_HTTP_URL).toBe("http://localhost:13848");
    expect(IDE_SERVER_WS_URL).toBe("ws://localhost:13848/ws");
  });
});

describe("local IDE server token", () => {
  it("adds nothing before the desktop boot has configured a token", () => {
    expect(ideServerAuthHeaders()).toEqual({});
    expect(withIdeServerToken("ws://localhost:13847/ws")).toBe(
      "ws://localhost:13847/ws"
    );
  });

  it("sends the token as a header for fetch", () => {
    configureIdeServerToken("launch-token");

    expect(ideServerAuthHeaders()).toEqual({ "x-orgii-token": "launch-token" });
  });

  it("appends the token to header-less transports without breaking the query", () => {
    configureIdeServerToken("a b&c");

    expect(withIdeServerToken("ws://localhost:13847/ws")).toBe(
      "ws://localhost:13847/ws?orgii_token=a%20b%26c"
    );
    expect(
      withIdeServerToken(
        "http://localhost:13847/git/x/push/stream?path=%2Frepo"
      )
    ).toBe(
      "http://localhost:13847/git/x/push/stream?path=%2Frepo&orgii_token=a%20b%26c"
    );
  });
});
