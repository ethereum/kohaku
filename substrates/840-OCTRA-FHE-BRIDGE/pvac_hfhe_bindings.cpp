// pvac_hfhe_bindings.cpp
// Substrato 840.1 — Python bindings for PVAC-HFHE

#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <pybind11/numpy.h>
#include "pvac/fhe_engine.h"
#include "pvac/circuit_builder.h"
#include "pvac/zkp_verifier.h"

namespace py = pybind11;

PYBIND11_MODULE(pvac_hfhe, m) {
    m.doc() = "ARKHE FHE Bridge — Python bindings for PVAC-HFHE";

    // FHE Engine
    py::class_<pvac::FHEEngine>(m, "FHEEngine")
        .def(py::init<const std::string&>(), py::arg("backend") = "seal")
        .def("generate_keys", &pvac::FHEEngine::generateKeys)
        .def("encrypt", &pvac::FHEEngine::encrypt)
        .def("decrypt", &pvac::FHEEngine::decrypt)
        .def("evaluate", &pvac::FHEEngine::evaluate)
        .def("add_ciphertexts", &pvac::FHEEngine::addCiphertexts)
        .def("multiply_ciphertexts", &pvac::FHEEngine::multiplyCiphertexts)
        .def("serialize_key", &pvac::FHEEngine::serializeKey)
        .def("deserialize_key", &pvac::FHEEngine::deserializeKey);

    // Circuit Builder
    py::class_<pvac::CircuitBuilder>(m, "CircuitBuilder")
        .def(py::init<>())
        .def("from_onnx", &pvac::CircuitBuilder::fromOnnx)
        .def("from_pytorch", &pvac::CircuitBuilder::fromPyTorch)
        .def("optimize_depth", &pvac::CircuitBuilder::optimizeDepth)
        .def("serialize_circuit", &pvac::CircuitBuilder::serializeCircuit)
        .def("deserialize_circuit", &pvac::CircuitBuilder::deserializeCircuit);

    // ZKP Verifier
    py::class_<pvac::ZKPVerifier>(m, "ZKPVerifier")
        .def(py::init<>())
        .def("generate_proof", &pvac::ZKPVerifier::generateProof)
        .def("verify_proof", &pvac::ZKPVerifier::verifyProof);
}
