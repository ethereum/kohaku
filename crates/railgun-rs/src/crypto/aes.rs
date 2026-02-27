//! AES encryption and decryption using GCM and CTR modes.

use aes::{
    Aes256,
    cipher::{KeyIvInit, StreamCipher},
};
use aes_gcm::{
    AesGcm, KeyInit, Nonce,
    aead::{Aead, Payload, consts::U16},
};
use rand::Rng;

#[derive(Debug, PartialEq, Eq)]
pub struct Ciphertext {
    pub iv: [u8; 16],
    pub tag: [u8; 16],
    pub data: Vec<Vec<u8>>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CiphertextCtr {
    pub iv: [u8; 16],
    pub data: Vec<Vec<u8>>,
}

#[derive(Debug, thiserror::Error)]
pub enum AesError {
    #[error("encrypt error: {0}")]
    Gcm(aes_gcm::Error),
    #[error("decrypt error: {0}")]
    Decrypt(aes_gcm::Error),
    #[error("Encrypted data is too short")]
    DataTooShort,
}

type Aes256GcmU16 = AesGcm<Aes256, U16>;
type Aes256Ctr = ctr::Ctr128BE<aes::Aes256>;

pub fn encrypt_gcm<R: Rng + ?Sized>(
    plaintext: &[&[u8]],
    key: &[u8; 32],
    rand: &mut R,
) -> Result<Ciphertext, AesError> {
    let iv: &[u8; 16] = &rand.random();

    //? Safe to unwrap as key length is fixed
    let cipher = Aes256GcmU16::new_from_slice(key).unwrap();
    let nonce = Nonce::<U16>::from_slice(iv);

    let mut combined = Vec::new();
    let mut block_lengths = Vec::with_capacity(plaintext.len());
    for block in plaintext {
        block_lengths.push(block.len() as u32);
        combined.extend_from_slice(block);
    }

    let mut encrypted_raw = cipher
        .encrypt(
            nonce,
            Payload {
                msg: &combined,
                aad: &[],
            },
        )
        .map_err(AesError::Gcm)?;

    if encrypted_raw.len() < 16 {
        return Err(AesError::DataTooShort);
    }
    let tag_bytes = encrypted_raw.split_off(encrypted_raw.len() - 16);
    let tag: [u8; 16] = tag_bytes.try_into().unwrap();

    // Split back into per-block hex strings.
    let mut data = Vec::with_capacity(block_lengths.len());
    let mut offset = 0;
    for len in block_lengths {
        data.push(encrypted_raw[offset..offset + len as usize].to_vec());
        offset += len as usize;
    }

    Ok(Ciphertext { iv: *iv, tag, data })
}

pub fn decrypt_gcm(ciphertext: &Ciphertext, key: &[u8; 32]) -> Result<Vec<Vec<u8>>, AesError> {
    //? Safe to unwrap as key length is fixed
    let cipher = Aes256GcmU16::new_from_slice(key).unwrap();
    let nonce = Nonce::<U16>::from_slice(&ciphertext.iv);

    let mut combined = Vec::new();
    for block in &ciphertext.data {
        combined.extend_from_slice(block);
    }
    combined.extend_from_slice(&ciphertext.tag);

    let decrypted = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &combined,
                aad: &[],
            },
        )
        .map_err(AesError::Decrypt)?;

    // Split back into per-block hex strings.
    let mut data = Vec::with_capacity(ciphertext.data.len());
    let mut offset = 0;
    for block in &ciphertext.data {
        let len = block.len();
        data.push(decrypted[offset..offset + len].to_vec());
        offset += len;
    }

    Ok(data)
}

pub fn encrypt_ctr<R: Rng + ?Sized>(
    plaintext: &[&[u8]],
    key: &[u8; 32],
    rand: &mut R,
) -> CiphertextCtr {
    let iv: [u8; 16] = rand.random();
    let mut cipher = Aes256Ctr::new(key.into(), &iv.into());
    let mut data = Vec::with_capacity(plaintext.len());

    for block in plaintext {
        let mut buffer = block.to_vec();
        cipher.apply_keystream(&mut buffer);
        data.push(buffer);
    }

    CiphertextCtr { iv, data }
}

pub fn decrypt_ctr(ciphertext: &CiphertextCtr, key: &[u8; 32]) -> Vec<Vec<u8>> {
    let mut cipher = Aes256Ctr::new(key.into(), &ciphertext.iv.into());
    let mut data = Vec::with_capacity(ciphertext.data.len());

    for block in &ciphertext.data {
        let mut buffer = block.to_vec();
        cipher.apply_keystream(&mut buffer);
        data.push(buffer);
    }

    data
}

#[cfg(test)]
mod tests {
    use rand::SeedableRng;
    use rand_chacha::ChaChaRng;
    use tracing_test::traced_test;

    #[test]
    #[traced_test]
    fn gcm() {
        let mut rand = ChaChaRng::seed_from_u64(0);

        let key = [1u8; 32];
        let plaintext: &[&[u8]] = &[b"Hello, world! 1"];

        let ciphertext = super::encrypt_gcm(plaintext, &key, &mut rand).unwrap();
        let decrypted = super::decrypt_gcm(&ciphertext, &key).unwrap();

        for i in 0..plaintext.len() {
            assert_eq!(plaintext[i], &decrypted[i][..]);
        }
    }

    #[test]
    #[traced_test]
    fn gcm_snap() {
        let mut rand = ChaChaRng::seed_from_u64(0);

        let key = [1u8; 32];
        let plaintext: &[&[u8]] = &[b"Hello, world! 1", b"Hello, world! 2"];

        let ciphertext = super::encrypt_gcm(plaintext, &key, &mut rand).unwrap();
        insta::assert_debug_snapshot!(ciphertext);
    }

    #[test]
    #[traced_test]
    fn ctr() {
        let mut rand = ChaChaRng::seed_from_u64(0);

        let key = [1u8; 32];

        let plaintext: [&[u8]; 3] = [b"Hello, world! 1", b"Hello, world! 2", b"Hello, world! 3"];

        let ciphertext = super::encrypt_ctr(&plaintext, &key, &mut rand);
        let decrypted = super::decrypt_ctr(&ciphertext, &key);
        for i in 0..plaintext.len() {
            assert_eq!(plaintext[i], &decrypted[i][..]);
        }
    }

    #[test]
    #[traced_test]
    fn ctr_snap() {
        let mut rand = ChaChaRng::seed_from_u64(0);

        let key = [1u8; 32];
        let plaintext: [&[u8]; 3] = [b"Hello, world! 1", b"Hello, world! 2", b"Hello, world! 3"];

        let ciphertext = super::encrypt_ctr(&plaintext, &key, &mut rand);
        insta::assert_debug_snapshot!(ciphertext);
    }
}
