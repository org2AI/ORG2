#!/usr/bin/env node
// Loopback-only HTTP fixture: real clients, tools, scheduling and persistence.
const http = require("node:http");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");

const MODES = new Set(["strict", "lenient", "summary400", "summary503", "delay"]);
const text = (message) => typeof message.content === "string" ? message.content :
  (message.content ?? []).map((block) => block.text ?? "").join("\n");

function scriptedResponse(body) {
  const messages = body.messages ?? [];
  const names = new Set((body.tools ?? []).map((tool) => tool.function?.name));
  const system = messages.filter((m) => m.role === "system").map(text).join("\n");
  const context = messages.filter((m) => m.role === "system" || m.role === "user").map(text).join("\n");
  const lastUser = messages.findLastIndex((m) => m.role === "user" &&
    !text(m).includes("<system-reminder>"));
  const user = lastUser < 0 ? "" : text(messages[lastUser]);
  const results = messages.slice(lastUser + 1).filter((m) => m.role === "tool");
  const call = (name, args) => ({ role: "assistant", content: null, tool_calls: [{
    id: `fixture-${randomUUID()}`, type: "function",
    function: { name, arguments: JSON.stringify(args) },
  }] });
  if (system.includes("You write one final user-facing Agent Org report")) {
    return { role: "assistant", content: "Local verification task completed. Its certified text output is preserved." };
  }
  if (names.has("org_run_complete") && context.includes("state=`ready`") && !results.length) {
    return call("org_run_complete", { candidate_outcome: "delivered", summary: "Local task evidence verified", evidence_task_ids: [] });
  }
  const taskId = user.match(/Task ID:\s*([\w-]+)/)?.[1] ?? user.match(/task_id="([\w-]+)"/)?.[1];
  if (taskId && names.has("task_update")) {
    if (!results.length) return call("task_update", { operation: "start", id: taskId });
    if (results.length === 1) return call("task_update", { operation: "complete", id: taskId,
      output: { summary: "Local HTTP boundary checked", content: "LOCAL_TASK_EVIDENCE: output produced through the real task tool", artifact_ids: [] } });
  }
  if (user.includes("ORG_REQUEST_CONTRACT:") && names.has("task_graph_create") && !results.length) {
    return call("task_graph_create", { allow_parallel_with_existing_open_tasks: true,
      tasks: [{ key: "verification", subject: "Local HTTP contract verification", description: "Produce a text result for certification",
        owner_member_id: "sde-reviewer", execution_mode: "build" }] });
  }
  if (user.includes("FILE_REQUEST_CONTRACT") && names.has("run_shell") && !results.length) {
    return call("run_shell", { command: "printf 'LOCAL_FILE_EVIDENCE\\n' > verification.txt && cat verification.txt" });
  }
  return { role: "assistant", content: "Local fixture response complete." };
}

function startFixture({ port = 0, logPath = null } = {}) {
  let mode = "strict";
  let summaryFailures = 0;
  let count = 0;
  const timers = new Set();
  const records = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { response.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const json = (status, value) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    };
    if (request.url === "/v1/models" || request.url === "/models") {
      json(200, { object: "list", data: [{ id: "local-contract-model", object: "model", owned_by: "fixture" }] }); return;
    }
    if (request.url === "/control" && request.method === "POST") {
      let value;
      try { value = JSON.parse(Buffer.concat(chunks)); } catch { json(400, { error: "Invalid JSON" }); return; }
      if (!MODES.has(value.mode)) { json(400, { error: "Unknown mode" }); return; }
      mode = value.mode; summaryFailures = 0;
      json(200, { mode }); return;
    }
    if (request.url === "/records") { json(200, { mode, count, records }); return; }
    if (!request.url.endsWith("/chat/completions")) { json(404, { error: "Unknown route" }); return; }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks)); } catch { json(400, { error: { message: "Invalid JSON" } }); return; }
    const summary = (body.messages ?? []).some((m) => m.role === "system" && text(m).includes("You write one final user-facing Agent Org report"));
    const record = { id: ++count, time: new Date().toISOString(), mode, summary,
      toolsPresent: Object.hasOwn(body, "tools"), toolChoicePresent: Object.hasOwn(body, "tool_choice"),
      toolNames: (body.tools ?? []).map((tool) => tool.function?.name), body };
    records.push(record);
    if (records.length > 200) records.shift();
    const finish = (status) => { record.status = status; if (logPath) fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`); };
    const reject = (status, message, parameter) => {
      finish(status); json(status, { error: { message, type: "invalid_request_error", param: parameter } });
    };
    if (mode !== "lenient" && Array.isArray(body.tools) && body.tools.length === 0) {
      reject(400, "tools must not be an empty array", "tools"); return;
    }
    if (mode !== "lenient" && !body.tools?.length && body.tool_choice && body.tool_choice !== "none") {
      reject(400, "tool_choice requires tools", "tool_choice"); return;
    }
    if (summary && mode === "summary400") { reject(400, "Fixture rejects summary parameters", "fixture_parameter"); return; }
    if (summary && mode === "summary503" && summaryFailures++ === 0) { reject(503, "Temporarily unavailable", null); return; }
    const send = () => {
      if (response.destroyed) { finish("cancelled"); return; }
      const message = scriptedResponse(body);
      finish(200);
      const reason = message.tool_calls ? "tool_calls" : "stop";
      if (body.stream) {
        response.writeHead(200, { "content-type": "text/event-stream" });
        const delta = { ...message };
        delete delta.role;
        if (delta.tool_calls) delta.tool_calls = delta.tool_calls.map((tool, index) => ({ ...tool, index }));
        response.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}\n\ndata: [DONE]\n\n`);
      } else {
        json(200, { id: `fixture-${count}`, choices: [{ index: 0, message, finish_reason: reason }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
      }
    };
    if (summary && mode === "delay") {
      const timer = setTimeout(() => { timers.delete(timer); send(); }, 60000);
      timers.add(timer);
      response.once("close", () => { if (timers.delete(timer)) { clearTimeout(timer); finish("cancelled"); } });
    } else send();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({
      url: `http://127.0.0.1:${server.address().port}`,
      close: async () => { for (const timer of timers) clearTimeout(timer); timers.clear(); server.closeAllConnections(); await new Promise((done) => server.close(done)); },
    }));
  });
}

module.exports = { startFixture, scriptedResponse };
if (require.main === module) {
  startFixture({ port: Number(process.argv[2] ?? 18099), logPath: process.argv[3] ?? null }).then((fixture) => {
    console.log(`Provider fixture: ${fixture.url}/v1`);
    const stop = async () => { await fixture.close(); process.exit(0); };
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
  });
}
