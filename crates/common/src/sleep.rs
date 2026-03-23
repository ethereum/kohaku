#[cfg(not(target_arch = "wasm32"))]
pub async fn sleep(duration: web_time::Duration) {
    tokio::time::sleep(duration).await;
}

#[cfg(target_arch = "wasm32")]
pub async fn sleep(duration: web_time::Duration) {
    gloo_timers::future::sleep(duration).await;
}
