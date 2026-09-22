"""Offline official CLI audit: completed historical tools must never execute.
Only temporary fixture state and localhost fake Anthropic responses are used.
"""
import http.server
import json
import os
from pathlib import Path
import re
import shlex
import signal
import subprocess
import tempfile
import threading
import uuid

CLI = '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe'
SANDBOX = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'


def run_case(kind):
    with tempfile.TemporaryDirectory(prefix='org2-completed-tools-') as directory:
        root = Path(directory).resolve()
        home, cwd = root / 'home', root / 'work'
        home.mkdir()
        cwd.mkdir()
        config = home / '.claude'
        project = config / 'projects' / re.sub('[^A-Za-z0-9]', '-', str(cwd))
        project.mkdir(parents=True)
        hook_log = root / 'tool-events.txt'
        read_fixture = cwd / 'read-fixture.txt'
        read_fixture.write_text('FRESH_READ_CALIBRATION_MARKER')
        hook = root / 'record-hook.py'
        hook.write_text('import pathlib,sys,json\nvalue=json.load(sys.stdin)\npathlib.Path(' + repr(str(hook_log)) + ').open("a").write(value.get("tool_name", "unknown")+"\\n")\n')
        settings = {'hooks': {'PreToolUse': [{'matcher': '.*', 'hooks': [{'type': 'command', 'command': '/usr/bin/python3 ' + shlex.quote(str(hook))}]}]}}
        (home / '.claude.json').write_text(json.dumps({'hasCompletedOnboarding': True}))
        (config / 'settings.json').write_text('{}')
        session = str(uuid.uuid4())
        rows = []
        parent = None

        def add(record_type, **fields):
            nonlocal parent
            ident = str(uuid.uuid4())
            row = {'type': record_type, 'uuid': ident, 'parentUuid': parent, 'sessionId': session,
                   'cwd': str(cwd), 'timestamp': '2026-09-21T00:00:00.000Z', 'version': '2.1.275', 'isSidechain': False, **fields}
            rows.append(row)
            parent = ident

        add('user', message={'role': 'user', 'content': 'Historical tool fixture'})
        add('attachment', attachment={'type': 'prompt_snapshot', 'systemPrompt': ['TARGET_SYSTEM_MARKER'], 'tools': []})
        tool_ids = ['tool_historical_one', 'tool_historical_two'] if kind == 'parallel' else ['tool_historical_one']
        tool_name = {'bash': 'Bash', 'edit': 'Edit', 'write': 'Write', 'glob': 'Glob', 'grep': 'Grep'}.get(kind, 'Read')
        tool_input = {'file_path': str(read_fixture)}
        if tool_name == 'Bash': tool_input = {'command': 'printf HISTORICAL_COMMAND_MUST_NOT_RUN'}
        if tool_name == 'Edit': tool_input.update({'old_string': 'FRESH_READ_CALIBRATION_MARKER', 'new_string': 'SHOULD_NOT_EDIT'})
        if tool_name == 'Write': tool_input.update({'content': 'SHOULD_NOT_WRITE'})
        if tool_name == 'Glob': tool_input = {'pattern': '*.txt', 'path': str(cwd)}
        if tool_name == 'Grep': tool_input = {'pattern': 'FRESH_READ', 'path': str(read_fixture)}
        if kind != 'calibration':
            add('assistant', message={'role': 'assistant', 'type': 'message', 'id': 'msg_old_tools', 'model': 'claude-sonnet-4-6',
                'content': [{'type': 'tool_use', 'id': ident, 'name': tool_name, 'input': tool_input} for ident in tool_ids],
                'stop_reason': 'tool_use', 'usage': {'input_tokens': 1, 'output_tokens': 1}})
            result_content = 'HISTORICAL_RESULT_MARKER'
            if kind == 'text_blocks':
                result_content = [{'type': 'text', 'text': 'HISTORICAL_RESULT_MARKER'}]
            add('user', message={'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': ident,
                'is_error': kind == 'error', 'content': result_content} for ident in tool_ids]})
            add('assistant', message={'role': 'assistant', 'type': 'message', 'id': 'msg_old_done', 'model': 'claude-sonnet-4-6',
                'content': [{'type': 'text', 'text': 'HISTORICAL_ASSISTANT_CONTEXT'}], 'stop_reason': 'end_turn',
                'usage': {'input_tokens': 1, 'output_tokens': 1}})
        else:
            add('assistant', message={'role': 'assistant', 'type': 'message', 'id': 'msg_old_done', 'model': 'claude-sonnet-4-6',
                'content': [{'type': 'text', 'text': 'Calibration baseline'}], 'stop_reason': 'end_turn', 'usage': {'input_tokens': 1, 'output_tokens': 1}})
        rows.append({'type': 'last-prompt', 'sessionId': session, 'leafUuid': parent, 'lastPrompt': 'fixture'})
        supplied = os.environ.get('ORG2_PROJECTED_TOOL_FIXTURE')
        if supplied and kind == 'success':
            rows = [json.loads(raw) for raw in Path(supplied).read_text().splitlines() if raw]
            session = rows[0]['sessionId']
            for row in rows:
                if 'cwd' in row: row['cwd'] = str(cwd)
            print('rust_completed_tool_projection_fixture', True)
        (project / (session + '.jsonl')).write_text(''.join(json.dumps(row) + '\n' for row in rows))
        requests = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))) or '{}')
                if 'count_tokens' in self.path:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json')
                    self.end_headers()
                    self.wfile.write(b'{"input_tokens":10}')
                    return
                requests.append(body)
                fresh_tool = kind == 'calibration' and len(requests) == 1
                block = {'type': 'tool_use', 'id': 'tool_fresh_calibration', 'name': 'Read', 'input': {}} if fresh_tool else {'type': 'text', 'text': ''}
                delta = {'type': 'input_json_delta', 'partial_json': json.dumps({'file_path': str(read_fixture)})} if fresh_tool else {'type': 'text_delta', 'text': 'OFFLINE_FIXTURE_OK'}
                events = [
                    ('message_start', {'type': 'message_start', 'message': {'id': 'msg_fixture_' + str(len(requests)), 'type': 'message', 'role': 'assistant', 'model': 'claude-sonnet-4-6', 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 10, 'output_tokens': 0}}}),
                    ('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': block}),
                    ('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': delta}),
                    ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
                    ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'tool_use' if fresh_tool else 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 5}}),
                    ('message_stop', {'type': 'message_stop'})]
                payload = ''.join('event: ' + typ + '\ndata: ' + json.dumps(value) + '\n\n' for typ, value in events).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        env = {'PATH': '/usr/bin:/bin:/opt/homebrew/bin', 'HOME': str(home), 'CLAUDE_CONFIG_DIR': str(config),
               'ANTHROPIC_API_KEY': 'offline-fixture-key', 'ANTHROPIC_BASE_URL': 'http://127.0.0.1:' + str(server.server_port),
               'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_TELEMETRY': '1', 'DISABLE_ERROR_REPORTING': '1', 'NO_PROXY': '127.0.0.1,localhost', 'TERM': 'dumb'}
        args = ['/usr/bin/sandbox-exec', '-p', SANDBOX, CLI, '--resume', session, '--setting-sources', '', '--settings', json.dumps(settings),
                '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', 'Read,Bash,Edit,Write,Glob,Grep', '--permission-mode', 'plan', '--max-turns', '2',
                '--model', 'claude-sonnet-4-6', '--output-format', 'json', '-p', 'Reply fixture only; do not use tools.']
        runs = 1 if kind == 'calibration' else 2
        for _ in range(runs):
            proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            try:
                out, err = proc.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                out, err = proc.communicate()
                raise AssertionError('fixture timed out')
            assert proc.returncode == 0, err.decode(errors='replace')[:500]
            assert b'OFFLINE_FIXTURE_OK' in out, out.decode(errors='replace')[:500]
        events = hook_log.read_text().splitlines() if hook_log.exists() else []
        if kind == 'calibration':
            assert len(requests) == 2 and events == ['Read'], (len(requests), events)
            assert 'FRESH_READ_CALIBRATION_MARKER' in json.dumps(requests[-1]['messages'])
        else:
            assert len(requests) == 2 and not events, (len(requests), events)
            for request in requests:
                blocks = [block for message in request['messages'] for block in message.get('content', []) if isinstance(message.get('content'), list)]
                observed_uses = [block for block in blocks if block.get('type') == 'tool_use']
                observed_results = [block for block in blocks if block.get('type') == 'tool_result']
                assert {block['id'] for block in observed_uses} == set(tool_ids)
                assert {block['tool_use_id'] for block in observed_results} == set(tool_ids)
                assert all(block.get('is_error', False) == (kind == 'error') for block in observed_results)
                assert 'HISTORICAL_RESULT_MARKER' in json.dumps(observed_results)
                assert 'FRESH_READ_CALIBRATION_MARKER' not in json.dumps(observed_results)
                assert 'HISTORICAL_ASSISTANT_CONTEXT' in json.dumps(request['messages'])
        assert read_fixture.read_text() == 'FRESH_READ_CALIBRATION_MARKER'
        print(json.dumps({'case': kind, 'requests': len(requests), 'tool_execution_events': events, 'passed': True}))
        server.shutdown()


for case in ['calibration', 'success', 'error', 'parallel', 'text_blocks', 'bash', 'edit', 'write', 'glob', 'grep']:
    run_case(case)
