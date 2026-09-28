import tempfile,pathlib,json,os,threading,http.server,uuid,re,copy,hashlib
from offline_fixture_capture import Capture, run_cli

capture=Capture()

def main():
 session=str(uuid.uuid4()); ids=[str(uuid.uuid4()) for _ in range(3)]; seen=[]
 class Handler(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args): pass
  def do_POST(self):
   body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))) or '{}');seen.append((self.path,body))
   if 'count_tokens' in self.path:
    payload=b'{"input_tokens":10}';self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(payload);return
   events=[('message_start',{'type':'message_start','message':{'id':'msg_fixture','type':'message','role':'assistant','model':'claude-sonnet-4-6','content':[],'stop_reason':None,'stop_sequence':None,'usage':{'input_tokens':10,'output_tokens':0}}}),('content_block_start',{'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}}),('content_block_delta',{'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'OFFLINE_FIXTURE_OK'}}),('content_block_stop',{'type':'content_block_stop','index':0}),('message_delta',{'type':'message_delta','delta':{'stop_reason':'end_turn','stop_sequence':None},'usage':{'output_tokens':5}}),('message_stop',{'type':'message_stop'})]
   payload=''.join('event: '+typ+'\ndata: '+json.dumps(value)+'\n\n' for typ,value in events).encode();self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
 server=http.server.HTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 with tempfile.TemporaryDirectory(prefix='org2-history-offline-') as td:
  root=pathlib.Path(td).resolve();home=root/'home';cwd=root/'work';home.mkdir();cwd.mkdir();config=home/'.claude';project=config/'projects'/re.sub('[^A-Za-z0-9]', '-', str(cwd));project.mkdir(parents=True)
  rows=[{'type':'user','uuid':ids[0],'parentUuid':None,'sessionId':session,'cwd':str(cwd),'timestamp':'2026-09-21T00:00:00.000Z','version':'2.1.275','isSidechain':False,'message':{'role':'user','content':'historical fixture'}},{'type':'attachment','uuid':ids[1],'parentUuid':ids[0],'sessionId':session,'cwd':str(cwd),'timestamp':'2026-09-21T00:00:00.001Z','version':'2.1.275','isSidechain':False,'attachment':{'type':'prompt_snapshot','systemPrompt':['OLD_SNAPSHOT_MARKER'],'tools':[{'name':'Read','description':'OLD_TOOL_MARKER','schema':{'type':'object','properties':{}}}]}},{'type':'assistant','uuid':ids[2],'parentUuid':ids[1],'sessionId':session,'cwd':str(cwd),'timestamp':'2026-09-21T00:00:00.002Z','version':'2.1.275','isSidechain':False,'message':{'role':'assistant','type':'message','id':'msg_old','model':'claude-sonnet-4-6','content':[{'type':'text','text':'historical response'}],'stop_reason':'end_turn','usage':{'input_tokens':1,'output_tokens':1}}},{'type':'last-prompt','sessionId':session,'leafUuid':ids[2],'lastPrompt':'historical fixture'}]
  # Preserve the original runtime context too; routing/configuration belongs
  # to each receiving profile and is exercised against its local endpoint.
  new_ids=[str(uuid.uuid4()) for _ in range(3)]
  new_user={**rows[0],'uuid':new_ids[0],'parentUuid':ids[2],'message':{'role':'user','content':'PACKAGE_USER_CONTEXT_MARKER'}}
  new_snapshot={**rows[1],'uuid':new_ids[1],'parentUuid':new_ids[0],'attachment':{'type':'prompt_snapshot','systemPrompt':['SOURCE_PACKAGE_PROMPT_MARKER'],'tools':[{'name':'Read','description':'SOURCE_PACKAGE_TOOL_MARKER','schema':{'type':'object','properties':{}}}]}}
  new_assistant={**rows[2],'uuid':new_ids[2],'parentUuid':new_ids[1],'message':{**rows[2]['message'],'id':'msg_package','content':[{'type':'text','text':'PACKAGE_ASSISTANT_CONTEXT_MARKER'}]}}
  rows += [new_user,new_snapshot,new_assistant,{'type':'last-prompt','sessionId':session,'leafUuid':new_ids[2],'lastPrompt':'PACKAGE_USER_CONTEXT_MARKER'}]
  fixture_path = os.environ.get('ORG2_PROJECTED_FIXTURE')
  if fixture_path:
   rows = [json.loads(line) for line in pathlib.Path(fixture_path).read_text().splitlines() if line]
   session = rows[0]['sessionId']
   for row in rows:
    if 'cwd' in row: row['cwd'] = str(cwd)
   print('rust_raw_fixture', True)
  transcript=project/(session+'.jsonl')
  transcript.write_text(''.join(json.dumps(r)+'\n' for r in rows));(home/'.claude.json').write_text(json.dumps({'hasCompletedOnboarding':True}));(config/'settings.json').write_text('{}')
  captured=capture.begin('resume',session,transcript)
  env={'PATH':'/usr/bin:/bin:/opt/homebrew/bin','HOME':str(home),'CLAUDE_CONFIG_DIR':str(config),'ANTHROPIC_API_KEY':'offline-fixture-key','ANTHROPIC_BASE_URL':'http://127.0.0.1:'+str(server.server_port),'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC':'1','DISABLE_TELEMETRY':'1','DISABLE_ERROR_REPORTING':'1','NO_PROXY':'127.0.0.1,localhost','TERM':'dumb'}
  sandbox='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
  args=['/usr/bin/sandbox-exec','-p',sandbox,os.environ.get('ORG2_CLAUDE_CLI','/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe'),'--resume',session,'--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--system-prompt','NEW_RUNTIME_MARKER','--tools','Read','--permission-mode','plan','--max-turns','1','--model','claude-sonnet-4-6','--output-format','json','-p','Reply fixture only']
  transcript, home, env = capture.handoff(captured, transcript, home, cwd, env)
  proc=run_cli(args,cwd=cwd,env=env);out=err=proc.stdout.encode()
  print('first_exit',proc.returncode,'requests',len(seen),'fixture_response',b'OFFLINE_FIXTURE_OK' in out)
  if proc.returncode != 0 and b'sandbox-exec:' in err: raise RuntimeError(err.decode(errors='replace')[:500])
  assert proc.returncode == 0 and b'OFFLINE_FIXTURE_OK' in out, err.decode(errors='replace')[:500]
  capture.snapshot(captured,transcript)
  transcript, home, env = capture.handoff(captured, transcript, home, cwd, env)
  proc=run_cli(args,cwd=cwd,env=env);out=err=proc.stdout.encode()
  print('second_exit',proc.returncode,'requests',len(seen),'fixture_response',b'OFFLINE_FIXTURE_OK' in out)
  if proc.returncode != 0 and b'sandbox-exec:' in err: raise RuntimeError(err.decode(errors='replace')[:500])
  assert proc.returncode == 0 and b'OFFLINE_FIXTURE_OK' in out, err.decode(errors='replace')[:500]
  capture.snapshot(captured,transcript)
  for path,body in seen:
   rendered=json.dumps(body.get('system'));print('request',path,'old_snapshot', 'OLD_SNAPSHOT_MARKER' in rendered,'new_runtime','NEW_RUNTIME_MARKER' in rendered,'tool_names',[x.get('name') for x in body.get('tools',[])], 'old_tool_schema', 'OLD_TOOL_MARKER' in json.dumps(body.get('tools',[])), 'source_prompt_leaked', 'SOURCE_PACKAGE_PROMPT_MARKER' in rendered, 'source_tool_leaked', 'SOURCE_PACKAGE_TOOL_MARKER' in json.dumps(body.get('tools',[])), 'package_user_context','PACKAGE_USER_CONTEXT_MARKER' in json.dumps(body.get('messages',[])), 'package_assistant_context','PACKAGE_ASSISTANT_CONTEXT_MARKER' in json.dumps(body.get('messages',[])))
  if not seen: print('error_summary',err.decode(errors='replace')[:500],out.decode(errors='replace')[:500])
 assert len([body for path, body in seen if 'count_tokens' not in path]) == 2
 for path, body in seen:
  if 'count_tokens' in path: continue
  assert 'SOURCE_PACKAGE_PROMPT_MARKER' in json.dumps(body.get('system'))
  assert 'SOURCE_PACKAGE_TOOL_MARKER' in json.dumps(body.get('tools'))
  assert 'SOURCE_DEFERRED_RUNTIME_MARKER' not in json.dumps(body)
  assert body.get('model') == 'claude-sonnet-4-6'
  assert 'PACKAGE_USER_CONTEXT_MARKER' in json.dumps(body.get('messages'))
  assert 'PACKAGE_ASSISTANT_CONTEXT_MARKER' in json.dumps(body.get('messages'))
 assert proc.returncode == 0
 server.shutdown()

if __name__ == "__main__":
 raise SystemExit(capture.run(main))
