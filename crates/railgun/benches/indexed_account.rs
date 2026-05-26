#[cfg(bench)]
criterion::criterion_main!(bench::benches);

#[cfg(not(bench))]
fn main() {}

#[cfg(bench)]
pub mod bench {
    use alloy::primitives::{U256, address};
    use criterion::{self, criterion_group};
    use railgun::{
        account::signer::{PrivateKeySigner, RailgunSigner},
        bench_helpers::{
            EncryptableNote, IndexedAccount, Note, encrypt::encrypt_shield, transfer::TransferNote,
        },
        caip::AssetId,
        indexer::syncer::{Shield, Transact},
    };
    use rand::random;

    pub fn bench_handle_shield_match(c: &mut criterion::Criterion) {
        let signer = PrivateKeySigner::new_evm(random(), random(), 1);

        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let value = 100;
        let rng = &mut rand::rng();

        let shield = encrypt_shield(signer.address(), asset, value, rng).unwrap();
        let event = Shield {
            tree_number: 1,
            leaf_index: 0,
            npk: shield.preimage.npk.into(),
            token: shield.preimage.token.try_into().unwrap(),
            value: U256::from(shield.preimage.value),
            ciphertext: shield.ciphertext.clone().into(),
            shield_key: *shield.ciphertext.shieldKey,
            hash: None,
        };

        c.bench_function("handle_shield_event", |b| {
            b.iter_batched(
                || IndexedAccount::from_state(signer.clone(), Default::default()),
                |mut account| account.handle_shield_event(&event).unwrap(),
                criterion::BatchSize::SmallInput,
            );
        });
    }

    fn bench_handle_transact_match(c: &mut criterion::Criterion) {
        let sender = PrivateKeySigner::new_evm(random(), random(), 1);
        let recipient = PrivateKeySigner::new_evm(random(), random(), 1);

        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let value = 100;
        let memo = "Test transfer";
        let transact = TransferNote::new(
            sender.viewing_key(),
            recipient.address(),
            asset,
            value,
            random(),
            memo,
        );

        let rng = &mut rand::rng();
        let ciphertext = transact.encrypt(rng).unwrap();
        let event = Transact {
            tree_number: 1,
            leaf_index: 2,
            hash: transact.hash().into(),
            ciphertext: ciphertext.clone().into(),
            blinded_sender_viewing_key: *ciphertext.blindedSenderViewingKey,
            blinded_receiver_viewing_key: *ciphertext.blindedReceiverViewingKey,
            annotation_data: ciphertext.annotationData.to_vec(),
        };

        c.bench_function("handle_transact_event", |b| {
            b.iter_batched(
                || IndexedAccount::from_state(recipient.clone(), Default::default()),
                |mut account| account.handle_transact_event(&event).unwrap(),
                criterion::BatchSize::SmallInput,
            );
        });
    }

    fn bench_handle_shield_nomatch(c: &mut criterion::Criterion) {
        let signer = PrivateKeySigner::new_evm(random(), random(), 1);
        let other_signer = PrivateKeySigner::new_evm(random(), random(), 1);
        let mut account = IndexedAccount::from_state(signer.clone(), Default::default());

        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let value = 100;
        let rng = &mut rand::rng();

        let shield = encrypt_shield(other_signer.address(), asset, value, rng).unwrap();
        let event = Shield {
            tree_number: 1,
            leaf_index: 0,
            npk: shield.preimage.npk.into(),
            token: shield.preimage.token.try_into().unwrap(),
            value: U256::from(shield.preimage.value),
            ciphertext: shield.ciphertext.clone().into(),
            shield_key: *shield.ciphertext.shieldKey,
            hash: None,
        };

        c.bench_function("handle_shield_event_nomatch", |b| {
            b.iter(|| {
                account.handle_shield_event(&event).unwrap();
            });
        });
    }

    fn bench_handle_transact_nomatch(c: &mut criterion::Criterion) {
        let sender = PrivateKeySigner::new_evm(random(), random(), 1);
        let recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let other_recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let mut account = IndexedAccount::from_state(recipient.clone(), Default::default());

        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let value = 100;
        let memo = "Test transfer";
        let transact = TransferNote::new(
            sender.viewing_key(),
            other_recipient.address(),
            asset,
            value,
            random(),
            memo,
        );

        let rng = &mut rand::rng();
        let ciphertext = transact.encrypt(rng).unwrap();
        let event = Transact {
            tree_number: 1,
            leaf_index: 2,
            hash: transact.hash().into(),
            ciphertext: ciphertext.clone().into(),
            blinded_sender_viewing_key: *ciphertext.blindedSenderViewingKey,
            blinded_receiver_viewing_key: *ciphertext.blindedReceiverViewingKey,
            annotation_data: ciphertext.annotationData.to_vec(),
        };

        c.bench_function("handle_transact_event_nomatch", |b| {
            b.iter(|| {
                account.handle_transact_event(&event).unwrap();
            });
        });
    }

    criterion_group!(
        benches,
        bench_handle_shield_match,
        bench_handle_transact_match,
        bench_handle_shield_nomatch,
        bench_handle_transact_nomatch,
    );
}
