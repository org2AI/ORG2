const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const html = fs.readFileSync("public/index.html", "utf8");
const tauriLifecycleSource = fs.readFileSync(
  "src-tauri/src/app/lifecycle.rs",
  "utf8"
);
const tauriSetupSource = fs.readFileSync(
  "src-tauri/src/app/setup_hook/state.rs",
  "utf8"
);
const firstPaintSignalSource = fs.readFileSync(
  "src/app/root/useFirstPaintSignal.ts",
  "utf8"
);
const scriptMatch = html.match(
  /<script nonce="orgii-codemirror-style">\s*\/\/ -+\s*\/\/ Splash hard-timeout watchdog[\s\S]*?\(function \(\) \{([\s\S]*?)\}\)\(\);\s*<\/script>/
);

function evaluateWatchdogMs({ protocol, hostname }) {
  assert.ok(scriptMatch, "startup watchdog script should be present");

  let timeoutMs;
  const context = {
    console: {
      info: () => {},
      warn: () => {},
    },
    document: {
      documentElement: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
    },
    performance: {
      now: () => 100,
    },
    setTimeout: (_callback, ms) => {
      timeoutMs = ms;
      return 1;
    },
    fetch: () =>
      Promise.resolve({
        ok: true,
        status: 200,
      }),
    HTMLLinkElement: class HTMLLinkElement {},
    HTMLScriptElement: class HTMLScriptElement {},
    window: {
      addEventListener: () => {},
      location: {
        hostname,
        pathname: "/",
        protocol,
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(`(function () {${scriptMatch[1]}})();`, context);

  return timeoutMs;
}

function evaluateClearedTimeoutsAfterSplashDone({ protocol, hostname }) {
  assert.ok(scriptMatch, "startup watchdog script should be present");

  let nextTimerId = 0;
  const scheduledTimers = [];
  const clearedTimers = [];
  const context = {
    console: {
      info: () => {},
      warn: () => {},
    },
    clearTimeout: (timerId) => {
      clearedTimers.push(timerId);
    },
    document: {
      documentElement: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: () => null,
    },
    performance: {
      now: () => 100,
    },
    setTimeout: (_callback, ms) => {
      nextTimerId += 1;
      scheduledTimers.push({ id: nextTimerId, ms });
      return nextTimerId;
    },
    fetch: () =>
      Promise.resolve({
        ok: true,
        status: 200,
      }),
    HTMLLinkElement: class HTMLLinkElement {},
    HTMLScriptElement: class HTMLScriptElement {},
    window: {
      addEventListener: () => {},
      location: {
        hostname,
        pathname: "/",
        protocol,
      },
    },
  };

  vm.createContext(context);
  vm.runInContext(`(function () {${scriptMatch[1]}})();`, context);
  context.window.__ORGII_SPLASH_DONE__();

  return { scheduledTimers, clearedTimers };
}

test("startup watchdog gives localhost dev server more time", () => {
  assert.equal(
    evaluateWatchdogMs({ protocol: "http:", hostname: "127.0.0.1" }),
    60000
  );
  assert.equal(
    evaluateWatchdogMs({ protocol: "http:", hostname: "localhost" }),
    60000
  );
});

test("startup watchdog keeps packaged/static startup timeout short", () => {
  assert.equal(
    evaluateWatchdogMs({ protocol: "tauri:", hostname: "localhost" }),
    20000
  );
  assert.equal(
    evaluateWatchdogMs({ protocol: "https:", hostname: "example.test" }),
    20000
  );
});

test("startup success cancels the watchdog and diagnostic probe timers", () => {
  const { scheduledTimers, clearedTimers } =
    evaluateClearedTimeoutsAfterSplashDone({
      protocol: "http:",
      hostname: "localhost",
    });

  assert.deepEqual(
    scheduledTimers.map((timer) => timer.ms),
    [5000, 60000]
  );
  assert.deepEqual(clearedTimers, [1, 2]);
});

test("startup success only has the watchdog timer outside local dev", () => {
  const { scheduledTimers, clearedTimers } =
    evaluateClearedTimeoutsAfterSplashDone({
      protocol: "tauri:",
      hostname: "localhost",
    });

  assert.deepEqual(
    scheduledTimers.map((timer) => timer.ms),
    [20000]
  );
  assert.deepEqual(clearedTimers, [1]);
});

test("retrying main script loader runs after the root element exists", () => {
  const retryLoaderIndex = html.indexOf("retryMainScriptLoad");
  const rootIndex = html.indexOf('<div id="root"></div>');

  assert.notEqual(retryLoaderIndex, -1);
  assert.notEqual(rootIndex, -1);
  assert.ok(
    rootIndex < retryLoaderIndex,
    "retrying loader should run after #root is parsed"
  );
  const loaderSource = html.slice(retryLoaderIndex);
  assert.match(loaderSource, /orgii_startup_attempt=/);
  assert.match(loaderSource, /fetch\("\/main\.js\?orgii_startup_attempt="/);
  assert.match(loaderSource, /URL\.createObjectURL/);
  assert.match(loaderSource, /URL\.revokeObjectURL/);
  assert.match(loaderSource, /main\.js loader timed out/);
  assert.match(loaderSource, /clearTimeout\(scriptTimeoutId\)/);
  assert.doesNotMatch(loaderSource, /htmlWebpackPlugin\.files\.js/);
  assert.doesNotMatch(loaderSource, /script\.textContent\s*=/);
});

test("native shutdown drains before requesting the final process exit", () => {
  assert.match(
    tauriLifecycleSource,
    /api\.prevent_exit\(\);[\s\S]*perform_bounded_shutdown[\s\S]*SHUTDOWN_READY_TO_EXIT[\s\S]*handle\.exit/
  );
});

test("first-paint startup logging is gated behind dev startup debug", () => {
  assert.match(
    tauriSetupSource,
    /if dev_startup_debug_enabled\(\) \{\s*app\.listen\("orgii-startup-first-paint"/
  );
});

test("frontend first-paint metric emit is gated to local dev", () => {
  assert.match(firstPaintSignalSource, /function isLocalDevOrigin\(\)/);
  assert.match(
    firstPaintSignalSource,
    /if \(!isLocalDevOrigin\(\)\) \{\s*return;\s*\}/
  );
});

test("frontend first-paint waits until the React root has content", () => {
  assert.match(firstPaintSignalSource, /function hasRenderableRootContent\(\)/);
  assert.match(firstPaintSignalSource, /root\.childElementCount > 0/);
  assert.match(firstPaintSignalSource, /new MutationObserver/);
  assert.match(firstPaintSignalSource, /observer\.disconnect\(\)/);
  assert.match(
    firstPaintSignalSource,
    /const stopObserving = afterRenderableRootContent/
  );
  assert.match(firstPaintSignalSource, /afterRenderableRootContent\(\(\) =>/);
});

function visibleDeadlineHarness(initialVisibility = "visible") {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Set();
  const document = {
    visibilityState: initialVisibility,
    documentElement: {},
    getElementById: () => null,
    addEventListener: (_name, listener) => listeners.add(listener),
    removeEventListener: (_name, listener) => listeners.delete(listener),
  };
  const context = {
    document,
    console: { info() {}, warn() {} },
    performance: { now: () => now },
    setTimeout(callback, delay) {
      const id = ++nextId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    window: {
      addEventListener() {},
      location: { protocol: "tauri:", hostname: "localhost", pathname: "/" },
    },
  };
  vm.runInNewContext(`(function () {${scriptMatch[1]}})();`, context);
  context.window.__ORGII_SPLASH_DONE__();
  return {
    start: context.window.__ORGII_VISIBLE_STARTUP_TIMEOUT__,
    timers,
    listeners,
    visibility(value) {
      document.visibilityState = value;
      for (const listener of [...listeners]) listener();
    },
    advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers])
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
    },
  };
}

test("hidden cold boot waits for visible time without a timer or a false failure", () => {
  const h = visibleDeadlineHarness("hidden");
  let failures = 0;
  h.start(() => failures++, 5000);
  assert.equal(h.timers.size, 0);
  h.advance(60000);
  assert.equal(failures, 0);
  h.visibility("visible");
  h.advance(4999);
  assert.equal(failures, 0);
  h.advance(1);
  assert.equal(failures, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
});

test("visible budget pauses across repeated hides and cancellation releases ownership", () => {
  const h = visibleDeadlineHarness();
  let failures = 0;
  const cancel = h.start(() => failures++, 5000);
  h.advance(2000);
  h.visibility("hidden");
  assert.equal(h.timers.size, 0);
  h.advance(60000);
  h.visibility("visible");
  h.advance(2999);
  assert.equal(failures, 0);
  cancel();
  assert.equal(h.timers.size, 0);
  assert.equal(h.listeners.size, 0);
  h.advance(10000);
  h.visibility("hidden");
  h.visibility("visible");
  assert.equal(failures, 0);
  assert.equal(h.timers.size, 0);
});
