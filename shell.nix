{ pkgs ? import <nixpkgs> { } }:

pkgs.mkShell {
  packages = with pkgs; [
    rustc
    cargo
    clippy
    rustfmt
    nodejs_22
  ];
}
