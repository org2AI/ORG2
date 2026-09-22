const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyDevInstanceEnv,
  createDevInstanceProfile,
  createInstanceProfile,
  createInstanceProfileFromIdeServerPort,
  parseInstanceId,
} = require("./instance-profile.cjs");

test("dev identity cannot collide with primary or any numbered bundle", () => {
  const dev = createDevInstanceProfile();
  assert.equal(dev.identifier, "org2ai.org2.dev");
  assert.equal(dev.ideServerPort, 13946);
  assert.equal(dev.cliProxyPort, 17987);
  assert.equal(dev.authDeepLinkScheme, "orgii-dev");
  assert.match(dev.dataHome, /\.orgii$/);
  for (let id = 2; id <= 99; id++) {
    const bundle = createInstanceProfile(id);
    for (const key of [
      "identifier",
      "ideServerPort",
      "cliProxyPort",
      "authDeepLinkScheme",
      "dataHome",
    ]) {
      assert.notEqual(
        dev[key],
        bundle[key],
        `${key} collides with instance ${id}`
      );
    }
  }
});

test("dev frontend defaults agree with runtime ports and preserve explicit overrides", () => {
  const env = { PATH: "/test/bin" };
  assert.deepEqual(applyDevInstanceEnv(env), {
    PATH: "/test/bin",
    ORGII_IDE_SERVER_PORT: "13946",
    ORGII_CLI_PROXY_PORT: "17987",
    ORGII_DEEP_LINK_SCHEME: "orgii-dev",
  });
  assert.deepEqual(env, { PATH: "/test/bin" });
  const overrides = {
    ORGII_IDE_SERVER_PORT: "15000",
    ORGII_CLI_PROXY_PORT: "18000",
    ORGII_DEEP_LINK_SCHEME: "test-app",
    ORGII_HOME: "/test/home",
    ORGII_EXTERNAL_HISTORY_HOME: "/test/history",
  };
  assert.deepEqual(applyDevInstanceEnv(overrides), overrides);
});

test("instance 2 receives isolated identity, schemes, and ports", () => {
  const profile = createInstanceProfile("2");
  assert.equal(profile.identifier, "org2ai.org2.instance2");
  assert.equal(profile.authDeepLinkScheme, "orgii-instance2");
  assert.equal(profile.ideServerPort, 13848);
  assert.equal(profile.cliProxyPort, 17889);
  assert.match(profile.dataHome, /\.orgii-instance2$/);
});

test("primary and unbounded instance ids are rejected", () => {
  for (const value of [undefined, "1", "2.5", "100", "abc"]) {
    assert.throws(() => parseInstanceId(value));
  }
});

test("IDE server ports resolve through the canonical instance profile", () => {
  const profile = createInstanceProfileFromIdeServerPort("13848");
  assert.equal(profile.id, 2);
  assert.equal(profile.productName, "ORG2 Instance 2");
  assert.equal(profile.cliProxyPort, 17889);

  for (const value of [undefined, "13847", "13946", "not-a-port"]) {
    assert.throws(() => createInstanceProfileFromIdeServerPort(value));
  }
});
