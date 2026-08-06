use std::{future::Future, process::Stdio};

use alloy::providers::{Provider, ext::AnvilApi};
use tracing::info;
use userop_kit::bundler::pimlico::PimlicoBundler;

pub trait AltoBundlerExt: Sized {
    fn connect_alto_with_config<F, Fut>(f: F) -> impl Future<Output = Self> + Send
    where
        F: FnOnce(AltoBuilder) -> Fut + Send,
        Fut: Future<Output = AltoBuilder> + Send;
}

/// Helper for spawning an Alto process in tests
pub struct Alto {
    process: std::process::Child,
    bundler_url: String,
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

impl AltoBundlerExt for PimlicoBundler {
    async fn connect_alto_with_config<F, Fut>(f: F) -> Self
    where
        F: FnOnce(AltoBuilder) -> Fut + Send,
        Fut: Future<Output = AltoBuilder> + Send,
    {
        let alto = f(AltoBuilder::new()).await.spawn().await;
        let bundler_url = alto.bundler_url.parse().unwrap();
        PimlicoBundler::new(bundler_url)
    }
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

    pub async fn prefund(self, provider: &impl Provider) -> Self {
        let mut pks = self.executor_private_keys.clone();
        if let Some(key) = &self.utility_private_key {
            pks.push(key.clone());
        }

        let addresses = pks
            .iter()
            .map(|key| {
                key.parse::<alloy::signers::local::PrivateKeySigner>()
                    .unwrap()
                    .address()
            })
            .collect::<Vec<_>>();

        for address in addresses {
            provider
                .anvil_set_balance(
                    address,
                    alloy::primitives::U256::from(1_000_000_000_000_000_000u128),
                )
                .await
                .unwrap();
        }

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
        info!(
            "Spawning Alto with entrypoints={:?}, executor_private_keys={:?}, utility_private_key={:?}, rpc_url={:?}, safe_mode={}, port={}, log={}",
            self.entrypoints,
            self.executor_private_keys,
            self.utility_private_key,
            self.rpc_url,
            self.safe_mode,
            self.port,
            self.log
        );

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

        let rpc_url = format!("http://localhost:{}", self.port);

        Alto {
            process,
            bundler_url: rpc_url,
        }
    }
}

impl Drop for Alto {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}
