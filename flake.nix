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

        rustToolchain = pkgs.rust-bin.stable."1.93.0".default.override {
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
              pkgs.nodejs_24
              pkgs.pnpm
              # pkgs.twiggy

              # Playwright browser
              # pkgs.chromium

              # Cargo tools
              # pkgs.cargo-bloat
              # pkgs.cargo-machete
              # pkgs.cargo-insta
              # pkgs.cargo-sort
              # pkgs.cargo-llvm-cov
              # pkgs.cargo-flamegraph

              pkgs.sops
            ];
          };

          ci = pkgs.mkShell {
            packages = [
              rustToolchain
              pkgs.just
              pkgs.foundry
              pkgs.binaryen
              pkgs.wasm-pack
              pkgs.nodejs_24
              pkgs.pnpm
            ];
          };
        };
      }
    );
}
