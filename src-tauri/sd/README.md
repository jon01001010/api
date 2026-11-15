The desktop builds put stable-diffusion.cpp's one-shot picture maker here
(`sd-cli`, with its libraries on Windows), from a pinned, checksummed release
(.github/workflows/pocketagent-windows.yml: the `win-vulkan-x64` zip) or built
from the same pinned tag (.github/workflows/pocketagent-linux.yml: x64, CPU).
`sd-server` is never shipped (it has no password). ARM Linux gets nothing:
pictures are far too slow there. Nothing here is committed. See
src-tauri/src/image_gen.rs.
