"""Isolated native history probe: synthetic auth, temporary HOME, rejecting proxies.

Proxies are not an OS network sandbox. No live provider request is needed.
"""
import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--binary", required=True)
args = parser.parse_args()
import asyncio,json,pathlib,tempfile,os,signal,uuid,datetime
ROOT=pathlib.Path(tempfile.mkdtemp(prefix='orgii-codex-resume-'))
SID=str(uuid.uuid4());history=ROOT/'history';history.mkdir();stamp='2026-09-20T00:00:00Z'
rollout=history/f'rollout-2026-09-20T00-00-00-{SID}.jsonl'
rows=[{'timestamp':stamp,'type':'session_meta','payload':{'id':SID,'timestamp':stamp,'cwd':str(ROOT),'originator':'fixture','cli_version':'0.154.0','source':'cli','model_provider':'openai'}},{'timestamp':stamp,'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'fixture conversation'}]}},{'timestamp':stamp,'type':'response_item','payload':{'type':'message','role':'assistant','content':[{'type':'output_text','text':'fixture reply'}]}}]
rows.insert(1, {'timestamp':stamp,'type':'event_msg','payload':{'type':'task_started','turn_id':'fixture-turn'}})
rows.insert(2, {'timestamp':stamp,'type':'event_msg','payload':{'type':'user_message','message':'fixture conversation','images':[],'local_images':[]}})
rows.append({'timestamp':stamp,'type':'event_msg','payload':{'type':'agent_message','message':'fixture reply'}})
rows.append({'timestamp':stamp,'type':'event_msg','payload':{'type':'task_complete','turn_id':'fixture-turn','last_agent_message':'fixture reply'}})
rollout.write_text(''.join(json.dumps(r)+'\n' for r in rows))
async def run(home):
 home.mkdir();(home/'sessions').symlink_to(history,target_is_directory=True)
 env={'HOME':str(ROOT),'CODEX_HOME':str(home),'PATH':'/usr/bin:/bin','OPENAI_API_KEY':'fixture-invalid','HTTP_PROXY':'http://127.0.0.1:1','HTTPS_PROXY':'http://127.0.0.1:1','ALL_PROXY':'http://127.0.0.1:1'}
 p=await asyncio.create_subprocess_exec(args.binary,'-c','cli_auth_credentials_store="file"','app-server',env=env,cwd=str(ROOT),stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=open(home/'stderr','wb'),start_new_session=True)
 async def rpc(i,m,pa):
  p.stdin.write((json.dumps({'id':i,'method':m,'params':pa})+'\n').encode());await p.stdin.drain()
  async def read():
   while line:=await p.stdout.readline():
    d=json.loads(line)
    if d.get('id')==i:return d
   raise RuntimeError('exit')
  return await asyncio.wait_for(read(),20)
 try:
  await rpc(1,'initialize',{'clientInfo':{'name':'fixture','version':'1'}})
  p.stdin.write(b'{"method":"initialized","params":{}}\n');await p.stdin.drain()
  result=await rpc(2,'thread/resume',{'threadId':SID,'model':'gpt-5.4'})
  print(home.name,json.dumps(result),flush=True);assert 'result' in result,result
  read=await rpc(3,'thread/read',{'threadId':SID,'includeTurns':True})
  assert 'fixture conversation' in json.dumps(read) and 'fixture reply' in json.dumps(read),read
  print(home.name,'historical user and assistant content confirmed',flush=True)
 finally:
  os.killpg(p.pid,signal.SIGTERM)
  try:await asyncio.wait_for(p.wait(),2)
  except asyncio.TimeoutError:os.killpg(p.pid,signal.SIGKILL);await p.wait()
async def main():
 await run(ROOT/'generation1');await run(ROOT/'generation2');print('PASS thread/resume across separate CODEX_HOMEs');print('ARTIFACT_DIR='+str(ROOT))
asyncio.run(main())
