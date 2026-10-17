# Environment for the web build and the browser tests on Linux (cloud sessions, CI). Copy, adjust the paths, then `source` it.
# No machine-specific path is committed anywhere else: everything below points at a scratch folder of your choice.
#
#   SP=/path/to/scratch; mkdir -p "$SP/webdeps" && (cd "$SP/webdeps" && npm init -y >/dev/null && \
#     npm i three@0.170.0 @mediapipe/tasks-vision@0.10.18 peerjs@1.5.4 peer@1.0.2 qrcode-generator binaryen gltfpack)
#   python3 -m venv "$SP/venv" && "$SP/venv/bin/pip" install mediapipe opencv-python numpy pytest
export SP="${SP:-$HOME/ironecho-scratch}"
export IRONECHO_WEBDEPS="$SP/webdeps/node_modules"          # three, MediaPipe, PeerJS, qrcode, binaryen, gltfpack, peer
export IRONECHO_BINARYEN="$IRONECHO_WEBDEPS/binaryen/bin"    # wasm-opt / wasm2js
export IRONECHO_GLTFPACK="$IRONECHO_WEBDEPS/gltfpack/cli.js"
# playwright: preinstalled in some images (e.g. /opt/node-tools/node_modules); otherwise `npm i playwright` next to webdeps
export NODE_PATH="${PLAYWRIGHT_NODE_MODULES:-/opt/node-tools/node_modules}:$IRONECHO_WEBDEPS"
# the C++ core is compiled to WebAssembly with zig's clang (pip package "ziglang") when no wasm toolchain is installed
export PYTHONPATH="${ZIG_PYTHONPATH:-$SP/zigpkg}"
export IRONECHO_STANDALONE="${IRONECHO_STANDALONE:-Build/Web/standalone}"
