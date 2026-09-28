"""Consume Rust-produced response items; verify installed Codex over loopback.

Invoked by the ignored native_tool_output_rpc_round_trip Rust test. Uses a
temporary profile and a local model fixture, never real credentials/inference.
"""
import http.server
import json
import os
import pathlib
import queue
import subprocess
import sys
import tempfile
import threading
import time

items = json.load(sys.stdin)
requests = []


class Model(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(body)
        events = [
            {'type': 'response.created', 'response': {'id': 'probe'}},
            {'type': 'response.output_item.done', 'item': {'type': 'message',
                'role': 'assistant', 'id': 'msg_probe', 'content': [
                    {'type': 'output_text', 'text': 'OPAQUE_PROBE_OK'}]}},
            {'type': 'response.completed', 'response': {'id': 'probe', 'usage': {
                'input_tokens': 0, 'output_tokens': 0, 'total_tokens': 0,
                'input_tokens_details': None, 'output_tokens_details': None}}},
        ]
        data = ''.join('event: ' + e['type'] + '\ndata: ' + json.dumps(e) + '\n\n'
                       for e in events).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class App:
    def __init__(self, root):
        self.seq = 0
        self.responses = queue.Queue()
        self.events = []
        self.stderr = open(root / 'stderr.log', 'a')
        env = {'PATH': os.environ['PATH'], 'HOME': str(root / 'system-home'),
               'CODEX_HOME': str(root / 'profile'), 'TMPDIR': str(root / 'tmp')}
        sandbox = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
        self.process = subprocess.Popen([
            '/usr/bin/sandbox-exec', '-p', sandbox,
            os.environ['ORG2_TEST_CODEX_BIN'], 'app-server', '--stdio'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.stderr,
            text=True, cwd=root, env=env)
        threading.Thread(target=self.read, daemon=True).start()
        try:
            self.call('initialize', {'clientInfo': {'name': 'opaque-probe', 'version': '1'},
                                    'capabilities': {'experimentalApi': True}})
            self.send({'method': 'initialized', 'params': {}})
        except BaseException:
            self.close()
            raise

    def read(self):
        for line in self.process.stdout:
            self.responses.put(json.loads(line))

    def send(self, value):
        self.process.stdin.write(json.dumps(value) + '\n')
        self.process.stdin.flush()

    def call(self, method, params):
        self.seq += 1
        self.send({'id': self.seq, 'method': method, 'params': params})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            reply = self.responses.get(timeout=max(.1, deadline - time.monotonic()))
            if reply.get('id') == self.seq:
                assert 'error' not in reply, (method, reply)
                return reply['result']
            self.events.append(reply)
        raise TimeoutError(method)

    def complete(self):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            for event in self.events:
                if event.get('method') == 'turn/completed':
                    assert event['params']['turn']['status'] == 'completed', event
                    return
            self.events.append(self.responses.get(timeout=max(.1, deadline - time.monotonic())))
        raise TimeoutError('turn/completed')

    def close(self):
        self.process.terminate()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.stderr.close()


server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()
try:
    with tempfile.TemporaryDirectory(prefix='org2-opaque-native-') as directory:
        root = pathlib.Path(directory).resolve()
        for folder in ['system-home', 'profile', 'tmp']:
            (root / folder).mkdir()
        (root / 'profile/config.toml').write_text(f'''
model = "fixture"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
check_for_update_on_startup = false
[analytics]
enabled = false
[model_providers.fixture]
name = "Loopback fixture"
base_url = "http://127.0.0.1:{server.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
supports_websockets = false
''')
        for attempt in range(2):
            app = App(root)
            try:
                if attempt == 0:
                    started = app.call('thread/start', {'cwd': str(root),
                        'historyMode': 'paginated', 'approvalPolicy': 'never', 'sandbox': 'read-only'})
                    thread_id = started['thread']['id']
                    app.call('thread/inject_items', {'threadId': thread_id, 'items': items})
                else:
                    app.call('thread/resume', {'threadId': thread_id})
                app.call('turn/start', {'threadId': thread_id,
                    'input': [{'type': 'text', 'text': 'Reply OPAQUE_PROBE_OK; no tools.'}]})
                app.complete()
                actual = [item for item in requests[-1]['input']
                          if item.get('type') == 'function_call_output']
                expected = [item for item in items if item['type'] == 'function_call_output']
                # Codex adds its own fco_* result-item ID. Pairing and body
                # must remain exact; only this provider-owned field differs.
                actual = [{key: value for key, value in item.items() if key != 'id'}
                          for item in actual]
                assert actual == expected, ('native model request changed injected tool results', actual, expected)
                calls = [item for item in requests[-1]['input'] if item.get('type') == 'function_call']
                assert [item['id'] for item in calls] == [item['id'] for item in items if item['type'] == 'function_call']
            finally:
                app.close()
        assert len(requests) == 2, len(requests)
        rollouts = list((root / 'profile/sessions').rglob('*.jsonl'))
        assert len(rollouts) == 1, rollouts
        if len(sys.argv) > 1:
            pathlib.Path(sys.argv[1]).write_bytes(rollouts[0].read_bytes())
        print(json.dumps({'native_launches': 2, 'model_requests': 2,
                          'tool_results_per_request': len(expected), 'exact': True}))
finally:
    server.shutdown()
    server.server_close()
