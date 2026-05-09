use std::process::Stdio;

/// Helper for spawning an Anvil process in tests
pub struct Anvil {
    process: std::process::Child,
}

pub struct AnvilBuilder {
    fork_url: Option<String>,
    fork_block: Option<u64>,
    port: u16,
    log: bool,
}

impl AnvilBuilder {
    pub fn new() -> Self {
        Self {
            fork_url: None,
            fork_block: None,
            port: 8545,
            log: false,
        }
    }

    pub fn fork_url(mut self, url: impl Into<String>) -> Self {
        self.fork_url = Some(url.into());
        self
    }

    pub fn fork_block(mut self, block: u64) -> Self {
        self.fork_block = Some(block);
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

    pub async fn spawn(self) -> Anvil {
        let mut args = vec!["--port".to_string(), self.port.to_string()];
        if let Some(url) = self.fork_url {
            args.extend(["--fork-url".to_string(), url]);
        }
        if let Some(block) = self.fork_block {
            args.extend(["--fork-block-number".to_string(), block.to_string()]);
        }

        let process = std::process::Command::new("anvil")
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
            .expect("Failed to start Anvil process");

        crate::utils::wait_for_port(self.port).await;

        Anvil { process }
    }
}

impl Drop for Anvil {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}
