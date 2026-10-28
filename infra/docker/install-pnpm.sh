#!/bin/sh
# Installs pnpm into /usr/local/bin for the api, web and dev images.
# pnpm 12 is a self-contained executable, published on npm once per platform as
# @pnpm/exe.<platform>. Node 26 no longer bundles corepack, and OpenSSF Scorecard
# reports every `npm install` in a Dockerfile as an unpinned dependency, so the
# musl build for this machine's architecture is downloaded from the registry and
# refused unless it matches the sha512 the registry publishes for it
# (`dist.integrity`, as hex). Bump: docs/gotchas/docker.md "Bumping pnpm".
set -eu
version=12.4.2
case "$(uname -m)" in
  x86_64)
    platform=linux-x64-musl
    sha512=9337f31f6ff40567530012b5e188f96b5c6c7644c4414a7679710f35a91a0fd8ca2f4db996ade1c9a287233fe021968f0cc7bfd5b1452bf127e33b4595b049c7
    ;;
  aarch64)
    platform=linux-arm64-musl
    sha512=2f0484b521034efe92e7560bb3762f4a43f2ba7fd099f3227355062025243d616ee81c8fe3745d32590abe65647c6840602a67c4ed39eefae6c89aad7d9acf08
    ;;
  *) echo "install-pnpm.sh: no pnpm build pinned for $(uname -m)" >&2; exit 1 ;;
esac
tarball=/tmp/pnpm.tgz
wget -qO "$tarball" "https://registry.npmjs.org/@pnpm/exe.${platform}/-/exe.${platform}-${version}.tgz"
echo "$sha512  $tarball" | sha512sum -c -
tar -xzf "$tarball" -C /tmp package/pnpm
mv /tmp/package/pnpm /usr/local/bin/pnpm
rm -r "$tarball" /tmp/package
pnpm --version
