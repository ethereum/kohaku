use alloy_sol_types::sol;

sol!(
    contract RelayerRegistry {
        event RelayerRegistered(bytes32 relayer, string ensName, address relayerAddress, uint256 stakedAmount);
    }

    contract RelayerAggregator {
        struct Relayer {
            address owner;
            uint256 balance;
            bool isRegistered;
            string[20] records;
        }
        function relayersData(bytes32[] _relayers, string[] _subdomains) external view returns (Relayer[]);
    }
);
