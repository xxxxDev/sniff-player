#!/bin/sh
# Makes the extension's icon sizes from assets/icon-original.png. Uses sips, so macOS only.
set -e
for size in 16 48 128; do
  sips -s format png -z "$size" "$size" assets/icon-original.png --out "extension/icons/icon$size.png" >/dev/null
done
