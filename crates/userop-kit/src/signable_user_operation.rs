use alloy::{
    dyn_abi::Eip712Domain,
    primitives::{Address, B256},
    signers::Signer,
    sol_types::SolStruct,
};
use serde::{Deserialize, Serialize};

use crate::{
    abis::entry_point::PackedUserOperation,
    signed_user_operation::SignedUserOperation,
    user_operation::{Authorization, UserOperation},
};

/// A signable UserOperation, which includes the UserOperation data alongside the EntryPoint to
/// which it will be sent.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignableUserOperation {
    pub user_op: UserOperation,
    pub entry_point: Address,
    pub(crate) domain: Eip712Domain,
}

impl SignableUserOperation {
    /// Signs the UserOperation with the provided signer
    pub async fn sign(
        &self,
        signer: &dyn Signer,
    ) -> Result<SignedUserOperation, alloy::signers::Error> {
        let mut user_op = self.user_op.clone();

        user_op.signature = signer
            .sign_hash(&self.signing_hash())
            .await?
            .as_bytes()
            .into();

        user_op.authorization = match user_op.authorization {
            Authorization::Eip7702(auth) => {
                let auth_hash = auth.signature_hash();
                let auth_sig = signer.sign_hash(&auth_hash).await?;
                Authorization::SignedEip7702(auth.into_signed(auth_sig))
            }
            Authorization::SignedEip7702(auth) => Authorization::SignedEip7702(auth),
            Authorization::None => Authorization::None,
        };

        Ok(SignedUserOperation {
            user_op: user_op,
            entry_point: self.entry_point,
        })
    }

    /// Returns the total gas limit for this UserOperation, including paymaster gas limits if
    /// applicable.
    pub fn total_gas_limit(&self) -> u128 {
        self.user_op.total_gas_limit()
    }

    /// Computes the EIP-712 signing hash for this UserOperation
    fn signing_hash(&self) -> B256 {
        PackedUserOperation::from(&self.user_op).eip712_signing_hash(&self.domain)
    }
}

#[cfg(all(test, native))]
mod tests {
    use alloy::{
        primitives::{Bytes, U256, address, b256},
        signers::{Signature, local::PrivateKeySigner},
    };

    use super::*;
    use crate::entry_point::{ENTRY_POINT_08, entry_point_08_domain};

    #[test]
    fn test_pack() {
        let op = test_user_operation();

        let packed = PackedUserOperation::from(&op.user_op);
        insta::assert_debug_snapshot!(packed);
    }

    #[test]
    fn test_hash() {
        let op = test_user_operation();
        let hash = op.signing_hash();
        insta::assert_debug_snapshot!(hash);
    }

    #[tokio::test]
    async fn test_sign() {
        let op = test_user_operation();
        let signer = PrivateKeySigner::from_bytes(&b256!(
            "0x00000000000000000000000000000000000000000000000000000000DEADBEEF"
        ))
        .unwrap();

        let signing_hash = op.signing_hash();
        let signed = op.sign(&signer).await.unwrap();
        let signature = signed.user_op.signature.clone();
        let signature = Signature::try_from(signature.as_ref()).expect("Invalid signature");
        insta::assert_debug_snapshot!(signature);

        let recovered = signature
            .recover_address_from_prehash(&signing_hash)
            .unwrap();
        assert_eq!(
            recovered,
            signer.address(),
            "Recovered address does not match signer address"
        );
    }

    fn test_user_operation() -> SignableUserOperation {
        SignableUserOperation {
            user_op: UserOperation {
                sender: address!("0x000000000000000000000000000000000000DEAD"),
                signature: Bytes::new(),
                nonce: U256::from(42),
                factory: Some(address!("0x000000000000000000000000000000000000BEEF")),
                factory_data: Some(Bytes::from_static(b"factory data")),
                call_data: Bytes::from_static(b"call data"),
                call_gas_limit: 100_000,
                verification_gas_limit: 50_000,
                pre_verification_gas: 10_000,
                max_fee_per_gas: 200,
                max_priority_fee_per_gas: 50,
                paymaster: Some(address!("0x000000000000000000000000000000000000FEED")),
                paymaster_verification_gas_limit: Some(20_000),
                paymaster_post_op_gas_limit: Some(30_000),
                paymaster_data: Some(Bytes::from_static(b"paymaster data")),
                authorization: Default::default(),
            },
            entry_point: ENTRY_POINT_08,
            domain: entry_point_08_domain(1),
        }
    }
}
