#!/usr/bin/env python3
import argparse, asyncio, base64, datetime, http.server, json, os, pathlib, signal, subprocess, tempfile, threading, time, urllib.parse
parser=argparse.ArgumentParser(description="Probe native Codex refresh using only synthetic credentials and a loopback mock.")
parser.add_argument('--binary',required=True,help='Absolute path to the native Codex executable')
ARGS=parser.parse_args()
BIN=str(pathlib.Path(ARGS.binary).resolve())
ROOT=pathlib.Path(tempfile.mkdtemp(prefix='orgii-native-refresh-'))

def jwt(account='A'):
 def enc(x): return base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
 return enc({'alg':'none'})+'.'+enc({'email':account+'@fixture.invalid','exp':int(time.time())+3600,'https://api.openai.com/auth':{'chatgpt_account_id':account,'chatgpt_user_id':'user-'+account,'chatgpt_plan_type':'plus'}})+'.fixture'

def auth(account='A',token='fixture-A-r0'):
 return {'OPENAI_API_KEY':None,'tokens':{'access_token':jwt(account),'id_token':jwt(account),'refresh_token':token,'account_id':account},'last_refresh':datetime.datetime.now(datetime.timezone.utc).isoformat()}

def save(home,data):
 p=home/'auth.next';p.write_text(json.dumps(data));p.chmod(0o600);p.replace(home/'auth.json')

class State:
 def __init__(self):
  self.calls=[];self.block=False;self.enter=threading.Event();self.release=threading.Event();self.lock=threading.Lock();self.used=set();self.reject_duplicates=True;self.blocked_network=[]
S=State()
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a): pass
 def do_CONNECT(self):
  S.blocked_network.append(self.path);self.send_error(502)
 def do_GET(self):
  S.blocked_network.append(self.path);self.send_error(502)
 def do_POST(self):
  if self.path!='/token':
   S.blocked_network.append(self.path);self.send_error(502);return
  body=self.rfile.read(int(self.headers.get('content-length',0))).decode()
  try: data=json.loads(body)
  except ValueError:data={k:v[0] for k,v in urllib.parse.parse_qs(body).items()}
  token=data.get('refresh_token');account=(token or 'fixture-A-r0').split('-')[1]
  with S.lock:
   duplicate=token in S.used;S.used.add(token);number=len(S.calls)+1
   S.calls.append({'refresh_token':token,'duplicate':duplicate,'time':time.monotonic()})
  S.enter.set()
  if S.block:S.release.wait(12)
  if duplicate and S.reject_duplicates:code=400;out={'error':{'code':'refresh_token_reused','message':'fixture refresh token already used','type':'invalid_grant'}}
  else:code=200;out={'access_token':jwt(account),'id_token':jwt(account),'refresh_token':f'fixture-{account}-r{number}','token_type':'Bearer','expires_in':3600}
  raw=json.dumps(out).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers()
  try:self.wfile.write(raw)
  except (BrokenPipeError,ConnectionResetError):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}'

class Client:
 async def start(self,home,label):
  self.label=label;self.home=home;self.seq=1;self.pending={};self.notes=[]
  env={'PATH':'/usr/bin:/bin:/opt/homebrew/bin','HOME':str(ROOT/'user'),'CODEX_HOME':str(home),'TMPDIR':str(ROOT),'CODEX_REFRESH_TOKEN_URL_OVERRIDE':URL+'/token','CODEX_AUTHAPI_BASE_URL':URL+'/accounts','HTTP_PROXY':URL,'HTTPS_PROXY':URL,'ALL_PROXY':URL,'http_proxy':URL,'https_proxy':URL,'all_proxy':URL,'NO_PROXY':'127.0.0.1,localhost','no_proxy':'127.0.0.1,localhost','RUST_LOG':'codex_login=debug,codex_core::auth=debug'}
  self.err=open(ROOT/(label+'.stderr'),'wb')
  self.p=await asyncio.create_subprocess_exec(BIN,'-c','cli_auth_credentials_store="file"','-c','analytics.enabled=false','app-server',stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=self.err,env=env,cwd=str(ROOT),start_new_session=True)
  self.reader=asyncio.create_task(self.read())
  await self.rpc('initialize',{'clientInfo':{'name':'orgii_fixture','version':'1.0.0'}})
  self.send({'method':'initialized','params':{}})
  return self
 def send(self,data):self.p.stdin.write((json.dumps(data)+'\n').encode())
 async def read(self):
  async for line in self.p.stdout:
   try:data=json.loads(line)
   except ValueError:continue
   f=self.pending.get(data.get('id'))
   if f is not None and not f.done():f.set_result(data)
   else:self.notes.append(data)
 async def rpc(self,method,params):
  n=self.seq;self.seq+=1;f=asyncio.get_running_loop().create_future();self.pending[n]=f;self.send({'id':n,'method':method,'params':params})
  try:return await asyncio.wait_for(f,15)
  finally:self.pending.pop(n,None)
 async def refresh(self):return await self.rpc('account/read',{'refreshToken':True})
 async def stop(self):
  if self.p.returncode is None:
   os.killpg(self.p.pid,signal.SIGTERM)
   try:await asyncio.wait_for(self.p.wait(),2)
   except asyncio.TimeoutError:os.killpg(self.p.pid,signal.SIGKILL);await self.p.wait()
  await self.reader;self.err.close()

async def entered():
 for _ in range(500):
  if S.enter.is_set():return
  await asyncio.sleep(.01)
 raise RuntimeError('mock endpoint not reached')

def home(name):
 p=ROOT/name;p.mkdir();save(p,auth());return p

def snap(h):
 if not (h/'auth.json').exists():return None
 t=json.loads((h/'auth.json').read_text())['tokens']
 claims=json.loads(base64.urlsafe_b64decode(t['id_token'].split('.')[1]+'==='))
 return {'account_id':t.get('account_id'),'token_account_id':claims['https://api.openai.com/auth']['chatgpt_account_id'],'refresh_token':t['refresh_token']}

async def case(name,fn):
 global S
 S=State();clients=[]
 async def start(h,label):
  c=Client();clients.append(c);return await c.start(h,name+'-'+label)
 try:
  result=await fn(start)
  result.update(case=name,calls=S.calls,blocked_network=S.blocked_network)
  print(json.dumps(result),flush=True)
  return result
 finally:
  S.release.set()
  for c in clients:await c.stop()

async def single(start):
 h=home('single');c=await start(h,'c');response=await c.refresh()
 return {'response':response,'final':snap(h)}

async def concurrent(start):
 h=home('concurrent');a=await start(h,'a');b=await start(h,'b');S.block=True
 t1=asyncio.create_task(a.refresh());await entered();t2=asyncio.create_task(b.refresh());await asyncio.sleep(1)
 before=len(S.calls);S.release.set();responses=await asyncio.gather(t1,t2)
 return {'calls_before_release':before,'responses':responses,'final':snap(h)}

async def stale(start):
 h=home('stale');a=await start(h,'a');b=await start(h,'b')
 r1=await a.refresh();r2=await b.refresh()
 return {'responses':[r1,r2],'final':snap(h)}

async def switch(start):
 h=home('switch');a=await start(h,'a');S.block=True;t=asyncio.create_task(a.refresh());await entered();save(h,auth('B','fixture-B-r0'));S.release.set();r=await t
 return {'response':r,'final':snap(h)}

async def same_process(start):
 h=home('same-process');a=await start(h,'a');S.block=True
 t1=asyncio.create_task(a.refresh());await entered();t2=asyncio.create_task(a.refresh());await asyncio.sleep(1);before=len(S.calls);S.release.set();rs=await asyncio.gather(t1,t2)
 return {'calls_before_release':before,'responses':rs,'final':snap(h)}

async def logout(start):
 h=home('logout');a=await start(h,'a');S.block=True;t=asyncio.create_task(a.refresh());await entered();(h/'auth.json').unlink();S.release.set();r=await t
 return {'response':r,'final':snap(h)}

async def separate(start):
 ha=home('separate-a');hb=home('separate-b');a=await start(ha,'a');b=await start(hb,'b');S.block=True
 t1=asyncio.create_task(a.refresh());await entered();t2=asyncio.create_task(b.refresh());await asyncio.sleep(1);before=len(S.calls);S.release.set();rs=await asyncio.gather(t1,t2)
 return {'calls_before_release':before,'responses':rs,'final_a':snap(ha),'final_b':snap(hb)}

async def cancel(start):
 h=home('cancel');a=await start(h,'a');S.block=True;t=asyncio.create_task(a.refresh());await entered();await a.stop();t.cancel()
 try:await t
 except asyncio.CancelledError:pass
 S.release.set();await asyncio.sleep(.1)
 b=await start(h,'b');r=await b.refresh()
 return {'process_exited':a.p.returncode is not None,'recovery_response':r,'final':snap(h)}

async def main():
 (ROOT/'user').mkdir();results=[]
 for name,fn in [('single',single),('concurrent',concurrent),('stale',stale),('switch',switch),('same-process',same_process),('logout',logout),('separate',separate),('cancel',cancel)]:
  results.append(await case(name,fn))
 (ROOT/'results.json').write_text(json.dumps(results,indent=2))
 print('ARTIFACT_DIR='+str(ROOT),flush=True)
try:asyncio.run(main())
finally:server.shutdown()
