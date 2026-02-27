{
  description = "Skylock dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };

        rustToolchain = pkgs.rust-bin.stable."1.88.0".default.override {
          extensions = [
            "rust-src"
            "llvm-tools"
          ];
          targets = [ "wasm32-unknown-unknown" ];
        };

        rustfmtNightly = pkgs.rust-bin.nightly.latest.rustfmt;
      in
      {
        devShells = {
          default = pkgs.mkShell {
            packages = [
              # Rust toolchain and extensions
              rustfmtNightly
              rustToolchain
              pkgs.rust-analyzer
              pkgs.just
              pkgs.foundry

              # Wasm tools
              pkgs.binaryen
              pkgs.wasm-pack
              pkgs.nodejs_22
              pkgs.pnpm
              pkgs.twiggy

              # Cargo tools
              pkgs.cargo-bloat
              pkgs.cargo-machete
              pkgs.cargo-sort
              pkgs.cargo-llvm-cov

              pkgs.sops
            ];
          };

          ci = pkgs.mkShell {
            packages = [
              rustToolchain
              pkgs.just
              pkgs.foundry
            ];
          };

          ci-js = pkgs.mkShell {
            packages = [
              rustToolchain
              pkgs.just
              pkgs.foundry
              pkgs.binaryen
              pkgs.wasm-pack
              pkgs.nodejs_22
              pkgs.pnpm
            ];
          };
        };
      }
    );
}
