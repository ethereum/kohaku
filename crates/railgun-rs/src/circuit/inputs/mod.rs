pub mod transact_inputs;

pub use transact_inputs::{TransactCircuitInputs, TransactCircuitInputsError};

#[cfg(feature = "poi")]
pub mod poi_inputs;

#[cfg(feature = "poi")]
pub use poi_inputs::{PoiCircuitInputs, PoiCircuitInputsError};
