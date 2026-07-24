with open('Cargo.lock', 'r') as f:
    content = f.read()

import re

# Find the start indices of all occurrences of 'name = "h2"'
indices = [m.start() for m in re.finditer(r'name = "h2"', content)]

# If there's more than one, we remove the block of the duplicate
if len(indices) > 1:
    duplicate_block = """
[[package]]
name = "h2"
version = "0.4.14"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "171fefbc92fe4a4de27e0698d6a5b392d6a0e333506bc49133760b3bcf948733"
dependencies = [
 "atomic-waker",
 "bytes",
 "fnv",
 "futures-core",
 "futures-sink",
 "http",
 "indexmap",
 "slab",
 "tokio",
 "tokio-util",
 "tracing",
]
"""
    content = content.replace(duplicate_block, "", 1)

    with open('Cargo.lock', 'w') as f:
        f.write(content)
