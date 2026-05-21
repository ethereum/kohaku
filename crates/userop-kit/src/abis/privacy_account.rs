use alloy::sol;

sol! {
    interface IPrivacyAccount {
        /// A tail call made by the PrivacyAccount after executing the fee calldata.
        #[derive(Debug)]
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
