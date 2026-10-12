const { test } = require("node:test");
const assert = require("node:assert/strict");
const { startFixture, scriptedResponse } = require("./provider-fixture-server.cjs");

test("fixture validates actual requests and can switch failure modes", async () => {
  const fixture = await startFixture();
  try {
    const send = (body) => fetch(`${fixture.url}/v1/chat/completions`, {
      method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
    });
    const mode = (value) => fetch(`${fixture.url}/control`, { method: "POST", body: JSON.stringify({ mode: value }) });
    const summary = { messages: [{ role: "system", content: "You write one final user-facing Agent Org report" }] };
    assert.equal((await send({ ...summary, tools: [] })).status, 400);
    assert.equal((await send({ ...summary, tool_choice: "auto" })).status, 400);
    assert.equal((await send(summary)).status, 200);
    await mode("lenient");
    assert.equal((await send({ ...summary, tools: [] })).status, 200);
    await mode("summary400");
    assert.equal((await send(summary)).status, 400);
    await mode("summary503");
    assert.equal((await send(summary)).status, 503);
    assert.equal((await send(summary)).status, 200);
    const records = await (await fetch(`${fixture.url}/records`)).json();
    assert.equal(records.count, 7);
    assert.equal(records.records[0].toolsPresent, true);
  } finally { await fixture.close(); }
});

test("fixture scripts real task tools rather than mutating domain state", () => {
  const reminder = { role: "user", content: [{ text: "<system-reminder>test environment</system-reminder>" }] };
  const result = scriptedResponse({ messages: [{ role: "user", content: "ORG_REQUEST_CONTRACT:normal" }, reminder],
    tools: [{ function: { name: "task_graph_create" } }] });
  assert.equal(result.tool_calls[0].function.name, "task_graph_create");
  const args = JSON.parse(result.tool_calls[0].function.arguments);
  assert.equal(args.tasks[0].owner_member_id, "sde-reviewer");
  assert.equal(scriptedResponse({ messages: [{ role: "user", content: "Task ID: abc-def" }],
    tools: [{ function: { name: "task_update" } }] }).tool_calls[0].function.name, "task_update");
  assert.equal(scriptedResponse({ messages: [
    { role: "user", content: "<inbox-batch>task done</inbox-batch>" },
    { role: "user", content: [{ text: "<system-reminder>state=`ready`</system-reminder>" }] },
  ], tools: [{ function: { name: "org_run_complete" } }] }).tool_calls[0].function.name, "org_run_complete");
});
