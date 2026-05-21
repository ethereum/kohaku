use std::process::Stdio;

/// Helper for spawning an Alto process in tests
pub struct Alto {
    process: std::process::Child,
}

pub struct AltoBuilder {
    entrypoints: Vec<String>,
    executor_private_keys: Vec<String>,
    utility_private_key: Option<String>,
    rpc_url: Option<String>,
    safe_mode: bool,
    port: u16,
    log: bool,
}

impl AltoBuilder {
    pub fn new() -> Self {
        Self {
            entrypoints: vec![],
            executor_private_keys: vec![],
            utility_private_key: None,
            rpc_url: None,
            //? False by default since anvil doesn't support the required tracers
            safe_mode: false,
            port: 3000,
            log: false,
        }
    }

    pub fn entrypoint(mut self, addr: impl Into<String>) -> Self {
        self.entrypoints.push(addr.into());
        self
    }

    pub fn executor_private_key(mut self, key: impl Into<String>) -> Self {
        self.executor_private_keys.push(key.into());
        self
    }

    pub fn utility_private_key(mut self, key: impl Into<String>) -> Self {
        self.utility_private_key = Some(key.into());
        self
    }

    pub fn rpc_url(mut self, url: impl Into<String>) -> Self {
        self.rpc_url = Some(url.into());
        self
    }

    #[allow(dead_code)]
    pub fn safe_mode(mut self, safe_mode: bool) -> Self {
        self.safe_mode = safe_mode;
        self
    }

    #[allow(dead_code)]
    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    #[allow(dead_code)]
    pub fn log(mut self) -> Self {
        self.log = true;
        self
    }

    pub async fn spawn(self) -> Alto {
        let mut args = vec!["--port".to_string(), self.port.to_string()];
        if !self.entrypoints.is_empty() {
            args.extend(["--entrypoints".to_string(), self.entrypoints.join(",")]);
        }
        if !self.executor_private_keys.is_empty() {
            args.extend([
                "--executor-private-keys".to_string(),
                self.executor_private_keys.join(","),
            ]);
        }
        if let Some(key) = self.utility_private_key {
            args.extend(["--utility-private-key".to_string(), key]);
        }
        if let Some(url) = self.rpc_url {
            args.extend(["--rpc-url".to_string(), url]);
        }

        args.push("--safe-mode".to_string());
        if self.safe_mode {
            args.push("true".to_string());
        } else {
            args.push("false".to_string());
        }

        //? Hacky launching of alto since using `pnpm alto` directly tends to leave
        //? alto orphaned
        let alto =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node_modules/.bin/alto");
        let process = std::process::Command::new(alto)
            .args(&args)
            .stdout(if self.log {
                Stdio::inherit()
            } else {
                Stdio::null()
            })
            .stderr(if self.log {
                Stdio::inherit()
            } else {
                Stdio::null()
            })
            .spawn()
            .expect("Failed to start Alto process");

        crate::utils::wait_for_port(self.port).await;

        Alto { process }
    }
}

impl Drop for Alto {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}
