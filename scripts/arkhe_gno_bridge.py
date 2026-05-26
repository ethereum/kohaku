import subprocess
import json
import time

class GnoVMBridge:
    """Bridge for interacting with the GnoVM from the ARKHE Server."""

    def __init__(self, key_name="arkhe_deployer", rpc_endpoint="http://127.0.0.1:26657", chain_id="dev"):
        self.key_name = key_name
        self.rpc_endpoint = rpc_endpoint
        self.chain_id = chain_id
        self.realm_path = "gno.land/r/arkhe"

    def execute_command(self, cmd):
        """Helper to run a shell command."""
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, check=True
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as e:
            print(f"[ERROR] Failed to execute command: {' '.join(cmd)}")
            print(f"Stdout: {e.stdout}")
            print(f"Stderr: {e.stderr}")
            return None

    def record_inference(self, model_id, input_hash, output):
        """Records a deterministic oracle inference."""
        print(f"Recording inference for model {model_id}...")
        cmd = [
            "gnokey", "maketx", "call", self.key_name,
            "--pkgpath", self.realm_path,
            "--func", "RecordInference",
            "--args", model_id,
            "--args", input_hash,
            "--args", output,
            "--gas-fee", "1000000ugnot",
            "--gas-wanted", "2000000",
            "--broadcast", "true",
            "--chainid", self.chain_id,
            "--remote", self.rpc_endpoint
        ]
        return self.execute_command(cmd)

    def anchor_block(self, block_height, state_root):
        """Anchors a TemporalChain Θ-T0 block to the Gno.land blockchain."""
        print(f"Anchoring block {block_height} to Gno.land...")
        cmd = [
            "gnokey", "maketx", "call", self.key_name,
            "--pkgpath", self.realm_path,
            "--func", "AnchorBlock",
            "--args", str(block_height),
            "--args", state_root,
            "--gas-fee", "1000000ugnot",
            "--gas-wanted", "2000000",
            "--broadcast", "true",
            "--chainid", self.chain_id,
            "--remote", self.rpc_endpoint
        ]
        return self.execute_command(cmd)

if __name__ == "__main__":
    # Example Usage
    bridge = GnoVMBridge()
    print("Testing GnoVM Bridge")
    print("--------------------")

    # 1. Oracle Layer: Record a deterministic inference
    print("1. Recording Oracle Inference...")
    bridge.record_inference(
        model_id="arkhe-llm-v1",
        input_hash="a1b2c3d4e5f6g7h8i9j0",
        output="The system is in homeostasis."
    )
    time.sleep(2)

    # 2. Temporal Anchor: Anchor a Θ-T0 block
    print("\n2. Anchoring Temporal Block...")
    bridge.anchor_block(
        block_height=42000,
        state_root="0xabcdef1234567890abcdef1234567890abcdef12"
    )

    print("\nOperations completed. Check local devnet via gnoweb to verify.")
