pub mod aes;
pub mod keys;
pub mod railgun_base_37;
#[cfg(feature = "poi")]
pub mod railgun_txid;
pub mod railgun_zero;

pub fn concat_arrays<const A: usize, const B: usize, const C: usize>(
    a: &[u8; A],
    b: &[u8; B],
) -> [u8; C] {
    assert_eq!(A + B, C);
    let mut out = [0u8; C];
    out[..A].copy_from_slice(a);
    out[A..].copy_from_slice(b);
    out
}

pub fn concat_arrays_3<const A: usize, const B: usize, const C: usize, const D: usize>(
    a: &[u8; A],
    b: &[u8; B],
    c: &[u8; C],
) -> [u8; D] {
    assert_eq!(A + B + C, D);
    let mut out = [0u8; D];
    out[..A].copy_from_slice(a);
    out[A..A + B].copy_from_slice(b);
    out[A + B..].copy_from_slice(c);
    out
}
