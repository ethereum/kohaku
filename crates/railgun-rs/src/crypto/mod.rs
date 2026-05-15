pub mod aes;
pub mod keys;
pub mod railgun_base_37;
pub mod railgun_txid;
pub mod railgun_zero;
pub mod serializable_np_index;

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
