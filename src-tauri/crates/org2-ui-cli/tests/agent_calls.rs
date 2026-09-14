//! Real CLI process + authenticated loopback fixture. No desktop or PTY is started.
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    process::{Command, Output},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
};

struct Fixture {
    root: PathBuf,
    id: String,
    received: mpsc::Receiver<Value>,
    stop: Arc<AtomicBool>,
    server: Option<thread::JoinHandle<()>>,
}
impl Fixture {
    fn new() -> Self {
        let id = uuid::Uuid::new_v4().to_string();
        let root = std::env::temp_dir().join(format!("org2-ui-agent-test-{id}"));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        fs::create_dir_all(root.join("ui/instances")).unwrap();
        fs::write(
            root.join(format!("ui/instances/{id}.json")),
            json!({"instanceId":id,"port":port,"token":"fixture-only"}).to_string(),
        )
        .unwrap();
        fs::write(root.join("target.json"),json!({"instanceId":id,"windowId":"main","workspace":{"kind":"session","sessionId":"host-session"}}).to_string()).unwrap();
        let (send, received) = mpsc::channel();
        let stop = Arc::new(AtomicBool::new(false));
        let stopping = stop.clone();
        let instance = id.clone();
        let server = thread::spawn(move || {
            while !stopping.load(Ordering::Relaxed) {
                let (mut socket, _) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(error) => panic!("{error}"),
                };
                // Accepted sockets can inherit the listener's nonblocking mode.
                socket.set_nonblocking(false).unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let header_end = loop {
                    let mut buffer = [0; 1024];
                    let read = socket.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    bytes.extend_from_slice(&buffer[..read]);
                    if let Some(index) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                        break index + 4;
                    }
                };
                let headers = String::from_utf8(bytes[..header_end].to_vec())
                    .unwrap()
                    .to_lowercase();
                assert!(headers.contains("x-orgii-ui-token: fixture-only"));
                let length: usize = headers
                    .lines()
                    .find_map(|line| line.strip_prefix("content-length: "))
                    .map(|value| value.parse().unwrap())
                    .unwrap_or(0);
                while bytes.len() < header_end + length {
                    let mut buffer = [0; 1024];
                    let read = socket.read(&mut buffer).unwrap();
                    assert!(read > 0);
                    bytes.extend_from_slice(&buffer[..read]);
                }
                let response = if headers.starts_with("get /ui/v1/info ") {
                    json!({"instanceId":instance,"catalogHash":app_ui::catalog()["hash"],"protocolVersion":1,"ready":true,"windows":[{"windowId":"main"}]})
                } else if headers.starts_with("get /ui/v1/receipt?") {
                    json!({"status":"unknown","error":{"code":"RECEIPT_UNAVAILABLE"}})
                } else {
                    assert!(headers.starts_with("post /ui/v1/execute "));
                    let request: Value =
                        serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap();
                    send.send(request.clone()).unwrap();
                    if request["params"]["data"] == "simulate-disconnect" {
                        continue;
                    }
                    json!({"protocolVersion":1,"requestId":request["requestId"],"target":request["target"],"status":"applied","result":{"presentationState":"requested","revealed":false}})
                };
                let body = response.to_string();
                write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
            }
        });
        Self {
            root,
            id,
            received,
            stop,
            server: Some(server),
        }
    }
    fn call(&self, tool: &str, args: Value, extra: &[&str]) -> Output {
        let path = self.root.join("arguments.json");
        fs::write(&path, args.to_string()).unwrap();
        Command::new(env!("CARGO_BIN_EXE_org2-ui"))
            .env("ORGII_HOME", &self.root)
            .env("ORG2_UI_TARGET_FILE", self.root.join("target.json"))
            .args(["ui", "call", tool, "--params-file"])
            .arg(path)
            .args(extra)
            .output()
            .unwrap()
    }
    fn submitted(&self) -> Value {
        self.received.recv_timeout(Duration::from_secs(2)).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        let joined = self.server.take().unwrap().join();
        let cleaned = fs::remove_dir_all(&self.root);
        if !std::thread::panicking() {
            if let Err(panic) = joined {
                std::panic::resume_unwind(panic);
            }
            cleaned.unwrap();
        }
    }
}

#[test]
fn cli_tools_bind_host_context_preserve_literals_and_reject_partial_target_inheritance() {
    let fixture = Fixture::new();
    let opened = fixture.call(
        "open_in_org2",
        json!({"target":{"type":"file","path":"src/main.ts","line":42}}),
        &["--request-id", "host-call"],
    );
    assert!(
        opened.status.success(),
        "{}",
        String::from_utf8_lossy(&opened.stdout)
    );
    let request = fixture.submitted();
    assert_eq!(request["target"]["instanceId"], fixture.id);
    assert_eq!(request["target"]["workspace"]["sessionId"], "host-session");
    assert_eq!(request["requestId"], "host-call");
    assert_eq!(request["params"], json!({"path":"src/main.ts","line":42}));
    assert_eq!(request["reveal"], true);
    assert!(!String::from_utf8_lossy(&opened.stdout).contains("fixture-only"));

    assert!(fixture.call("write_org2_terminal",json!({"workspace":{"kind":"global"},"terminalId":"shell","input":{"type":"input","data":"literal '$HOME'\n"}}),&[]).status.success());
    let request = fixture.submitted();
    assert_eq!(request["target"]["workspace"], json!({"kind":"global"}));
    assert_eq!(request["command"], "ui.terminal.input");
    assert_eq!(request["params"]["data"], "literal '$HOME'\n");

    // Explicit instance replaces the env binding: it must not inherit host-session.
    let missing = fixture.call(
        "open_in_org2",
        json!({"target":{"type":"explorer"}}),
        &["--instance", &fixture.id],
    );
    assert!(!missing.status.success());
    assert!(String::from_utf8_lossy(&missing.stdout).contains("Specify --session"));
    assert!(fixture.received.try_recv().is_err());
    assert!(fixture
        .call(
            "open_in_org2",
            json!({"target":{"type":"explorer"}}),
            &["--global"]
        )
        .status
        .success());
    assert_eq!(
        fixture.submitted()["target"]["workspace"],
        json!({"kind":"global"})
    );

    let receipt = fixture.call("get_org2_ui_result", json!({"requestId":"host-call"}), &[]);
    assert_eq!(receipt.status.code(), Some(5));
    assert!(fixture
        .call("get_org2_ui_docs", json!({"topic":"cli"}), &[])
        .status
        .success());
}

#[test]
fn uncertain_cli_input_reports_the_submitted_workspace_without_replay() {
    let fixture = Fixture::new();
    let output=fixture.call("write_org2_terminal",json!({"workspace":{"kind":"global"},"terminalId":"shell","input":{"type":"input","data":"simulate-disconnect"}}),&["--request-id","uncertain-call"]);
    assert_eq!(output.status.code(), Some(5));
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let submitted = fixture.submitted();
    assert_eq!(receipt["status"], "unknown");
    assert_eq!(receipt["requestId"], "uncertain-call");
    assert_eq!(receipt["target"], submitted["target"]);
    assert_eq!(receipt["target"]["workspace"], json!({"kind":"global"}));
    assert!(fixture.received.try_recv().is_err());
}
