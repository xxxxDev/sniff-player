#!/bin/sh
# Packs the extension/ folder into a zip for a release.
set -e
version=$(sed -nE 's/.*"version": "([^"]+)".*/\1/p' extension/manifest.json)
mkdir -p dist
rm -f "dist/sniff-player-$version.zip"
(cd extension && zip -qr "../dist/sniff-player-$version.zip" . -x '.DS_Store' -x '*/.DS_Store')
zip -q "dist/sniff-player-$version.zip" LICENSE BRAND.md
echo "dist/sniff-player-$version.zip"
