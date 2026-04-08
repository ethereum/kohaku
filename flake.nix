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

        # nixpkgs wasm-pack often lags crates.io; match CI (v0.14.0) via upstream binaries.
        wasm-pack =
          let
            version = "0.14.0";
            asset =
              if system == "x86_64-linux" then {
                id = "x86_64-unknown-linux-musl";
                hash = "sha256-J4qNZoCFgh9NGmN72GTxcT+HKwrjoRjHdWKjCMCr/o0=";
              }
              else if system == "aarch64-linux" then {
                id = "aarch64-unknown-linux-musl";
                hash = "sha256-WUHHsFBgRA/zfuUP6QCaQI5j+lumB6Owc29aiH7F8so=";
              }
              else if system == "x86_64-darwin" then {
                id = "x86_64-apple-darwin";
                hash = "sha256-RrZgcu6ZErU/g4Qa7LBEeaYOBwX3u4tmgbN3oHpRKiM=";
              }
              else if system == "aarch64-darwin" then {
                id = "aarch64-apple-darwin";
                hash = "sha256-nQ5wxrIp3hjwq/6RDylj6PCeuuIYJQ6bCaHD/dlVvvk=";
              }
              else
                throw "wasm-pack ${version}: unsupported system ${system}";
          in
          pkgs.stdenvNoCC.mkDerivation {
            pname = "wasm-pack";
            inherit version;
            src = pkgs.fetchurl {
              url = "https://github.com/wasm-bindgen/wasm-pack/releases/download/v${version}/wasm-pack-v${version}-${asset.id}.tar.gz";
              hash = asset.hash;
            };
            sourceRoot = "wasm-pack-v${version}-${asset.id}";
            dontConfigure = true;
            dontBuild = true;
            installPhase = ''
              install -D -m755 wasm-pack $out/bin/wasm-pack
            '';
          };
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
              wasm-pack
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

              pkgs.sops
            ];
          };

          ci = pkgs.mkShell {
            packages = [
              rustToolchain
              pkgs.just
              pkgs.foundry
              pkgs.binaryen
              wasm-pack
              pkgs.nodejs_24
              pkgs.pnpm
            ];
          };
        };
      }
    );
}
