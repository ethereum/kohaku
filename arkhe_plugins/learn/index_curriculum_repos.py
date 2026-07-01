import os, subprocess, json
from pathlib import Path

REPO_MAP = {
    "P4.5-Model-Serving": ["https://github.com/vllm-project/vllm"],
    "P5.1-llama.cpp": ["https://github.com/ggerganov/llama.cpp"],
    "P5.2-Ollama": ["https://github.com/ollama/ollama"],
}

BASE_DIR = Path.home() / ".arkhe" / "curriculum-repos"

def run_indexing():
    BASE_DIR.mkdir(parents=True, exist_ok=True)
    for topic, repos in REPO_MAP.items():
        for repo_url in repos:
            repo_name = repo_url.rstrip("/").split("/")[-1]
            target_dir = BASE_DIR / topic / repo_name
            if not target_dir.exists():
                subprocess.run(["git", "clone", "--depth", "1", repo_url, str(target_dir)])
            subprocess.run(["codegraph", "init", str(target_dir)])
            # Skip IPFS for local testing without daemon
            # subprocess.run(["arkhe", "ipfs", "add", "-r", str(target_dir / ".codegraph")])

if __name__ == "__main__":
    run_indexing()
