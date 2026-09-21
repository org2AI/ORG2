"""Isolated native history probe: synthetic auth, temporary HOME, rejecting proxies.

Proxies are not an OS network sandbox. No live provider request is needed.
"""
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
args = parser.parse_args()
import asyncio,json,pathlib,tempfile,os,signal,time
ROOT=pathlib.Path(tempfile.mkdtemp(prefix='orgii-kiro-resume-'))
async def run(home,method,params):
 env={'HOME':str(home),'PATH':'/usr/bin:/bin','KIRO_API_KEY':'fixture-invalid','HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1','ALL_PROXY':'http://127.0.0.1:1','DO_NOT_TRACK':'1','AWS_EC2_METADATA_DISABLED':'true'}
 p=await asyncio.create_subprocess_exec(args.binary,'acp',env=env,cwd=str(ROOT),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=open(home/'stderr','wb'),start_new_session=True)
 async def rpc(i,m,pa):
  p.stdin.write((json.dumps({'jsonrpc':'2.0','id':i,'method':m,'params':pa})+'\n').encode());await p.stdin.drain()
  async def read():
   while line:=await p.stdout.readline():
    data=json.loads(line)
    if data.get('id')==i:return data
   raise RuntimeError('Kiro exited before response')
  return await asyncio.wait_for(read(),45)
 try:
  print('initialize',home.name,await rpc(1,'initialize',{'protocolVersion':1,'clientCapabilities':{},'clientInfo':{'name':'fixture','version':'1'}}),flush=True)
  result=await rpc(2,method,params);print(method,home.name,result,flush=True);return result
 finally:
  os.killpg(p.pid,signal.SIGTERM)
  try:await asyncio.wait_for(p.wait(),2)
  except asyncio.TimeoutError:os.killpg(p.pid,signal.SIGKILL);await p.wait()
async def main():
 history=ROOT/'history';history.mkdir()
 homes=[ROOT/'generation1',ROOT/'generation2']
 for h in homes:
  (h/'.kiro/sessions').mkdir(parents=True);(h/'.kiro/sessions/cli').symlink_to(history,target_is_directory=True)
 r=await run(homes[0],'session/new',{'cwd':str(ROOT),'mcpServers':[]})
 assert 'result' in r,r
 sid=r['result']['sessionId']
 print('history-files',[p.name for p in history.iterdir()],flush=True)
 r2=await run(homes[1],'session/load',{'sessionId':sid,'cwd':str(ROOT),'mcpServers':[]})
 assert 'result' in r2,r2
 print('PASS new -> process exit -> different HOME -> load same native session',flush=True)
 print('ARTIFACT_DIR='+str(ROOT),flush=True)
asyncio.run(main())
