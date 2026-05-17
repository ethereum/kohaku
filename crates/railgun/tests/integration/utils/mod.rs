mod alto;
mod anvil;

use std::time::Duration;

use alloy::{
    primitives::{Address, U256},
    providers::{Provider, ext::AnvilApi},
    signers::local::PrivateKeySigner,
};
pub use alto::AltoBuilder;
pub use anvil::AnvilBuilder;
use common::sleep;

pub async fn wait_for_port(port: u16) {
    for _ in 0..100 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return;
        }
        sleep(Duration::from_millis(100)).await;
    }
    panic!("service on port {port} never became ready");
}

pub async fn set_balances(provider: &impl Provider, addresses: &[Address], value: U256) {
    for addr in addresses {
        provider.anvil_set_balance(*addr, value).await.unwrap();
    }
}

pub async fn set_pk_balances(provider: &impl Provider, private_keys: &[&str], value: U256) {
    let addresses: Vec<Address> = private_keys
        .iter()
        .map(|pk| pk.parse::<PrivateKeySigner>().map(|s| s.address()))
        .collect::<Result<_, _>>()
        .unwrap();
    set_balances(provider, &addresses, value).await
}
