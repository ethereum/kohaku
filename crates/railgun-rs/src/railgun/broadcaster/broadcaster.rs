use std::{
    collections::{HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
    pin::Pin,
    sync::Arc,
    task::Poll,
};

use alloy::primitives::{Address, Bytes, ChainId, FixedBytes, TxHash};
use futures::Stream;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_with::serde_as;
use thiserror::Error;
use tracing::{error, info, warn};

use crate::{
    crypto::{
        aes::Ciphertext,
        keys::{KeyError, SharedKey, ViewingKey, ViewingPublicKey},
    },
    railgun::{
        address::RailgunAddress,
        broadcaster::{
            content_topics::{transact_content_topic, transact_response_content_topic},
            transport::{WakuTransport, WakuTransportError},
        },
        poi::{ListKey, PreTransactionPoisPerTxidLeafPerList, TxidVersion},
        transaction::PoiProvedTx,
    },
    sleep::sleep,
};

/// Broadcaster instance for a specific fee config
pub struct Broadcaster {
    transport: Arc<dyn WakuTransport>,
    pub chain_id: ChainId,
    /// Railgun address of the broadcaster (fee recipient)
    pub address: RailgunAddress,
    pub identifier: Option<String>,
    pub fee: Fee,

    timeout: web_time::Duration,
    retry_delay: web_time::Duration,
}

/// Fee information for a specific token from a broadcaster.
#[derive(Debug, Clone)]
pub struct Fee {
    pub token: Address,
    /// Fee per unit gas, where the fee is in the token's base units and the gas
    /// is in units of ether (1e18)
    pub per_unit_gas: u128,
    pub recipient: RailgunAddress,
    /// Unix timestamp when this fee expires
    pub expiration: u64,
    /// UUID for this fee offer
    pub fees_id: String,
    /// Number of wallets available for broadcasting
    pub available_wallets: u32,
    /// Address of the relay adapt contract
    pub relay_adapt: Address,
    /// Reliability score (0-100)
    pub reliability: u32,
    /// List keys required by the broadcaster for POI selection
    pub list_keys: Vec<ListKey>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChainType {
    Evm = 0,
}

#[derive(Debug, Error)]
pub enum BroadcastError {
    #[error("Key: {0}")]
    SharedKey(#[from] KeyError),
    #[error("Serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("Encryption: {0}")]
    Encryption(#[from] crate::crypto::aes::AesError),
    #[error("Invalid response: {0}")]
    InvalidResponse(String),
    #[error("Missing fee information for transaction")]
    MissingFee,
    #[error("Missing Txid leaf hash")]
    MissingTxidLeaf,
    #[error("Timeout while sending message")]
    Timeout,
    #[error("Transport error: {0}")]
    Transport(#[from] WakuTransportError),
}

#[serde_as]
#[derive(Debug, Clone, Serialize)]
struct BroadcastParamsRaw {
    #[serde(rename = "txidVersion")]
    txid_version: TxidVersion,
    to: Address,
    data: Bytes,
    #[serde(rename = "broadcasterViewingKey")]
    broadcaster_viewing_key: ViewingPublicKey,
    #[serde(rename = "chainID")]
    chain_id: ChainId,
    #[serde(rename = "chainType")]
    chain_type: ChainType,
    #[serde(rename = "minGasPrice")]
    #[serde_as(as = "serde_with::DisplayFromStr")]
    min_gas_price: u128,
    #[serde(rename = "feesID")]
    fees_id: String,
    #[serde(rename = "useRelayAdapt")]
    use_relay_adapt: bool,
    #[serde(rename = "devLog")]
    dev_log: bool,
    #[serde(rename = "minVersion")]
    min_version: String,
    #[serde(rename = "maxVersion")]
    max_version: String,
    #[serde(rename = "preTransactionPOIsPerTxidLeafPerList")]
    pre_transaction_pois_per_txid_leaf_per_list: PreTransactionPoisPerTxidLeafPerList,
}

#[derive(Debug, Clone, Serialize)]
struct BroadcastMessage {
    pub method: String,
    pub params: BroadcastMessageParams,
}

#[derive(Debug, Clone, Serialize)]
struct BroadcastMessageParams {
    pub pubkey: ViewingPublicKey,
    #[serde(rename = "encryptedData")]
    pub encrypted_data: EncryptedData,
}

#[derive(Deserialize)]
struct RpcResult {
    result: EncryptedData,
}

#[derive(Debug, Deserialize)]
struct TransactResponse {
    // id: Option<String>,
    #[serde(rename = "txHash")]
    tx_hash: Option<TxHash>,
    error: Option<String>,
}

type EncryptedData = (FixedBytes<32>, Bytes);

const MIN_BROADCASTER_VERSION: &str = "8.0.0";
const MAX_BROADCASTER_VERSION: &str = "8.999.0";

impl Broadcaster {
    pub fn new(
        transport: Arc<dyn WakuTransport>,
        chain_id: ChainId,
        address: RailgunAddress,
        identifier: Option<String>,
        fee: Fee,
    ) -> Self {
        Self {
            transport,
            chain_id,
            address,
            identifier,
            fee,
            timeout: web_time::Duration::from_secs(120),
            retry_delay: web_time::Duration::from_secs(5),
        }
    }

    pub async fn broadcast<R: Rng>(
        &self,
        transaction: &PoiProvedTx,
        rng: &mut R,
    ) -> Result<TxHash, BroadcastError> {
        let fees_id = match &transaction.fee {
            Some(fee) => fee.fees_id.clone(),
            None => return Err(BroadcastError::MissingFee),
        };

        info!(
            "Broadcasting: {:?}",
            transaction
                .operations
                .iter()
                .map(|op| op.to_string())
                .collect::<Vec<_>>()
        );

        let pre_transaction_pois_per_txid_leaf_per_list = new_pre_transaction_pois(&transaction)?;
        let (encrypted_data, pubkey, shared_secret) = encrypt_transaction(
            BroadcastParamsRaw {
                txid_version: TxidVersion::V2PoseidonMerkle,
                to: transaction.tx_data.to,
                data: transaction.tx_data.data.clone().into(),
                broadcaster_viewing_key: self.address.viewing_pubkey(),
                chain_id: self.chain_id,
                chain_type: ChainType::Evm,
                min_gas_price: transaction.min_gas_price,
                fees_id,
                use_relay_adapt: false,
                dev_log: true,
                min_version: MIN_BROADCASTER_VERSION.to_string(),
                max_version: MAX_BROADCASTER_VERSION.to_string(),
                pre_transaction_pois_per_txid_leaf_per_list,
            },
            self.address.viewing_pubkey(),
            rng,
        )?;

        let message = BroadcastMessage {
            method: "transact".to_string(),
            params: BroadcastMessageParams {
                pubkey,
                encrypted_data,
            },
        };

        self.send(shared_secret, message).await
    }

    /// Send the message via the waku transport.
    ///
    /// Subscribes to the response topic via Filter (live push) for prompt
    /// delivery, while also polling Store as a fallback. Messages are
    /// deduplicated by payload hash so re-delivered messages are ignored.
    async fn send(
        &self,
        shared_secret: SharedKey,
        message: BroadcastMessage,
    ) -> Result<TxHash, BroadcastError> {
        let payload = serde_json::to_vec(&message)?;
        let req_topic = &transact_content_topic(self.chain_id);
        let resp_topic = &transact_response_content_topic(self.chain_id);

        // Subscribe to response topic via Filter for live push delivery.
        let mut filter_stream = self
            .transport
            .subscribe(vec![resp_topic.to_string()])
            .await?;

        let start_time = web_time::Instant::now();
        let resend_interval = web_time::Duration::from_secs(30);

        // Send the message once upfront.
        info!("Sending message to topic {}", req_topic);
        self.transport.send(req_topic, payload.clone()).await?;
        let mut last_send = web_time::Instant::now();
        let mut last_store_poll = web_time::Instant::now();

        // Dedup messages by payload hash to avoid re-processing.
        let mut seen: HashSet<u64> = HashSet::new();

        loop {
            let elapsed = start_time.elapsed();
            if elapsed >= self.timeout {
                return Err(BroadcastError::Timeout);
            }

            // Drain any messages that arrived via Filter (non-blocking).
            while let Some(msg) = poll_next_ready(&mut filter_stream) {
                let hash = hash_payload(&msg.payload);
                if seen.insert(hash) {
                    if let Some(tx_hash) = decode_response(&shared_secret, &msg.payload)? {
                        return Ok(tx_hash);
                    }
                }
            }

            // Poll Store as a fallback every retry_delay interval.
            if last_store_poll.elapsed() >= self.retry_delay {
                last_store_poll = web_time::Instant::now();
                info!("Polling Store for response...");
                match self.transport.retrieve_historical(resp_topic).await {
                    Ok(msgs) => {
                        for msg in &msgs {
                            let hash = hash_payload(&msg.payload);
                            if seen.insert(hash) {
                                if let Some(tx_hash) =
                                    decode_response(&shared_secret, &msg.payload)?
                                {
                                    return Ok(tx_hash);
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("retrieve_historical errored: {e}");
                    }
                }
            }

            // Re-send periodically in case the original message was lost.
            if last_send.elapsed() >= resend_interval {
                info!("Re-sending message to topic {}", req_topic);
                self.transport.send(req_topic, payload.clone()).await?;
                last_send = web_time::Instant::now();
            }

            // Short sleep to avoid busy-looping between Filter drains.
            sleep(web_time::Duration::from_millis(250)).await;
        }
    }
}

impl Serialize for ChainType {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_u8(*self as u8)
    }
}

fn new_pre_transaction_pois(
    transaction: &PoiProvedTx,
) -> Result<PreTransactionPoisPerTxidLeafPerList, BroadcastError> {
    let mut pre_transaction_pois_per_txid_leaf_per_list: PreTransactionPoisPerTxidLeafPerList =
        HashMap::new();
    for operation in &transaction.operations {
        let txid_leaf = operation
            .txid_leaf_hash
            .ok_or(())
            .map_err(|_| BroadcastError::MissingTxidLeaf)?;

        for (list_key, poi) in &operation.pois {
            pre_transaction_pois_per_txid_leaf_per_list
                .entry(list_key.clone())
                .or_default()
                .insert(txid_leaf, poi.clone());
        }
    }
    Ok(pre_transaction_pois_per_txid_leaf_per_list)
}

fn encrypt_transaction<R: Rng>(
    params: BroadcastParamsRaw,
    broadcaster_viewing_key: ViewingPublicKey,
    rng: &mut R,
) -> Result<(EncryptedData, ViewingPublicKey, SharedKey), BroadcastError> {
    info!(
        "Encrypting transaction for broadcast with params: {}",
        serde_json::to_string_pretty(&params)?
    );

    let random_key: ViewingKey = rng.random();
    let random_pubkey = random_key.public_key();
    let shared_secret = random_key.derive_shared_secret(broadcaster_viewing_key)?;

    info!("Random key: {}", random_key);
    info!("Random pubkey: {}", random_pubkey);
    info!("Derived shared secret for encryption: {}", shared_secret);
    let raw = serde_json::to_vec(&params)?;
    let chunks = raw.chunks(32).collect::<Vec<_>>();
    let encrypted = shared_secret.encrypt_gcm(&chunks, rng)?;

    let mut iv_tag = [0u8; 32];
    iv_tag[..16].copy_from_slice(&encrypted.iv);
    iv_tag[16..].copy_from_slice(&encrypted.tag);

    let data: Vec<u8> = encrypted.data.into_iter().flatten().collect();

    Ok(((iv_tag.into(), data.into()), random_pubkey, shared_secret))
}

/// Non-blockingly poll the next ready item from a stream.
/// Returns `Some(item)` if a message is immediately available, `None` otherwise.
fn poll_next_ready<S: Stream + Unpin>(stream: &mut S) -> Option<S::Item> {
    match Pin::new(stream).poll_next(&mut std::task::Context::from_waker(
        futures::task::noop_waker_ref(),
    )) {
        Poll::Ready(Some(item)) => Some(item),
        _ => None,
    }
}

/// Hash a payload for deduplication purposes.
fn hash_payload(payload: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    payload.hash(&mut hasher);
    hasher.finish()
}

/// Decode a broadcaster response message. If the message is not a valid response,
/// returns Ok(None). If the message is a valid response but indicates an error,
/// returns Err.
fn decode_response(
    shared_secret: &SharedKey,
    payload: &[u8],
) -> Result<Option<TxHash>, BroadcastError> {
    let encrypted_resp: RpcResult = match serde_json::from_slice(payload) {
        Ok(resp) => resp,
        Err(e) => {
            warn!("Error deserializing broadcaster response: {}", e);
            return Ok(None);
        }
    };

    let encrypted_resp = encrypted_resp.result;
    let iv: [u8; 16] = encrypted_resp.0[..16]
        .try_into()
        .map_err(|e| BroadcastError::InvalidResponse(format!("Invalid IV length: {}", e)))?;
    let tag: [u8; 16] = encrypted_resp.0[16..]
        .try_into()
        .map_err(|e| BroadcastError::InvalidResponse(format!("Invalid tag length: {}", e)))?;
    let data: Vec<Vec<u8>> = encrypted_resp
        .1
        .chunks(32)
        .map(|chunk| chunk.to_vec())
        .collect();
    let ciphertext = Ciphertext { iv, tag, data };
    let decrypted_resp = match shared_secret.decrypt_gcm(&ciphertext) {
        Ok(decrypted) => decrypted,
        Err(e) => {
            //? Common, since decryption will fail if the message isn't
            //? a response to our request and thus uses a different shared
            //? key.
            info!("Error decrypting broadcaster response: {}", e);
            return Ok(None);
        }
    };

    //? Now that the decryption succeeded, we know that this message is a
    //? response to our request, since the shared decryption key is derived
    //? from our random request-specific key.
    let resp: Vec<u8> = decrypted_resp.into_iter().flatten().collect();
    let resp: TransactResponse = match serde_json::from_slice(&resp) {
        Ok(resp) => resp,
        Err(e) => {
            error!("Error deserializing decrypted broadcaster response: {}", e);
            return Err(BroadcastError::Serde(e));
        }
    };

    if let Some(error) = resp.error {
        error!("Broadcaster returned error: {}", error);
        return Err(BroadcastError::InvalidResponse(error));
    }

    let Some(tx_hash) = resp.tx_hash else {
        error!("Broadcaster response missing tx hash");
        return Err(BroadcastError::InvalidResponse(
            "Missing tx hash".to_string(),
        ));
    };

    return Ok(Some(tx_hash));
}

#[cfg(test)]
mod test {
    use alloy::primitives::address;
    use rand::SeedableRng;
    use rand_chacha::ChaChaRng;
    use ruint::uint;

    use super::*;
    use crate::{
        crypto::keys::{ByteKey, HexKey},
        railgun::poi::PreTransactionPoi,
    };

    #[test]
    fn test_serialize_params() {
        let broadcaster_viewing = ViewingKey::from_bytes([5u8; 32]);
        let params = test_params(broadcaster_viewing.public_key());
        let serialized = serde_json::to_string_pretty(&params).unwrap();

        insta::assert_snapshot!(serialized);
    }

    #[test]
    fn test_encrypt_transaction() {
        let broadcaster_viewing = ViewingKey::from_bytes([5u8; 32]);
        let params = test_params(broadcaster_viewing.public_key());

        let mut rng = ChaChaRng::seed_from_u64(0);
        let encrypted =
            encrypt_transaction(params, broadcaster_viewing.public_key(), &mut rng).unwrap();

        insta::assert_debug_snapshot!(encrypted);
    }

    #[test]
    fn test_shared_secret() {
        let broadcaster_private = ViewingKey::from_hex(
            "dcdf3ddbf82cb2194571d5c3411468adfced2909ceea3dee59205cdf81a4f945",
        )
        .unwrap();
        let broadcaster_address: RailgunAddress = "0zk1qyjftlcuuxwjj574e5979wzt5veel9wmnh8peq6slvd668pz9ggzerv7j6fe3z53latpxdq2zqzs7l780x9gu7hfsgn93m27fwx3k6pk8fsrtgrp45ywuctqpkg".parse().unwrap();

        assert_eq!(
            broadcaster_private.public_key(),
            broadcaster_address.viewing_pubkey()
        );

        let random_key = ViewingKey::from_hex(
            "090f9cf59c24447df87142aa7918bedabb19a10c038ecdb4e0e4355d1cf6a410",
        )
        .unwrap();
        let shared1 = random_key
            .derive_shared_secret(broadcaster_address.viewing_pubkey())
            .unwrap();
        let shared2 = broadcaster_private
            .derive_shared_secret(random_key.public_key())
            .unwrap();

        assert_eq!(shared1.to_hex(), shared2.to_hex());
        assert_eq!(
            shared1.to_hex(),
            "d9cdcb9174f52e134780a77cfca0c1db973940a55b87a8b9616f25436033ff48"
        );
    }

    #[test]
    fn test_decode_response_ok() {
        let shared_secret =
            SharedKey::from_hex("0e55de7635f98fc8a740e2e23328540b04a95d9784ff61af4a509b598795865d")
                .unwrap();
        let payload = "7b226a736f6e727063223a22322e30222c22726573756c74223a5b22307834363639396533313465666432613932663637656333643266636563656533653139373665303136303638313865653036393032376137313239613161376165222c2230786361333232326233393362346332616638633763333736353664663861636462626664623039376164303735336436626231643366326439303962356562653962656434333537356263643739636332613162333263353033353465316138316232343662366330323638323366396164343866376561383265656433326138636661393164393235316437376365626263643131646666653765386435225d7d";
        let payload = hex::decode(payload).unwrap();

        let resp = decode_response(&shared_secret, &payload).unwrap();
        insta::assert_debug_snapshot!(resp);
    }

    fn test_params(broadcaster_viewing_key: ViewingPublicKey) -> BroadcastParamsRaw {
        let pre_transaction_pois_per_txid_leaf_per_list = HashMap::from([(
            "test_list_key".into(),
            HashMap::from([(
                uint!(20_U256).into(),
                PreTransactionPoi {
                    proof: prover::Proof {
                        a: prover::G1Affine {
                            x: uint!(10_U256),
                            y: uint!(20_U256),
                        },
                        b: prover::G2Affine {
                            x: [uint!(30_U256), uint!(40_U256)],
                            y: [uint!(50_U256), uint!(60_U256)],
                        },
                        c: prover::G1Affine {
                            x: uint!(70_U256),
                            y: uint!(80_U256),
                        },
                    },
                    txid_merkleroot: uint!(9_U256).into(),
                    poi_merkleroots: vec![uint!(10_U256).into(), uint!(11_U256).into()],
                    blinded_commitments_out: vec![uint!(12_U256).into(), uint!(13_U256).into()],
                    railgun_txid_if_has_unshield: uint!(14_U256).into(),
                },
            )]),
        )]);

        let params = BroadcastParamsRaw {
            txid_version: TxidVersion::V2PoseidonMerkle,
            to: address!("0x000000000000000000000000000000000000dead"),
            data: Bytes::from(vec![1, 2, 3, 4]),
            broadcaster_viewing_key,
            chain_id: 1,
            chain_type: ChainType::Evm,
            min_gas_price: 100,
            fees_id: "test-fees-id".to_string(),
            use_relay_adapt: false,
            dev_log: false,
            min_version: MIN_BROADCASTER_VERSION.to_string(),
            max_version: MAX_BROADCASTER_VERSION.to_string(),
            pre_transaction_pois_per_txid_leaf_per_list,
        };

        params
    }
}
