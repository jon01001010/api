#!/bin/bash

# Run patch-package first
npx patch-package

# OpenCL headers for building llama.rn from source: no longer fetched
# (security review 2, 2026-11-18). This cloned KhronosGroup/OpenCL-Headers
# unpinned (whatever its default branch held) into
# node_modules/llama.rn/third_party/OpenCL-Headers, but nothing reads that
# folder: llama.rn's own build takes the headers it ships itself,
# vendor/OpenCL-Headers (cmake/rnllama-sources.cmake:
# RNLLAMA_OPENCL_HEADERS_DIR "${RNLLAMA_ROOT_DIR}/vendor/OpenCL-Headers"),
# and no patch, script or Gradle file names third_party. Kept here, switched
# off, for reference; if it is ever needed again, pin a commit and check it.
#
# OPENCL_HEADERS_DIR="node_modules/llama.rn/third_party/OpenCL-Headers"
# if [ ! -d "$OPENCL_HEADERS_DIR" ]; then
#     echo "Cloning OpenCL headers for llama.rn build from source..."
#     mkdir -p "node_modules/llama.rn/third_party"
#     git clone --depth 1 https://github.com/KhronosGroup/OpenCL-Headers.git "$OPENCL_HEADERS_DIR"
#     echo "OpenCL headers cloned successfully."
# else
#     echo "OpenCL headers already present."
# fi
