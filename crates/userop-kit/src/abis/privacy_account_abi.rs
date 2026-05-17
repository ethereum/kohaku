//! Because alloy automatically creates helper structs for each contract that we don't want to
//! expose in the public API, we put the sol definition in a seperate file so we can explicitly
//! expose the `IPrivacyAccount::Call` struct.

use alloy::sol;

sol! {
    interface IPrivacyAccount {
        /// A tail call made by the PrivacyAccount after executing the fee calldata.
        struct Call {
            address target;
            bytes data;
        }

        function execute(
            bytes calldata feeCalldata,
            Call[] calldata tail
        ) external;
    }
}
