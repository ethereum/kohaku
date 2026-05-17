fn main() {
    cfg_aliases::cfg_aliases! {
        native: { not(target_arch = "wasm32") },
        wasm: { all(target_arch = "wasm32") },
        js: { all(target_arch = "wasm32", feature = "js") },
    }
}
