#!/usr/bin/env python3
import pytest
from blockchain_z import KuramotoBlockchainEngine, GHOST_THRESHOLD, CANONIZATION_THRESHOLD, compute_seal, seal_entropy_analysis

@pytest.fixture
def fresh_engine():
    return KuramotoBlockchainEngine(n_validators=16, coupling=4.0)

def test_genesis_block_phi_c(fresh_engine):
    block = fresh_engine.mine_block(max_iterations=3000)
    assert 0.0 <= block["phi_c"] <= 1.0

def test_phi_c_increases_with_coupling():
    eng_low = KuramotoBlockchainEngine(n_validators=16, coupling=0.5)
    bl_low = eng_low.mine_block(max_iterations=2000)
    eng_high = KuramotoBlockchainEngine(n_validators=16, coupling=8.0)
    bl_high = eng_high.mine_block(max_iterations=2000)
    assert bl_high["phi_c"] > bl_low["phi_c"]

def test_fork_detection_low_coupling(fresh_engine):
    fresh_engine.K = 0.2
    block = fresh_engine.mine_block(max_iterations=500)
    assert block["fork_detected"] is True

def test_canonization_threshold_reached(fresh_engine):
    fresh_engine.K = 6.0
    block = fresh_engine.mine_block(max_iterations=5000)
    assert block["phi_c"] >= CANONIZATION_THRESHOLD

def test_seal_entropy_analysis():
    seal = compute_seal(b"test data for blockchain Z")
    analysis = seal_entropy_analysis(seal)
    assert analysis["valid"] is True
    assert analysis["passes_threshold"] is True

def test_mine_block_advances_count(fresh_engine):
    assert fresh_engine.block_count == 0
    fresh_engine.mine_block(max_iterations=2000)
    assert fresh_engine.block_count == 1

def test_smart_contract_deployment(fresh_engine):
    contract = fresh_engine.deploy_smart_contract("TestContract", [0, 1])
    assert contract["status"] == "DEPLOYED"
    assert contract["boost_factor"] == 2.0

def test_pending_transactions_included(fresh_engine):
    fresh_engine.create_transaction("TX", {"x": 1})
    fresh_engine.create_transaction("TX", {"y": 2})
    block = fresh_engine.mine_block(max_iterations=2000)
    assert block["transactions"] == 2