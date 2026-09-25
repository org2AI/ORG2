#!/usr/bin/env python3
"""Production Rust engine / installed native Codex integration regression.

Build: cargo build --manifest-path src-tauri/Cargo.toml -p agent_cli --example codex_history_probe
Run: python3 src-tauri/crates/agent-cli/examples/codex_history_native_probe.py --engine src-tauri/target/debug/examples/codex_history_probe --live-writers
Add --fork for native history_base lineage transfer, or --cold-target for an
empty profile initialized by zero-inference native RPC. --last-write-wins tests
raw revision ordering, simultaneous branches, resume-only later writes and stable repeats. Requires Python 3.10+.

Only temporary profiles and a loopback mock model are used. This is not GUI
acceptance. Artifacts are written under cwd/.local/codex-history-native-probe.
"""
import argparse, hashlib, http.server, json, os, pathlib, queue, signal, sqlite3, subprocess, sys, threading, time, traceback

ROOT = pathlib.Path.cwd() / '.local' / 'codex-history-native-probe'
ROOT.mkdir(parents=True, exist_ok=True)
RUN = ROOT / (time.strftime('run-%Y%m%d-%H%M%S') + '-' + str(os.getpid()))
RUN.mkdir()
BIN = '/Applications/ChatGPT.app/Contents/Resources/codex'
REQUESTS = []
PROCESSES = []
RESULT = {}
MODEL_HOLD_ENTERED = threading.Event()
MODEL_HOLD_RELEASE = threading.Event()

class Mock(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        body = b'{"object":"list","data":[]}'
        self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
        REQUESTS.append({'path':self.path,'model':body.get('model'),'input':body.get('input')})
        n = len(REQUESTS); rid = f'probe-response-{n}'
        if 'SOURCE_INFLIGHT_HOLD' in json.dumps(body):
            MODEL_HOLD_ENTERED.set()
            if not MODEL_HOLD_RELEASE.wait(timeout=45):
                self.send_error(504, 'Native probe model gate timed out')
                return
        events = [
            {'type':'response.created','response':{'id':rid}},
            {'type':'response.output_item.done','item':{'type':'message','role':'assistant','id':f'msg-{n}','content':[{'type':'output_text','text':f'LOCAL_PROBE_REPLY_{n}'}]}},
            {'type':'response.completed','response':{'id':rid,'usage':{'input_tokens':0,'input_tokens_details':None,'output_tokens':0,'output_tokens_details':None,'total_tokens':0}}}
        ]
        data = ''.join('event: '+e['type']+'\ndata: '+json.dumps(e)+'\n\n' for e in events).encode()
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(data))); self.end_headers(); self.wfile.write(data)

SERVER = http.server.ThreadingHTTPServer(('127.0.0.1',0), Mock)
threading.Thread(target=SERVER.serve_forever,daemon=True).start()
PORT = SERVER.server_address[1]

def config(home, provider, model):
    home.mkdir(parents=True,exist_ok=True)
    (home/'config.toml').write_text(f'''model = "{model}"
model_provider = "{provider}"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
check_for_update_on_startup = false
[analytics]
enabled = false
[model_providers.{provider}]
name = "Local probe {provider}"
base_url = "http://127.0.0.1:{PORT}/{provider}/v1"
wire_api = "responses"
requires_openai_auth = false
request_max_retries = 0
stream_max_retries = 0
supports_websockets = false
''')

class App:
    def __init__(self,home,label):
        self.home=home; self.label=label; self.seq=0; self.q=queue.Queue(); self.events=[]
        self.log=open(RUN/(label+'-rpc.jsonl'),'w'); self.err=open(RUN/(label+'-stderr.log'),'w')
        env={'HOME':str(home.parent/'system-home'),'CODEX_HOME':str(home),'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','USER':'codex-history-probe','LOGNAME':'codex-history-probe','TMPDIR':str(RUN/'tmp')}
        pathlib.Path(env['HOME']).mkdir(exist_ok=True); pathlib.Path(env['TMPDIR']).mkdir(exist_ok=True)
        sandbox='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))'
        self.p=subprocess.Popen(['/usr/bin/sandbox-exec','-p',sandbox,BIN,'-c','cli_auth_credentials_store="file"','app-server','--stdio'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.err,text=True,env=env,cwd=RUN,start_new_session=True)
        PROCESSES.append(self)
        threading.Thread(target=self.read,daemon=True).start()
        self.call('initialize',{'clientInfo':{'name':'codex-history-probe','version':'1.0.0'},'capabilities':{'experimentalApi':True}})
        self.send({'method':'initialized','params':{}})
    def read(self):
        for line in self.p.stdout:
            self.log.write(line); self.log.flush()
            try: self.q.put(json.loads(line))
            except ValueError: pass
    def send(self,obj):
        self.p.stdin.write(json.dumps(obj)+'\n'); self.p.stdin.flush()
    def call(self,method,params,timeout=35):
        self.seq+=1; seq=self.seq; self.send({'id':seq,'method':method,'params':params}); end=time.monotonic()+timeout
        while time.monotonic()<end:
            obj=self.q.get(timeout=max(.1,end-time.monotonic()))
            if obj.get('id')==seq:
                if 'error' in obj: raise RuntimeError(method+': '+json.dumps(obj['error']))
                return obj['result']
            self.events.append(obj)
        raise TimeoutError(method)
    def completed(self,tid,timeout=35):
        return self.notification('turn/completed',tid,timeout)
    def notification(self,method,tid,timeout=35):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            for i,e in enumerate(self.events):
                if e.get('method')==method and e.get('params',{}).get('threadId')==tid:
                    return self.events.pop(i)
            self.events.append(self.q.get(timeout=max(.1,end-time.monotonic())))
        raise TimeoutError(method)
    def try_call(self,method,params):
        try:return self.call(method,params)
        except RuntimeError as e:return {'probeError':str(e)}
    def close(self):
        if self.p.poll() is None:
            os.killpg(self.p.pid,signal.SIGTERM)
            try:self.p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(self.p.pid,signal.SIGKILL);self.p.wait(timeout=1)
        try:os.killpg(self.p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        self.log.close();self.err.close()

def dbrows(home,tid):
    with sqlite3.connect(home/'state_5.sqlite') as db:
        db.row_factory=sqlite3.Row
        row=db.execute('select * from threads where id=?',(tid,)).fetchone()
        return dict(row) if row else None

def inventory(home):
    out={}
    for p in home.rglob('*.sqlite'):
        with sqlite3.connect(p) as db:
            tables=[r[0] for r in db.execute("select name from sqlite_master where type='table' order by name")]
            out[str(p.relative_to(home))]={t:db.execute('select count(*) from "'+t+'"').fetchone()[0] for t in tables}
    return out

def schema_evidence(home):
    """Only structural metadata; the production Rust adapter owns compatibility.

    Keep observed migrations/columns/keys/triggers for diagnosing a red canary.
    No second Python schema allowlist, native row data or prompt is published.
    """
    observed={}
    databases=list(home.glob('*.sqlite'))
    if len(databases)>16: return {'inspectionError':'database inventory exceeds bound'}
    for path in databases:
        with sqlite3.connect(path.resolve().as_uri()+'?mode=ro',uri=True) as db:
            tables=[row[0] for row in db.execute("select name from sqlite_master where type='table' order by name limit 129")]
            if len(tables)>128: return {'inspectionError':'table inventory exceeds bound'}
            value={'tables':{}}
            for table in tables:
                quoted='"'+table.replace('"','""')+'"'
                columns=list(db.execute('PRAGMA table_xinfo('+quoted+')'))
                if len(columns)>256: return {'inspectionError':'column inventory exceeds bound'}
                value['tables'][table]={'columns':columns,'foreignKeys':list(db.execute('PRAGMA foreign_key_list('+quoted+')'))}
            if '_sqlx_migrations' in tables:
                value['migrations']=list(db.execute('select version,success from _sqlx_migrations order by version limit 1024'))
            value['triggers']=list(db.execute("select name,sql from sqlite_master where type='trigger' order by name limit 128"))
            observed[path.name]=value
    return observed

def response_summary(r):
    thread=r.get('thread',r)
    return {'model':r.get('model'),'modelProvider':r.get('modelProvider'),'threadModelProvider':thread.get('modelProvider'),'historyMode':thread.get('historyMode'),'turnCount':len(thread.get('turns',[])),'turns':thread.get('turns',[])}


parser=argparse.ArgumentParser()
parser.add_argument('--engine',required=True,type=pathlib.Path)
parser.add_argument('--live-writers',action='store_true')
parser.add_argument('--fork',action='store_true')
parser.add_argument('--cold-target',action='store_true')
parser.add_argument('--last-write-wins',action='store_true')
parser.add_argument('--codex',type=pathlib.Path,default=pathlib.Path(BIN))
args=parser.parse_args()
BIN=str(args.codex.resolve())
ROOT=RUN
RESULT={'kind':'production-rust-engine-native-bidirectional','guiAcceptance':False}
ENV={
    'PATH':'/usr/bin:/bin:/usr/sbin:/sbin',
    'HOME':str(ROOT/'system-home'),
    'ORGII_CODEX_HISTORY_PROBE_ROOT':str(ROOT),
    'ORGII_HOME':str(ROOT/'orgii'),
    'ORGII_NATIVE_TRANSCRIPT_HOME':str(ROOT/'primary-account'),
}
for folder in ['system-home','orgii','primary-account']:(ROOT/folder).mkdir(exist_ok=True)
(ROOT/'.codex-history-probe-root').write_text('ORG2_CODEX_HISTORY_NATIVE_PROBE_V1\n')

def engine(mode):
    process=subprocess.run([str(args.engine.resolve()),mode],env=ENV,cwd=ROOT,text=True,capture_output=True,timeout=60)
    RESULT.setdefault('engineCalls',[]).append({'mode':mode,'returncode':process.returncode,'stdout':process.stdout,'stderr':process.stderr})
    if process.returncode:raise RuntimeError('Engine '+mode+' failed: '+process.stderr)
    return json.loads(process.stdout)

def reconcile(label,expected):
    report=drive_reconcile();RESULT[label]=report
    assert report=={'copied':expected,'busy':0,'conflicts':0,'more':False},(label,report)

def drive_reconcile():
    total={'copied':0,'busy':0,'conflicts':0,'more':False}
    for _ in range(8):
        journal=pathlib.Path(RESULT['paths']['journal'])
        before=journal.read_bytes() if journal.exists() else None
        report=engine('reconcile')
        for field in ['copied','busy','conflicts']:total[field]+=report[field]
        if not report['more']:return total
        assert report['copied']>0 or (journal.exists() and journal.read_bytes()!=before),'Engine requested another pass without durable progress'
    raise AssertionError('Native probe exceeded bounded reconcile passes')

def new_thread(app,text):
    start=app.call('thread/start',{'cwd':str(ROOT),'historyMode':'paginated','approvalPolicy':'never','sandbox':'read-only'})
    tid=start['thread']['id']
    app.call('turn/start',{'threadId':tid,'input':[{'type':'text','text':text}]})
    completed=app.completed(tid)
    assert completed['params']['turn']['status']=='completed',completed
    return tid

def list_native(app):
    return app.call('thread/list',{'limit':100,'useStateDbOnly':True})

def continue_native(app,tid,provider,model,text,expected_before):
    result=app.call('thread/resume',{'threadId':tid})
    assert result['modelProvider']==provider and result['model']==model,(result['modelProvider'],result['model'])
    turns=app.call('thread/turns/list',{'threadId':tid,'itemsView':'full'})
    assert len(turns['data'])==expected_before,(tid,len(turns['data']),expected_before)
    app.call('turn/start',{'threadId':tid,'input':[{'type':'text','text':text}]})
    completed=app.completed(tid)
    assert completed['params']['turn']['status']=='completed',completed
    after=app.call('thread/turns/list',{'threadId':tid,'itemsView':'full'})
    assert len(after['data'])==expected_before+1,(tid,len(after['data']))
    return {'resume':response_summary(result),'before':turns,'after':after}

def rows(home):
    import sqlite3
    with sqlite3.connect(home/'state_5.sqlite') as db:
        return [dict(zip(['id','model_provider','model','history_mode','rollout_path'],r)) for r in db.execute('select id, model_provider, model, history_mode, rollout_path from threads order by id')]


def run_bidirectional():
    paths=engine('paths');RESULT['paths']=paths
    primary=pathlib.Path(paths['primary']);package=pathlib.Path(paths['package'])
    config(primary,'test_a','gpt-5.4');config(package,'test_b','gpt-5.4-mini')
    a=App(primary,'engine-primary-create')
    aid=new_thread(a,'PRIMARY_NATIVE_FIRST_TURN')
    a.close()
    b=App(package,'engine-package-create')
    bid=new_thread(b,'PACKAGE_NATIVE_FIRST_TURN')
    b.close()
    RESULT['threadIds']={'primaryCreated':aid,'packageCreated':bid}
    RESULT['initialPrimaryRows']=rows(primary);RESULT['initialPackageRows']=rows(package)
    initial_bytes={aid:pathlib.Path(dbrows(primary,aid)['rollout_path']).read_bytes(),bid:pathlib.Path(dbrows(package,bid)['rollout_path']).read_bytes()}
    RESULT['originalRolloutSha256']={tid:hashlib.sha256(data).hexdigest() for tid,data in initial_bytes.items()}

    reconcile('firstBidirectionalReconcile',2)
    reconcile('unchangedSecondReconcile',0)
    RESULT['firstPrimaryRows']=rows(primary);RESULT['firstPackageRows']=rows(package)
    for home,provider,model in [(primary,'test_a','gpt-5.4'),(package,'test_b','gpt-5.4-mini')]:
        records=rows(home)
        assert len(records)==2
        assert all(r['model_provider']==provider and r['model']==model for r in records)
        for row in records:assert pathlib.Path(row['rollout_path']).read_bytes().startswith(initial_bytes[row['id']])

    a=App(primary,'engine-primary-receive')
    RESULT['primaryFirstNativeList']=list_native(a)
    assert {r['id'] for r in RESULT['primaryFirstNativeList']['data']}=={aid,bid}
    RESULT['primaryContinuesPackage']=continue_native(a,bid,'test_a','gpt-5.4','PRIMARY_CONTINUES_PACKAGE_SECOND_TURN',1)
    a.close()
    b=App(package,'engine-package-receive')
    RESULT['packageFirstNativeList']=list_native(b)
    assert {r['id'] for r in RESULT['packageFirstNativeList']['data']}=={aid,bid}
    RESULT['packageContinuesPrimary']=continue_native(b,aid,'test_b','gpt-5.4-mini','PACKAGE_CONTINUES_PRIMARY_SECOND_TURN',1)
    b.close()

    reconcile('returnBidirectionalReconcile',2)
    reconcile('unchangedAfterReturn',0)
    a=App(primary,'engine-primary-restart')
    RESULT['primaryRestartList']=list_native(a)
    RESULT['primaryResumesReturnedHistory']=continue_native(a,aid,'test_a','gpt-5.4','PRIMARY_THIRD_TURN_AFTER_RETURN',2)
    a.close()
    b=App(package,'engine-package-restart')
    RESULT['packageRestartList']=list_native(b)
    RESULT['packageResumesReturnedHistory']=continue_native(b,bid,'test_b','gpt-5.4-mini','PACKAGE_THIRD_TURN_AFTER_RETURN',2)
    b.close()
    reconcile('finalBidirectionalReconcile',2)
    reconcile('finalUnchangedReconcile',0)
    RESULT['finalPrimaryRows']=rows(primary);RESULT['finalPackageRows']=rows(package)
    RESULT['finalPrimaryInventory']=inventory(primary);RESULT['finalPackageInventory']=inventory(package)
    RESULT['originalPrefixStillIntact']=all(pathlib.Path(r['rollout_path']).read_bytes().startswith(initial_bytes[r['id']]) for home in [primary,package] for r in rows(home))
    assert RESULT['originalPrefixStillIntact']
    expected=[('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini')]
    assert [(r['path'],r['model']) for r in REQUESTS]==expected
    RESULT['ok']=True

def run_live_writers():
    """A completed loaded source is readable; active sources/loaded targets defer."""
    paths=engine('paths');RESULT['paths']=paths
    primary=pathlib.Path(paths['primary']);package=pathlib.Path(paths['package'])
    config(primary,'test_a','gpt-5.4');config(package,'test_b','gpt-5.4-mini')
    a=App(primary,'live-source-create')
    tid=new_thread(a,'SOURCE_LOADED_COMPLETED_FIRST_TURN')
    b=App(package,'live-target-bootstrap')
    seed=new_thread(b,'TARGET_SCHEMA_SEED');b.close()
    original=pathlib.Path(dbrows(primary,tid)['rollout_path']).read_bytes()
    RESULT['threadIds']={'shared':tid,'seed':seed}
    # The source remains loaded in the native app-server and holds its writer.
    reconcile('sourceLoadedCompletedToUnloadedTarget',2)
    reconcile('unchangedWithLoadedSource',0)
    assert a.p.poll() is None
    assert pathlib.Path(dbrows(package,tid)['rollout_path']).read_bytes().startswith(original)

    # Hold the mock response after the native source starts a real turn. This
    # tests a native in-progress projection, not hand-edited status fixtures.
    a.call('turn/start',{'threadId':tid,'input':[{'type':'text','text':'SOURCE_INFLIGHT_HOLD_SECOND_TURN'}]})
    assert MODEL_HOLD_ENTERED.wait(timeout=15),'Native source did not reach held mock model'
    target_before=pathlib.Path(dbrows(package,tid)['rollout_path']).read_bytes()
    RESULT['ongoingSourceReconcile']=engine('reconcile')
    assert RESULT['ongoingSourceReconcile']=={'copied':0,'busy':1,'conflicts':0,'more':False},RESULT['ongoingSourceReconcile']
    assert pathlib.Path(dbrows(package,tid)['rollout_path']).read_bytes()==target_before
    MODEL_HOLD_RELEASE.set()
    completed=a.completed(tid)
    assert completed['params']['turn']['status']=='completed',completed
    reconcile('sourceJustCompletedStillLoaded',1)
    reconcile('sourceCompletedUnchanged',0)

    b=App(package,'live-target-continue')
    RESULT['targetNativeList']=list_native(b)
    assert {row['id'] for row in RESULT['targetNativeList']['data']}=={tid,seed}
    RESULT['targetContinuesLoadedSourceSnapshot']=continue_native(b,tid,'test_b','gpt-5.4-mini','TARGET_THIRD_TURN',2)
    # Reverse publication must not overwrite the still-loaded primary target,
    # even though that target finished its earlier turn before this test.
    primary_before=pathlib.Path(dbrows(primary,tid)['rollout_path']).read_bytes()
    RESULT['loadedDestinationReconcile']=engine('reconcile')
    assert RESULT['loadedDestinationReconcile']=={'copied':0,'busy':1,'conflicts':0,'more':False},RESULT['loadedDestinationReconcile']
    assert pathlib.Path(dbrows(primary,tid)['rollout_path']).read_bytes()==primary_before
    a.close()
    reconcile('returnWithCompletedPackageStillLoaded',1)
    reconcile('unchangedAfterLoadedSourceReturn',0)
    b.close()

    a=App(primary,'live-primary-restart')
    RESULT['sourceRestartsAndContinuesReturnedSnapshot']=continue_native(a,tid,'test_a','gpt-5.4','PRIMARY_FOURTH_TURN',3)
    a.close()
    reconcile('restartPrimaryContinueReconcile',1)
    b=App(package,'live-package-restart')
    RESULT['targetRestartsAndContinuesAgain']=continue_native(b,tid,'test_b','gpt-5.4-mini','PACKAGE_FIFTH_TURN',4)
    b.close()
    reconcile('restartPackageContinueReconcile',1)
    reconcile('liveScenarioFinalUnchanged',0)
    assert all(pathlib.Path(dbrows(home,tid)['rollout_path']).read_bytes().startswith(original) for home in [primary,package])
    assert [(r['path'],r['model']) for r in REQUESTS]==[
        ('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),
        ('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),
        ('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini')]
    RESULT['ok']=True

def run_fork():
    paths=engine('paths');RESULT['paths']=paths
    primary=pathlib.Path(paths['primary']);package=pathlib.Path(paths['package'])
    config(primary,'test_a','gpt-5.4');config(package,'test_b','gpt-5.4-mini')
    a=App(primary,'fork-primary-create')
    parent_id=new_thread(a,'NATIVE_FORK_PARENT_FIRST_TURN')
    fork=a.call('thread/fork',{'threadId':parent_id})
    child_id=fork['thread']['id'];RESULT['nativeForkResponse']=response_summary(fork)
    RESULT['sourceContinuesFork']=continue_native(a,child_id,'test_a','gpt-5.4','NATIVE_FORK_CHILD_SECOND_TURN',1)
    a.close()
    b=App(package,'fork-package-bootstrap');seed_id=new_thread(b,'PACKAGE_BOOTSTRAP_FOR_FORK');b.close()
    RESULT['threadIds']={'parent':parent_id,'child':child_id,'packageSeed':seed_id}
    child_row=dbrows(primary,child_id)
    child_rollout=pathlib.Path(child_row['rollout_path'])
    RESULT['forkHeader']=json.loads(child_rollout.read_text().splitlines()[0])['payload']
    # Keep evidence bounded and do not repeat native's built-in prompt.
    RESULT['forkHeader'].pop('base_instructions',None)
    initial_bytes={r['id']:pathlib.Path(r['rollout_path']).read_bytes() for r in rows(primary)}
    RESULT['firstReconcile']=drive_reconcile()
    assert RESULT['firstReconcile']=={'copied':3,'busy':0,'conflicts':0,'more':False},RESULT['firstReconcile']
    reconcile('firstUnchangedReconcile',0)
    b=App(package,'fork-package-continue')
    RESULT['targetList']=list_native(b)
    assert {r['id'] for r in RESULT['targetList']['data']}=={parent_id,child_id,seed_id}
    RESULT['targetContinuesFork']=continue_native(b,child_id,'test_b','gpt-5.4-mini','PACKAGE_FORK_THIRD_TURN',2)
    b.close()
    RESULT['returnReconcile']=drive_reconcile()
    assert RESULT['returnReconcile']=={'copied':1,'busy':0,'conflicts':0,'more':False},RESULT['returnReconcile']
    a=App(primary,'fork-primary-return')
    RESULT['primaryContinuesReturnedFork']=continue_native(a,child_id,'test_a','gpt-5.4','PRIMARY_FORK_FOURTH_TURN',3)
    a.close()
    RESULT['sourcePrefixesPreserved']=all(pathlib.Path(dbrows(home,tid)['rollout_path']).read_bytes().startswith(data) for home in [primary,package] for tid,data in initial_bytes.items())
    assert RESULT['sourcePrefixesPreserved']
    assert [(r['path'],r['model']) for r in REQUESTS]==[
        ('/test_a/v1/responses','gpt-5.4'),('/test_a/v1/responses','gpt-5.4'),
        ('/test_b/v1/responses','gpt-5.4-mini'),('/test_b/v1/responses','gpt-5.4-mini'),
        ('/test_a/v1/responses','gpt-5.4')]
    RESULT['ok']=True

def run_cold_target():
    paths=engine('paths');RESULT['paths']=paths
    primary=pathlib.Path(paths['primary']);package=pathlib.Path(paths['package'])
    config(primary,'test_a','gpt-5.4');config(package,'test_b','gpt-5.4-mini')
    a=App(primary,'cold-primary-create');tid=new_thread(a,'COLD_PROFILE_PRIMARY_FIRST_TURN');a.close()
    original=pathlib.Path(dbrows(primary,tid)['rollout_path']).read_bytes()
    b=App(package,'cold-package-bootstrap')
    assert not (package/'thread_history_1.sqlite').exists()
    requests_before=len(REQUESTS)
    owned=b.call('thread/start',{'cwd':str(ROOT),'historyMode':'paginated','ephemeral':False,'approvalPolicy':'on-request','sandbox':'read-only'})
    owned_id=owned['thread']['id']
    RESULT['bootstrapResolvedRoute']={k:owned[k] for k in ['model','modelProvider','approvalPolicy','sandbox']}
    try:
        b.call('thread/inject_items',{'threadId':owned_id,'items':[{
            'type':'message','role':'user','content':[{'type':'input_text','text':'DISPOSABLE_NATIVE_SCHEMA_BOOTSTRAP'}]
        }]})
        assert (package/'thread_history_1.sqlite').is_file()
        b.call('thread/unsubscribe',{'threadId':owned_id})
    finally:
        b.call('thread/delete',{'threadId':owned_id})
    RESULT['bootstrapModelRequestCount']=len(REQUESTS)-requests_before
    assert RESULT['bootstrapModelRequestCount']==0
    RESULT['postBootstrapInventory']=inventory(package)
    assert RESULT['postBootstrapInventory']['state_5.sqlite']['threads']==0
    for table,count in RESULT['postBootstrapInventory']['thread_history_1.sqlite'].items():
        if table!='_sqlx_migrations':assert count==0,(table,count)
    assert list_native(b)['data']==[]
    assert list(package.rglob('rollout-*.jsonl'))==[]
    b.close()
    reconcile('coldFirstReconcile',1)
    reconcile('coldUnchangedReconcile',0)
    b=App(package,'cold-package-receive')
    RESULT['coldNativeList']=list_native(b)
    assert [row['id'] for row in RESULT['coldNativeList']['data']]==[tid]
    RESULT['coldTargetContinue']=continue_native(b,tid,'test_b','gpt-5.4-mini','COLD_PACKAGE_SECOND_TURN',1)
    b.close()
    reconcile('coldReturnReconcile',1)
    a=App(primary,'cold-primary-return')
    RESULT['coldPrimaryReturnedContinue']=continue_native(a,tid,'test_a','gpt-5.4','COLD_PRIMARY_THIRD_TURN',2)
    a.close()
    reconcile('coldFinalReconcile',1)
    assert all(pathlib.Path(dbrows(home,tid)['rollout_path']).read_bytes().startswith(original) for home in [primary,package])
    assert [(r['path'],r['model']) for r in REQUESTS]==[('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),('/test_a/v1/responses','gpt-5.4')]
    RESULT['ok']=True


def run_last_write_wins():
    """Use native writers only: newer complete raw revisions replace older ones."""
    paths=engine('paths');RESULT['paths']=paths
    primary=pathlib.Path(paths['primary']);package=pathlib.Path(paths['package'])
    config(primary,'test_a','gpt-5.4');config(package,'test_b','gpt-5.4-mini')
    a=App(primary,'lww-primary-create');tid=new_thread(a,'LWW_SHARED_FIRST_TURN');a.close()
    b=App(package,'lww-package-bootstrap');seed_id=new_thread(b,'LWW_PACKAGE_BOOTSTRAP');b.close()
    RESULT['threadIds']={'shared':tid,'packageSeed':seed_id}
    reconcile('initialReconcile',2)

    # Both sides branch from one turn. The later package branch wins in full;
    # the earlier unique primary message must not be spliced into the winner.
    a=App(primary,'lww-primary-earlier')
    RESULT['earlierPrimaryBranch']=continue_native(a,tid,'test_a','gpt-5.4','EARLIER_PRIMARY_UNIQUE',1);a.close()
    b=App(package,'lww-package-later')
    RESULT['laterPackageBranch']=continue_native(b,tid,'test_b','gpt-5.4-mini','LATER_PACKAGE_UNIQUE',1);b.close()
    earlier=pathlib.Path(dbrows(primary,tid)['rollout_path'])
    winning=pathlib.Path(dbrows(package,tid)['rollout_path'])
    assert winning.stat().st_mtime_ns>earlier.stat().st_mtime_ns,'Native writes did not establish strict order'
    winning_bytes=winning.read_bytes();old_primary_bytes=earlier.read_bytes()
    reconcile('laterPackageWins',1)
    assert pathlib.Path(dbrows(primary,tid)['rollout_path']).read_bytes().startswith(winning_bytes)
    assert earlier.read_bytes()==old_primary_bytes
    reconcile('unchangedAfterPackageWin',0)

    # Reverse the ordering: the later primary branch wins this time.
    b=App(package,'lww-package-earlier')
    RESULT['earlierPackageBranch']=continue_native(b,tid,'test_b','gpt-5.4-mini','EARLIER_PACKAGE_UNIQUE',2);b.close()
    a=App(primary,'lww-primary-later')
    RESULT['laterPrimaryBranch']=continue_native(a,tid,'test_a','gpt-5.4','LATER_PRIMARY_UNIQUE',2);a.close()
    winning=pathlib.Path(dbrows(primary,tid)['rollout_path'])
    older=pathlib.Path(dbrows(package,tid)['rollout_path'])
    assert winning.stat().st_mtime_ns>older.stat().st_mtime_ns,'Native writes did not establish strict order'
    winning_bytes=winning.read_bytes()
    reconcile('laterPrimaryWins',1)
    assert pathlib.Path(dbrows(package,tid)['rollout_path']).read_bytes().startswith(winning_bytes)
    reconcile('unchangedAfterPrimaryWin',0)

    # A later native resume is a real raw revision, even without a model call.
    # Product policy deliberately compares data writes, not human-message time.
    a=App(primary,'lww-primary-before-later-open')
    RESULT['messageBeforeLaterOpen']=continue_native(a,tid,'test_a','gpt-5.4','EARLIER_MESSAGE_BEFORE_OPEN',3);a.close()
    b=App(package,'lww-package-open-only')
    requests_before=len(REQUESTS)
    resumed=b.call('thread/resume',{'threadId':tid})
    assert resumed['modelProvider']=='test_b' and resumed['model']=='gpt-5.4-mini'
    assert len(REQUESTS)==requests_before
    b.close()
    winner=pathlib.Path(dbrows(package,tid)['rollout_path'])
    loser=pathlib.Path(dbrows(primary,tid)['rollout_path'])
    assert winner.stat().st_mtime_ns>loser.stat().st_mtime_ns,'Resume-only native write did not establish strict order'
    winning_bytes=winner.read_bytes()
    reconcile('laterOpenWinsAsRawRevision',1)
    assert pathlib.Path(dbrows(primary,tid)['rollout_path']).read_bytes().startswith(winning_bytes)
    for index in range(3):reconcile('unchangedRepeat'+str(index),0)
    for home,label in [(primary,'primary'),(package,'package')]:
        app=App(home,'lww-cold-'+label)
        roster=list_native(app)
        assert [row['id'] for row in roster['data']].count(tid)==1
        read=app.call('thread/read',{'threadId':tid,'includeTurns':True})
        RESULT[label+'FinalRead']=response_summary(read)
        assert len(read['thread']['turns'])==3,read
        encoded=json.dumps(read)
        for missing in ['EARLIER_PRIMARY_UNIQUE','EARLIER_PACKAGE_UNIQUE','EARLIER_MESSAGE_BEFORE_OPEN']:
            assert missing not in encoded,missing
        for present in ['LATER_PACKAGE_UNIQUE','LATER_PRIMARY_UNIQUE']:
            assert present in encoded,present
        app.close()
    # A real continuation proves that the chosen snapshot remains resumable and
    # destination-owned routing is still used after both LWW directions.
    a=App(primary,'lww-final-primary-continue')
    RESULT['finalContinuation']=continue_native(a,tid,'test_a','gpt-5.4','AFTER_LWW_RESUME',3);a.close()
    reconcile('finalContinuationReturn',1)
    reconcile('finalUnchangedReconcile',0)
    assert [(r['path'],r['model']) for r in REQUESTS]==[
        ('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),
        ('/test_a/v1/responses','gpt-5.4'),('/test_b/v1/responses','gpt-5.4-mini'),
        ('/test_b/v1/responses','gpt-5.4-mini'),('/test_a/v1/responses','gpt-5.4'),
        ('/test_a/v1/responses','gpt-5.4'),('/test_a/v1/responses','gpt-5.4')]
    # Extra pre-overwrite backups and completed private handoff snapshots must
    # be absent. Retained physical files/projections remain native dependencies.
    journal=pathlib.Path(paths['journal'])
    assert not any(path.is_file() for path in journal.parent.glob('backups/*'))
    assert not list(journal.parent.glob('snapshots/handoff-*/snapshot.sqlite'))
    assert not json.loads(journal.read_text())['pending']
    RESULT['retainedPhysicalGenerations']={label:sum(1 for folder in ['sessions','archived_sessions'] for path in (home/folder).rglob('*.jsonl') if path.is_file()) for home,label in [(primary,'primary'),(package,'package')]}
    RESULT['retainedNativeDependenciesPreserved']=earlier.read_bytes()==old_primary_bytes
    RESULT['checks']={name:True for name in ['later_package_wins','later_primary_wins','later_open_is_raw_revision','no_copy_rebound','cold_native_read','destination_route','no_snapshot_backup']}
    RESULT['ok']=True


def cancelled(_signal,_frame):
    raise InterruptedError('native canary cancelled')

signal.signal(signal.SIGTERM,cancelled)

try:
    RESULT['engineBinarySha256']=hashlib.sha256(args.engine.read_bytes()).hexdigest()
    RESULT['nativeBinarySha256']=hashlib.sha256(pathlib.Path(BIN).read_bytes()).hexdigest()
    if sum([args.fork,args.cold_target,args.live_writers,args.last_write_wins])>1:
        raise ValueError('Choose only one native scenario')
    if args.last_write_wins:
        RESULT['kind']='production-rust-engine-native-last-write-wins'
        run_last_write_wins()
    elif args.cold_target:
        RESULT['kind']='production-rust-engine-native-cold-target'
        run_cold_target()
    elif args.fork:
        RESULT['kind']='production-rust-engine-native-fork'
        run_fork()
    elif args.live_writers:
        RESULT['kind']='production-rust-engine-native-loaded-source-snapshot'
        run_live_writers()
    else:
        run_bidirectional()
except Exception as error:
    RESULT['ok']=False
    RESULT['status']=('infrastructure_error' if isinstance(error,(OSError,TimeoutError,queue.Empty,InterruptedError)) else 'incompatible')
    RESULT['error']=repr(error)
    RESULT['traceback']=traceback.format_exc()
finally:
    if RESULT.get('ok'): RESULT['status']='pass'
    signal.signal(signal.SIGTERM,signal.SIG_IGN)
    MODEL_HOLD_RELEASE.set()
    # Broadcast first so cancellation stays bounded regardless of case size.
    for app in PROCESSES:
        try:os.killpg(app.p.pid,signal.SIGTERM)
        except ProcessLookupError:pass
    cleanup_deadline=time.monotonic()+5
    while any(app.p.poll() is None for app in PROCESSES) and time.monotonic()<cleanup_deadline:
        time.sleep(.05)
    for app in PROCESSES:
        try:os.killpg(app.p.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    for app in PROCESSES:
        try:app.close()
        except Exception:pass
    SERVER.shutdown()
    SERVER.server_close()
    RESULT['schemaEvidence']={}
    observed_homes=set()
    for app in PROCESSES:
        if app.home in observed_homes: continue
        observed_homes.add(app.home)
        try: RESULT['schemaEvidence'][app.label]=schema_evidence(app.home)
        except Exception as error: RESULT['schemaEvidence'][app.label]={'inspectionError':type(error).__name__}
    RESULT['requests']=REQUESTS
    RESULT['processExitCodes']=[{'label':x.label,'pid':x.p.pid,'returncode':x.p.poll()} for x in PROCESSES]
    (ROOT/'result.json').write_text(json.dumps(RESULT,indent=2)+'\n')
    print(json.dumps({'result':str(ROOT/'result.json'),'ok':RESULT.get('ok'),'error':RESULT.get('error'),'reports':{k:v for k,v in RESULT.items() if isinstance(v,dict) and 'copied' in v},'modelRequestCount':len(REQUESTS),'processExitCodes':RESULT['processExitCodes']},indent=2))
if not RESULT.get('ok'):
    sys.exit(1)
