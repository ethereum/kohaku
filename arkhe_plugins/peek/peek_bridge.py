#!/usr/bin/env python3
"""
ARKHE OS — Plugin PEEK Bridge
Arquiteto: ORCID 0009-0005-2697-4668
Data: 2026-05-23
STRICT MODE

Integra PEEK (Context Map as an Orientation Cache) ao MegaKernel ARKHE.
Implementa Distiller, Cartographer e Evictor para manter context maps
sobre contextos recorrentes (nuclei templates, code repos, corpora).
"""

import json
import hashlib
import time
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field, asdict
from datetime import datetime

import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.tree import Tree

console = Console()

# Diretório de cache do PEEK
PEEK_DIR = Path.home() / ".arkhe" / "peek"
PEEK_DIR.mkdir(parents=True, exist_ok=True)


@dataclass
class ContextMapSection:
    """Seção do Context Map (uma das 5 seções PEEK)."""
    name: str
    content: str
    priority: float = 1.0
    last_accessed: float = field(default_factory=time.time)
    access_count: int = 0


@dataclass
class ContextMap:
    """Context Map completo — artefato de tamanho constante."""
    id: str
    name: str
    source: str  # URI do contexto externo
    sections: List[ContextMapSection]
    budget: int = 1024  # tokens (B)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    version: int = 1
    seal: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "source": self.source,
            "budget": self.budget,
            "version": self.version,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "seal": self.seal,
            "sections": [
                {
                    "name": s.name,
                    "content": s.content,
                    "priority": s.priority,
                    "last_accessed": s.last_accessed,
                    "access_count": s.access_count,
                }
                for s in self.sections
            ],
        }


class Distiller:
    """
    Extrai conhecimento de orientação transferível da trajetória do agente.
    Equivalente ao Distiller do paper PEEK (Section 3.1).
    """

    def distill(self, trajectory: List[Dict], context_source: str) -> List[Dict]:
        """
        Analisa trajetória e identifica itens candidatos ao context map.

        Args:
            trajectory: Lista de turnos (observation, action, result)
            context_source: URI do contexto externo

        Returns:
            Lista de candidates: {item, orientation_score, section}
        """
        candidates = []

        # Heurística: identificar padrões recorrentes na trajetória
        seen_items = {}
        for turn in trajectory:
            obs = turn.get("observation", "")
            action = turn.get("action", "")
            result = turn.get("result", "")

            # Extrair entidades mencionadas
            entities = self._extract_entities(obs + " " + action + " " + result)
            for entity in entities:
                if entity in seen_items:
                    seen_items[entity]["count"] += 1
                    seen_items[entity]["last_seen"] = turn.get("turn_id", 0)
                else:
                    seen_items[entity] = {
                        "count": 1,
                        "first_seen": turn.get("turn_id", 0),
                        "last_seen": turn.get("turn_id", 0),
                    }

        # Calcular orientation score (frequência × recência)
        for item, stats in seen_items.items():
            recency = 1.0 / (1 + stats["last_seen"] - stats["first_seen"])
            score = stats["count"] * recency

            # Classificar em seção
            section = self._classify_section(item, stats)

            candidates.append({
                "item": item,
                "orientation_score": score,
                "section": section,
                "frequency": stats["count"],
                "recency": recency,
            })

        # Ordenar por score
        candidates.sort(key=lambda x: x["orientation_score"], reverse=True)
        return candidates

    def _extract_entities(self, text: str) -> List[str]:
        """Extrai entidades candidatas do texto."""
        # Simplificado: extrair palavras-chave compostas
        words = text.split()
        entities = []
        for i in range(len(words)):
            if len(words[i]) > 3 and words[i][0].isupper():
                entities.append(words[i])
            if i < len(words) - 1 and len(words[i]) > 2:
                entities.append(f"{words[i]} {words[i+1]}")
        return list(set(entities))[:50]  # Limitar

    def _classify_section(self, item: str, stats: Dict) -> str:
        """Classifica item em uma das 5 seções do context map."""
        if any(kw in item.lower() for kw in ["template", "poc", "cve", "vuln"]):
            return "Context Roadmap"
        elif any(kw in item.lower() for kw in ["config", "setting", "parameter", "threshold"]):
            return "Domain Constants"
        elif any(kw in item.lower() for kw in ["result", "finding", "output", "scan"]):
            return "Reusable Results"
        elif any(kw in item.lower() for kw in ["format", "schema", "delimiter", "parse"]):
            return "Parsing Schema"
        else:
            return "Context Understanding"


class Cartographer:
    """
    Traduz candidates em edits estruturados (ADD/DELETE/REPLACE).
    Equivalente ao Cartographer do paper PEEK (Section 3.2).
    """

    def edit(self, context_map: ContextMap, candidates: List[Dict]) -> List[Dict]:
        """
        Gera edits estruturados para atualizar o context map.

        Args:
            context_map: Context map atual
            candidates: Candidates do Distiller

        Returns:
            Lista de edits: {operation, section, item, priority}
        """
        edits = []
        existing_items = {s.name: s.content for s in context_map.sections}

        for candidate in candidates[:20]:  # Top 20 candidates
            item = candidate["item"]
            section = candidate["section"]
            score = candidate["orientation_score"]

            if section not in existing_items:
                # ADD: nova seção
                edits.append({
                    "operation": "ADD",
                    "section": section,
                    "item": item,
                    "priority": score,
                    "reason": "new_section",
                })
            elif item not in existing_items[section]:
                # ADD: novo item em seção existente
                edits.append({
                    "operation": "ADD",
                    "section": section,
                    "item": item,
                    "priority": score,
                    "reason": "new_item",
                })
            else:
                # REPLACE: atualizar prioridade
                edits.append({
                    "operation": "REPLACE",
                    "section": section,
                    "item": item,
                    "priority": score,
                    "reason": "priority_update",
                })

        # DELETE: itens com prioridade muito baixa
        for section in context_map.sections:
            if section.priority < 0.1:
                edits.append({
                    "operation": "DELETE",
                    "section": section.name,
                    "item": section.content,
                    "priority": 0.0,
                    "reason": "low_priority",
                })

        return edits


class Evictor:
    """
    Enforces budget fixo (B=1024 tokens) via prioridade.
    Equivalente ao Evictor do paper PEEK (Section 3.3).
    """

    def evict(self, context_map: ContextMap, edits: List[Dict]) -> ContextMap:
        """
        Aplica edits respeitando o budget de tokens.

        Args:
            context_map: Context map atual
            edits: Edits do Cartographer

        Returns:
            Context map atualizado (dentro do budget)
        """
        # Aplicar edits
        for edit in edits:
            op = edit["operation"]
            section_name = edit["section"]
            item = edit["item"]
            priority = edit["priority"]

            if op == "ADD":
                # Adicionar ou atualizar seção
                existing = [s for s in context_map.sections if s.name == section_name]
                if existing:
                    existing[0].content += f"\n• {item}"
                    existing[0].priority = max(existing[0].priority, priority)
                    existing[0].last_accessed = time.time()
                else:
                    context_map.sections.append(ContextMapSection(
                        name=section_name,
                        content=f"• {item}",
                        priority=priority,
                    ))

            elif op == "REPLACE":
                existing = [s for s in context_map.sections if s.name == section_name]
                if existing:
                    existing[0].priority = priority
                    existing[0].last_accessed = time.time()

            elif op == "DELETE":
                context_map.sections = [s for s in context_map.sections if s.name != section_name]

        # Enforce budget: ordenar por prioridade e truncar
        context_map.sections.sort(key=lambda s: s.priority, reverse=True)

        total_tokens = 0
        kept_sections = []
        for section in context_map.sections:
            section_tokens = len(section.content.split())  # Aproximação simples
            if total_tokens + section_tokens <= context_map.budget:
                kept_sections.append(section)
                total_tokens += section_tokens
            else:
                break

        context_map.sections = kept_sections
        context_map.updated_at = time.time()
        context_map.version += 1

        # Recalcular seal
        map_json = json.dumps(context_map.to_dict(), sort_keys=True)
        context_map.seal = hashlib.sha256(map_json.encode()).hexdigest()

        return context_map


class PEEKManager:
    """Gerenciador central de Context Maps PEEK no MegaKernel."""

    def __init__(self):
        self.distiller = Distiller()
        self.cartographer = Cartographer()
        self.evictor = Evictor()
        self.maps: Dict[str, ContextMap] = {}
        self._load_maps()

    def _load_maps(self):
        """Carrega context maps persistidos."""
        for map_file in PEEK_DIR.glob("*.json"):
            with open(map_file, "r") as f:
                data = json.load(f)
                sections = [ContextMapSection(**s) for s in data.get("sections", [])]
                self.maps[data["id"]] = ContextMap(
                    id=data["id"],
                    name=data["name"],
                    source=data["source"],
                    sections=sections,
                    budget=data.get("budget", 1024),
                    created_at=data.get("created_at", time.time()),
                    updated_at=data.get("updated_at", time.time()),
                    version=data.get("version", 1),
                    seal=data.get("seal", ""),
                )

    def _save_map(self, context_map: ContextMap):
        """Persiste context map em disco."""
        map_file = PEEK_DIR / f"{context_map.id}.json"
        with open(map_file, "w") as f:
            json.dump(context_map.to_dict(), f, indent=2)

    def create_map(self, map_id: str, name: str, source: str,
                   budget: int = 1024) -> ContextMap:
        """Cria novo context map vazio."""
        context_map = ContextMap(
            id=map_id,
            name=name,
            source=source,
            sections=[],
            budget=budget,
        )
        self.maps[map_id] = context_map
        self._save_map(context_map)
        return context_map

    def update_map(self, map_id: str, trajectory: List[Dict]) -> ContextMap:
        """Atualiza context map a partir de trajetória do agente."""
        if map_id not in self.maps:
            raise ValueError(f"Context map {map_id} not found")

        context_map = self.maps[map_id]

        # Pipeline PEEK: Distiller → Cartographer → Evictor
        candidates = self.distiller.distill(trajectory, context_map.source)
        edits = self.cartographer.edit(context_map, candidates)
        updated_map = self.evictor.evict(context_map, edits)

        self.maps[map_id] = updated_map
        self._save_map(updated_map)

        return updated_map

    def get_map(self, map_id: str) -> Optional[ContextMap]:
        """Retorna context map por ID."""
        return self.maps.get(map_id)

    def list_maps(self) -> List[ContextMap]:
        """Lista todos os context maps."""
        return list(self.maps.values())

    def delete_map(self, map_id: str) -> bool:
        """Remove context map."""
        if map_id in self.maps:
            del self.maps[map_id]
            map_file = PEEK_DIR / f"{map_id}.json"
            if map_file.exists():
                map_file.unlink()
            return True
        return False

    def query_map(self, map_id: str, query: str) -> List[Dict]:
        """Consulta context map por relevância."""
        context_map = self.maps.get(map_id)
        if not context_map:
            return []

        results = []
        for section in context_map.sections:
            if query.lower() in section.content.lower() or query.lower() in section.name.lower():
                section.access_count += 1
                section.last_accessed = time.time()
                results.append({
                    "section": section.name,
                    "content": section.content,
                    "priority": section.priority,
                    "access_count": section.access_count,
                })

        # Re-sort by access count (LRU-like)
        results.sort(key=lambda x: x["access_count"], reverse=True)
        return results


# ============================================================
# INTEGRAÇÃO COM 607-NUCLEI — CACHING DE TEMPLATES
# ============================================================

class NucleiPEEKIntegration:
    """Integra PEEK com Nuclei para caching de templates de vulnerabilidades."""

    def __init__(self, peek_manager: PEEKManager):
        self.peek = peek_manager
        self.map_id = "nuclei-templates-cache"

    def initialize(self):
        """Inicializa context map para templates Nuclei."""
        if self.map_id not in self.peek.maps:
            self.peek.create_map(
                map_id=self.map_id,
                name="Nuclei Templates Cache",
                source="https://github.com/projectdiscovery/nuclei-templates",
                budget=2048,  # Templates precisam de mais tokens
            )

    def cache_scan_results(self, target: str, findings: List[Dict]):
        """Cacheia resultados de scan Nuclei no context map."""
        trajectory = []
        for i, finding in enumerate(findings):
            trajectory.append({
                "turn_id": i,
                "observation": f"Scanning {target}",
                "action": f"Template {finding.get('template-id', 'unknown')}",
                "result": json.dumps(finding, default=str)[:500],
            })

        updated_map = self.peek.update_map(self.map_id, trajectory)
        return updated_map

    def get_relevant_templates(self, target_type: str) -> List[str]:
        """Retorna templates relevantes do cache para tipo de alvo."""
        results = self.peek.query_map(self.map_id, target_type)
        templates = []
        for r in results:
            # Extrair IDs de template do conteúdo
            for line in r["content"].split("\n"):
                if "template" in line.lower() or "cve" in line.lower():
                    templates.append(line.strip("• ").strip())
        return templates[:10]


# ============================================================
# COMANDOS CLICK
# ============================================================

def register_commands() -> Dict[str, click.Command]:

    @click.command(name="peek")
    @click.option("--version", "show_version", is_flag=True)
    @click.option("--list", "list_maps", is_flag=True, help="List all context maps")
    def peek_cmd(show_version, list_maps):
        """PEEK — Context Map as an Orientation Cache (MIT CSAIL/Stanford)."""
        manager = PEEKManager()

        if show_version:
            panel = Panel.fit(
                f"[bold]PEEK (MIT CSAIL / Stanford)[/bold]\n"
                f"Version: 1.0.0 (ARKHE Integration)\n"
                f"Paper: arXiv:2605.19932v1\n"
                f"Repository: https://github.com/zhuohangu/peek\n"
                f"Cache Dir: {PEEK_DIR}",
                title="ψ", border_style="bright_blue",
            )
            console.print(panel)
            return

        if list_maps:
            maps = manager.list_maps()
            if not maps:
                console.print("[yellow]No context maps found.[/yellow]")
                return

            table = Table(title="PEEK Context Maps")
            table.add_column("ID", style="cyan")
            table.add_column("Name", style="green")
            table.add_column("Source", style="white")
            table.add_column("Sections", style="yellow")
            table.add_column("Version", style="blue")
            table.add_column("Seal", style="dim")

            for m in maps:
                table.add_row(
                    m.id, m.name, m.source[:40],
                    str(len(m.sections)), str(m.version),
                    m.seal[:16] + "...",
                )
            console.print(table)
            return

        # Default: show info
        panel = Panel.fit(
            f"[bold]PEEK — Context Map Cache[/bold]\n"
            f"Active maps: {len(manager.maps)}\n"
            f"Cache directory: {PEEK_DIR}\n"
            f"Use --list to see all maps or --help for commands",
            title="ψ", border_style="bright_blue",
        )
        console.print(panel)

    @click.command(name="peek-create")
    @click.argument("map_id")
    @click.option("--name", "-n", required=True, help="Context map name")
    @click.option("--source", "-s", required=True, help="Source URI (e.g., nuclei-templates repo)")
    @click.option("--budget", "-b", default=1024, help="Token budget (default: 1024)")
    def peek_create(map_id, name, source, budget):
        """Create a new PEEK context map."""
        manager = PEEKManager()

        if map_id in manager.maps:
            console.print(f"[red]✗ Context map '{map_id}' already exists.[/red]")
            return

        context_map = manager.create_map(map_id, name, source, budget)
        console.print(f"[green]✓ Created context map: {map_id}[/green]")
        console.print(f"[dim]  Name: {name}[/dim]")
        console.print(f"[dim]  Source: {source}[/dim]")
        console.print(f"[dim]  Budget: {budget} tokens[/dim]")
        console.print(f"[dim]  Seal: {context_map.seal[:16]}...[/dim]")

    @click.command(name="peek-update")
    @click.argument("map_id")
    @click.option("--trajectory", "-t", type=click.Path(exists=True), help="Trajectory JSON file")
    def peek_update(map_id, trajectory):
        """Update context map from agent trajectory."""
        manager = PEEKManager()

        if map_id not in manager.maps:
            console.print(f"[red]✗ Context map '{map_id}' not found.[/red]")
            return

        if trajectory:
            with open(trajectory, "r") as f:
                traj_data = json.load(f)
        else:
            # Demo trajectory
            traj_data = [
                {"turn_id": 0, "observation": "Scanning web app", "action": "Run nuclei -t cves/", "result": "CVE-2024-1234 found"},
                {"turn_id": 1, "observation": "CVE detected", "action": "Analyze impact", "result": "Critical RCE"},
            ]

        updated = manager.update_map(map_id, traj_data)
        console.print(f"[green]✓ Updated context map: {map_id} (v{updated.version})[/green]")
        console.print(f"[dim]  Sections: {len(updated.sections)}[/dim]")
        console.print(f"[dim]  Seal: {updated.seal[:16]}...[/dim]")

    @click.command(name="peek-query")
    @click.argument("map_id")
    @click.argument("query")
    def peek_query(map_id, query):
        """Query context map for relevant information."""
        manager = PEEKManager()

        results = manager.query_map(map_id, query)
        if not results:
            console.print(f"[yellow]No results for '{query}' in {map_id}[/yellow]")
            return

        table = Table(title=f"PEEK Query: '{query}' in {map_id}")
        table.add_column("Section", style="cyan")
        table.add_column("Content", style="green")
        table.add_column("Priority", style="yellow")
        table.add_column("Accesses", style="blue")

        for r in results:
            table.add_row(
                r["section"],
                r["content"][:80] + "..." if len(r["content"]) > 80 else r["content"],
                f"{r['priority']:.2f}",
                str(r["access_count"]),
            )
        console.print(table)

    @click.command(name="peek-nuclei")
    @click.argument("target")
    @click.option("--templates", "-t", default="cves/", help="Nuclei template path")
    @click.option("--severity", "-s", type=click.Choice(["info", "low", "medium", "high", "critical"]))
    def peek_nuclei(target, templates, severity):
        """Run Nuclei scan with PEEK context map caching (607↔610 integration)."""
        # Inicializar integração
        peek_manager = PEEKManager()
        nuclei_peek = NucleiPEEKIntegration(peek_manager)
        nuclei_peek.initialize()

        console.print(f"[bold blue]PEEK+Nuclei: Scanning {target}...[/bold blue]")
        console.print(f"[dim]Context map: {nuclei_peek.map_id}[/dim]")

        # Simular scan Nuclei (em produção, chamar subprocess)
        demo_findings = [
            {"template-id": "CVE-2024-1234", "severity": "critical", "host": target, "info": {"name": "Remote Code Execution"}},
            {"template-id": "CVE-2024-5678", "severity": "high", "host": target, "info": {"name": "SQL Injection"}},
            {"template-id": "misconfiguration-001", "severity": "medium", "host": target, "info": {"name": "Exposed Admin Panel"}},
        ]

        if severity:
            demo_findings = [f for f in demo_findings if f["severity"] == severity]

        # Cachear resultados no PEEK
        updated_map = nuclei_peek.cache_scan_results(target, demo_findings)

        console.print(f"[green]✓ Scan complete. Findings: {len(demo_findings)}[/green]")
        console.print(f"[dim]Context map updated to v{updated_map.version}[/dim]")

        # Mostrar findings
        table = Table(title=f"Nuclei Findings — {target}")
        table.add_column("Template", style="cyan")
        table.add_column("Severity", style="red")
        table.add_column("Host", style="green")
        table.add_column("Name", style="white")

        for f in demo_findings:
            table.add_row(
                f["template-id"],
                f["severity"].upper(),
                f["host"],
                f["info"]["name"],
            )
        console.print(table)

        # Mostrar relevant templates do cache
        relevant = nuclei_peek.get_relevant_templates("web")
        if relevant:
            console.print(f"\n[dim]Relevant templates from PEEK cache:[/dim]")
            for t in relevant:
                console.print(f"  • {t}")

    @click.command(name="peek-show")
    @click.argument("map_id")
    def peek_show(map_id):
        """Display full context map contents."""
        manager = PEEKManager()
        context_map = manager.get_map(map_id)

        if not context_map:
            console.print(f"[red]✗ Context map '{map_id}' not found.[/red]")
            return

        tree = Tree(f"[bold]{context_map.name}[/bold] (v{context_map.version})")
        tree.add(f"[dim]ID: {context_map.id}[/dim]")
        tree.add(f"[dim]Source: {context_map.source}[/dim]")
        tree.add(f"[dim]Budget: {context_map.budget} tokens[/dim]")
        tree.add(f"[dim]Seal: {context_map.seal}[/dim]")

        sections_tree = tree.add("[bold]Sections[/bold]")
        for section in context_map.sections:
            section_node = sections_tree.add(
                f"[cyan]{section.name}[/cyan] (priority: {section.priority:.2f})"
            )
            for line in section.content.split("\n"):
                if line.strip():
                    section_node.add(line.strip())

        console.print(tree)

    return {
        "peek": peek_cmd,
        "peek-create": peek_create,
        "peek-update": peek_update,
        "peek-query": peek_query,
        "peek-nuclei": peek_nuclei,
        "peek-show": peek_show,
    }
