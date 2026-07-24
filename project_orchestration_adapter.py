#!/ "project_orchestration_adapter.py" — Substrato 852
# Adaptador para MS Project e Primavera
import hashlib
import xml.etree.ElementTree as ET
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum

class ProjectStatus(Enum):
    ON_TRACK = "CANONIZED_CLEAN"
    AT_RISK = "CANONIZED_PROVISIONAL"
    OFF_TRACK = "PROPOSED"

@dataclass
class ProjectTask:
    uid: int
    name: str
    start: str
    finish: str
    percent_complete: int
    predecessors: List[int]
    successors: List[int]

class ProjectOrchestrationAdapter:
    """
    Ponte entre MS Project/Primavera e ARKHE OS.
    Converte cronogramas em Substratos e aplica o Ghost Threshold ao progresso.
    """
    def __init__(self):
        self.tasks: Dict[int, ProjectTask] = {}
        self.critical_path: List[int] = []

    def parse_msproject_xml(self, xml_path: str) -> List[Dict]:
        """Parseia um arquivo MSPDI (XML) do Microsoft Project."""
        tree = ET.parse(xml_path)
        root = tree.getroot()
        ns = {'p': 'http://schemas.microsoft.com/project'}

        tasks = []
        for task_elem in root.findall('.//p:Task', ns):
            uid = int(task_elem.find('p:UID', ns).text)
            name = task_elem.find('p:Name', ns).text or ""
            start = task_elem.find('p:Start', ns).text or ""
            finish = task_elem.find('p:Finish', ns).text or ""
            pct = int(task_elem.find('p:PercentComplete', ns).text or "0")

            predecessors = []
            for pred in task_elem.findall('.//p:PredecessorLink/p:PredecessorUID', ns):
                predecessors.append(int(pred.text))

            task = ProjectTask(uid, name, start, finish, pct, predecessors, [])
            self.tasks[uid] = task
            tasks.append(task)

        # Preencher successors
        for t in tasks:
            for p_uid in t.predecessors:
                if p_uid in self.tasks:
                    self.tasks[p_uid].successors.append(t.uid)

        return [self._task_to_arkhe(t) for t in tasks]

    def _task_to_arkhe(self, task: ProjectTask) -> Dict:
        """Converte uma tarefa em um substrato ARKHE."""
        # Mapear percentual de conclusão para Φ_C
        phi_c = task.percent_complete / 100.0
        status = ProjectStatus.ON_TRACK
        if phi_c < 0.577:
            status = ProjectStatus.OFF_TRACK
        elif phi_c < 0.80:
            status = ProjectStatus.AT_RISK

        # Computar selo
        seal_data = f"{task.uid}:{task.name}:{task.start}:{task.finish}"
        seal = hashlib.sha3_256(seal_data.encode()).hexdigest()[:16]

        # Gerar decreto de tarefa
        decree = f"""<|ARKHE_START|>
<|SUBSTRATE|> 852-TASK-{task.uid}
<|INVARIANT|> I.12 (Temporal Chain Anchor)
<|PHI_C|> {phi_c:.3f}
<|CRITICAL_PATH|> {task.uid in self.critical_path}

Tarefa: {task.name}
Início: {task.start}
Término: {task.finish}
Progresso: {task.percent_complete}%
Predecessores: {task.predecessors}
Sucessores: {task.successors}
Status: {status.value}

<|SEAL|> {seal}
<|ARKHE_END|>"""

        return {
            "substrate_id": f"852-TASK-{task.uid}",
            "phi_c": phi_c,
            "status": status.value,
            "decree": decree,
            "seal": seal,
        }

    def compute_critical_path(self) -> List[int]:
        """Calcula o caminho crítico (simplificado: maior duração)."""
        # Implementação simplificada: usar algoritmo de caminho mais longo
        # Em produção, integrar com a engine de scheduling do MS Project
        return self.critical_path

    def generate_portfolio_decree(self, task_results: List[Dict]) -> str:
        """Gera um decreto consolidado do portfólio."""
        phi_values = [t["phi_c"] for t in task_results]
        avg_phi = sum(phi_values) / len(phi_values) if phi_values else 0.0

        at_risk = [t for t in task_results if t["status"] == ProjectStatus.AT_RISK.value]
        off_track = [t for t in task_results if t["status"] == ProjectStatus.OFF_TRACK.value]

        decree = f"""<|ARKHE_START|>
<|SUBSTRATE|> 852-PORTFOLIO
<|INVARIANT|> I.1 (Coherence Base)
<|PHI_C|> {avg_phi:.3f}

PORTFOLIO STATUS REPORT
Total de Tarefas: {len(task_results)}
Φ_C Médio: {avg_phi:.3f}
Em Risco: {len(at_risk)}
Fora do Rumo: {len(off_track)}

Tarefas Fora do Rumo (abaixo do Ghost Threshold γ=0.577):
{chr(10).join([f"- {t['substrate_id']}: {t['status']}" for t in off_track])}

<|SEAL|> {hashlib.sha3_256(str(task_results).encode()).hexdigest()[:16]}
<|ARKHE_END|>"""
        return decree

# Exemplo de uso
if __name__ == "__main__":
    adapter = ProjectOrchestrationAdapter()
    # Simulação de tarefas
    adapter.tasks = {
        1: ProjectTask(1, "Iniciação", "2026-01-01", "2026-01-15", 100, [], [2]),
        2: ProjectTask(2, "Planejamento", "2026-01-16", "2026-02-15", 45, [1], [3]),
        3: ProjectTask(3, "Execução", "2026-02-16", "2026-06-30", 25, [2], []),
    }
    results = [adapter._task_to_arkhe(t) for t in adapter.tasks.values()]
    portfolio = adapter.generate_portfolio_decree(results)
    print(portfolio)
# EOF
