use std::{collections::HashMap, sync::Mutex};

use num_bigint::BigInt;
use ruint::aliases::U256;
use wasmer::{Module, Store};

use crate::circuit::artifact_loader::ArtifactLoader;

pub struct WasmerWitnessCalculator<A> {
    artifact_loader: A,
    inner: Mutex<Option<WitnessCalcState>>,
}

struct WitnessCalcState {
    store: Store,
    calculator: ark_circom::WitnessCalculator,
    circuit_name: String,
}

impl<A: ArtifactLoader> WasmerWitnessCalculator<A> {
    pub fn new(artifact_loader: A) -> Self {
        Self {
            artifact_loader,
            inner: Mutex::new(None),
        }
    }
}

impl<A: ArtifactLoader + Send + Sync + 'static> WasmerWitnessCalculator<A> {
    pub async fn calculate_witness(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Vec<U256>, String> {
        // Check if reload needed without holding the lock across await
        let needs_reload = {
            let guard = self.inner.lock().map_err(|e| e.to_string())?;
            match &*guard {
                Some(state) => state.circuit_name != circuit_name,
                None => true,
            }
        };

        if needs_reload {
            let wasm_bytes = self
                .artifact_loader
                .load_wasm(circuit_name)
                .await
                .map_err(|e| e.to_string())?;
            let mut store = Store::default();
            let module = Module::new(&store, &wasm_bytes).map_err(|e| e.to_string())?;
            let calculator = ark_circom::WitnessCalculator::from_module(&mut store, module)
                .map_err(|e| e.to_string())?;
            let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
            *guard = Some(WitnessCalcState {
                store,
                calculator,
                circuit_name: circuit_name.to_string(),
            });
        }

        let mut guard = self.inner.lock().map_err(|e| e.to_string())?;
        let state = guard.as_mut().unwrap();

        // Convert inputs from U256 to BigInt
        let inputs: HashMap<String, Vec<BigInt>> = inputs
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().map(BigInt::from).collect()))
            .collect();

        // Calculate witness
        let witness = state
            .calculator
            .calculate_witness(&mut state.store, inputs, true)
            .map_err(|e| e.to_string())?;

        // Convert witness to U256
        let witness: Vec<U256> = witness.into_iter().map(U256::from).collect();

        Ok(witness)
    }
}
