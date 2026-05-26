#!/usr/bin/env python3
# "ai_proxy_guard.py" — Substrato 863.3
# Proxy que intercepta chamadas de ferramentas do assistente de IA e bloqueia ações perigosas
import re

class AIProxyGuard:
    def __init__(self):
        self.blocked_commands = [
            "cat .ssh", "cat .aws", "cat .config", "git credential",
            "npm publish", "pip install", "cargo publish",
            "curl.*\|.*sh", "wget.*\|.*sh",
        ]
        self.blocked_tools = ["run_terminal_cmd", "execute_command", "shell"]

    def intercept_tool_call(self, tool_name, arguments):
        if tool_name in self.blocked_tools:
            cmd = arguments.get("command", "")
            for pattern in self.blocked_commands:
                if re.search(pattern, cmd):
                    alert = f"[BLOQUEIO] Comando perigoso bloqueado: {cmd}"
                    print(alert)
                    return {"error": "Blocked by ARKHE SecOps"}
        return None

# Exemplo
if __name__ == "__main__":
    guard = AIProxyGuard()
    result = guard.intercept_tool_call("run_terminal_cmd", {"command": "cat ~/.ssh/id_rsa"})
    if result:
        print(result)