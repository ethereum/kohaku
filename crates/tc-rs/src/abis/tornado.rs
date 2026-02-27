use alloy_sol_types::sol;

sol!(
    #[sol(rpc)]
    contract MerkleTreeWithHistory {
        // @dev Whether the root is present in the root history
        function isKnownRoot(bytes32 _root) public view returns(bool);

        // @dev Returns the last root
        function getLastRoot() public view returns(bytes32);
    }

    #[sol(rpc)]
    contract Tornado {
        event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp);
        event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee);

        // @dev Deposit funds into the contract.
        #[derive(Debug)]
        function deposit(bytes32 _commitment) external payable;

        // @dev Withdraw a deposit from the contract.
        #[derive(Debug)]
        function withdraw(bytes calldata _proof, bytes32 _root, bytes32 _nullifierHash, address payable _recipient, address payable _relayer, uint256 _fee, uint256 _refund) external payable;

        // @dev whether a note is already spent
        function isSpent(bytes32 _nullifierHash) public view returns(bool);

        // @dev whether an array of notes is already spent
        function isSpentArray(bytes32[] calldata _nullifierHashes) external view returns(bool[] memory spent);
    }
);
