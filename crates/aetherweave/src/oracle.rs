use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const REQUEST_LIMIT: u64 = 10_000;
const MIND_LIMIT: u64 = 5_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStats {
    pub request_rate: u64,
    pub cognitive_load: u64,
    pub failed_zks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlashEvent {
    pub vortex_id: String,
    pub deposit_id: String,
    pub reason: String,
    pub proof: String,
    pub timestamp: String,
}

pub struct SlashingOracle {
    pub stake_registry: HashMap<String, String>, // vortex_id -> deposit_id
    pub stats: HashMap<String, NodeStats>,       // vortex_id -> NodeStats
}

impl SlashingOracle {
    pub fn new() -> Self {
        Self {
            stake_registry: HashMap::new(),
            stats: HashMap::new(),
        }
    }

    pub fn monitor(&mut self) -> Vec<SlashEvent> {
        let mut slashes = Vec::new();
        let mut to_slash = Vec::new();

        for (vortex_id, stats) in &self.stats {
            if stats.request_rate > REQUEST_LIMIT {
                to_slash.push((vortex_id.clone(), "excessive request rate".to_string()));
            } else if stats.cognitive_load > MIND_LIMIT {
                to_slash.push((vortex_id.clone(), "excess cognitive load".to_string()));
            } else if self.has_failed_proofs(vortex_id, 5) {
                to_slash.push((vortex_id.clone(), "repeated ZK failures".to_string()));
            }
        }

        for (vortex_id, reason) in to_slash {
            if let Some(event) = self.slash(&vortex_id, &reason) {
                slashes.push(event);
            }
        }

        slashes
    }

    pub fn slash(&self, vortex_id: &str, reason: &str) -> Option<SlashEvent> {
        let deposit_id = self.stake_registry.get(vortex_id)?;

        let proof = self.build_slash_proof(vortex_id, deposit_id);

        Some(SlashEvent {
            vortex_id: vortex_id.to_string(),
            deposit_id: deposit_id.to_string(),
            reason: reason.to_string(),
            proof,
            timestamp: "2026-05-22T14:22:01Z".to_string(), // mock timestamp
        })
    }

    pub fn has_failed_proofs(&self, vortex_id: &str, count: u32) -> bool {
        if let Some(stats) = self.stats.get(vortex_id) {
            stats.failed_zks >= count
        } else {
            false
        }
    }

    pub fn build_slash_proof(&self, _vortex_id: &str, _deposit_id: &str) -> String {
        // Mock ZK proof generation
        "0xabcdef1234567890".to_string()
    }
}
