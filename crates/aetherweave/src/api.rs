use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VortexCreate {
    pub gamma: f64,
    pub alpha: f64,
    pub omega: f64,
    pub metadata: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VortexResponse {
    pub vortex_id: String,
    pub status: String,
    pub kappa: f64,
    pub tau: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Target {
    pub id: i32,
    pub target_type: String, // "σ" or "ψ"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraidRequest {
    pub vortex_id: String,
    pub path: String, // "clockwise" | "counterclockwise"
    pub iterations: i32,
    pub targets: Vec<Target>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraidResponse {
    pub braid_id: String,
    pub status: String,
    pub unitary_matrix: Vec<Vec<f64>>, // using f64 since complex is tricky in wasm abi, represents shape (2,2)
    pub new_ti: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasureRequest {
    pub braid_id: String,
    pub mode: String, // "parity" | "charge"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeasureResponse {
    pub vortex_id: String,
    pub measured_charge: String, // "1" | "ψ"
    pub probability: f64,
    pub timestamp: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraidPathElement {
    pub element_type: String, // "adjacent" | "non_adjacent"
    pub coefficient: f64,
    pub variables: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BraidLog {
    pub vortex_id: String,
    pub braid_path: Vec<BraidPathElement>,
    pub n_steps: i32,
    pub timestamp: String,
}
