use alloy::sol;

sol! {
    contract Tornado {
        // @dev Withdraw a deposit from the contract.
        #[derive(Debug)]
        function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund) external payable;
    }
}
