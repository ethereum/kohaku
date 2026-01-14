#!/bin/bash

# $1: secret key binded to PUB_KEY 
# $2: API_KEY
# $3: Contract name to deploy

# Configuration
CONTRACT_NAME="DeployFactories.s.sol"   

PRIVATE_KEY=$1
PUB_KEY="0x9140286CDA95d59fa5f29ecb11dDe1F817999F9E"

API_KEY=$2
RPC="https://api.zan.top/arb-sepolia"
# RPC="wss://ethereum-sepolia-rpc.publicnode.com"

# Deploy to network
echo "Deploying $CONTRACT_NAME with Forge..."
echo "RPC used: "$RPC
echo "balance:"

cast balance $PUB_KEY --rpc-url $RPC


forge script $CONTRACT_NAME \
--rpc-url $RPC \
--private-key $PRIVATE_KEY \
--broadcast \
--tc $3 \
--priority-gas-price 1 \
-vvvv

# Verify
forge script $CONTRACT_NAME \
--rpc-url $RPC \
--private-key $PRIVATE_KEY \
--broadcast \
--tc $3 \
--etherscan-api-key $API_KEY \
--verify \
--resume

# # with ledger
# forge script $CONTRACT_NAME --rpc-url $RPC --ledger --broadcast --tc Script_Deploy_ETHDilithium --etherscan-api-key $API_KEY_OPTIMISM --verify --priority-gas-price 1
