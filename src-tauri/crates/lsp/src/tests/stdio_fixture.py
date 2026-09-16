# Local test child: stdio only, no imports/config/user files/network.
import json, os, sys, time
mode = sys.argv[1]
def send(v):
    b=json.dumps(v).encode()
    sys.stdout.buffer.write(b'Content-Length: '+str(len(b)).encode()+b'\r\n\r\n'+b)
    sys.stdout.buffer.flush()
if mode == 'no_read':
    time.sleep(30)
    sys.exit()
if mode == 'bad_header':
    sys.stdout.buffer.write(b'x'*9000); sys.stdout.buffer.flush()
    time.sleep(30); sys.exit()
if mode == 'long_stderr':
    sys.stderr.buffer.write(b'x'*(2*1024*1024));sys.stderr.buffer.flush()
config=None
pending_hover=None
while True:
    size=None
    while True:
        line=sys.stdin.buffer.readline()
        if not line: sys.exit()
        if line==b'\r\n': break
        if line.startswith(b'Content-Length:'): size=int(line.split(b':')[1])
    v=json.loads(sys.stdin.buffer.read(size))
    method=v.get('method'); ident=v.get('id')
    if method=='initialize':
        if mode=='init_wait': continue
        if mode=='init_error': send({'jsonrpc':'2.0','id':ident,'error':{'code':-32002,'message':'fixture init rejected','data':{'retry':False}}})
        else: send({'jsonrpc':'2.0','id':ident,'result':{'capabilities':{'hoverProvider':True,'textDocumentSync':1}}})
    elif method=='initialized' and mode=='stop_reading':
        time.sleep(30)
    elif method=='initialized' and mode=='configuration':
        send({'jsonrpc':'2.0','id':'config-1','method':'workspace/configuration','params':{'items':[{'section':'rust.check'},{'section':'missing'}]}})
    elif method is None and ident=='config-1':
        config=v
        if pending_hover is not None:
            send({'jsonrpc':'2.0','id':pending_hover,'result':{'contents':json.dumps(config)}})
            pending_hover=None
    elif method=='textDocument/hover':
        if mode=='configuration' and config is None:
            pending_hover=ident
            continue
        if mode=='hover_wait': continue
        if mode=='hover_error': send({'jsonrpc':'2.0','id':ident,'error':{'code':-32801,'message':'fixture changed','data':{'version':3}}})
        else: send({'jsonrpc':'2.0','id':ident,'result':{'contents':json.dumps(config) if mode=='configuration' else os.getcwd()}})
    elif method=='fixture/crash': sys.exit(7)
    elif method=='shutdown': send({'jsonrpc':'2.0','id':ident,'result':None})
    elif method=='exit': sys.exit()
