#[cfg(not(target_arch = "wasm32"))]
mod convert_artifacts;

#[cfg(not(target_arch = "wasm32"))]
#[tokio::main(flavor = "current_thread")]
async fn main() {
    convert_artifacts::main().await;
}

#[cfg(target_arch = "wasm32")]
fn main() {}
