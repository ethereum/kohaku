import torch
import torch.nn as nn
import torch.nn.functional as F
from typing import Optional, Tuple

class PhysicsPriorsModule(nn.Module):
    def __init__(
        self,
        d_model: int = 512,
        state_dim: int = 256,
        hidden_dim: int = 256,
        n_priors: int = 5,
    ):
        super().__init__()
        self.d_model = d_model
        self.state_dim = state_dim
        self.n_priors = n_priors

        self.prior_projections = nn.ModuleDict({
            "gravity": nn.Sequential(
                nn.Linear(d_model, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, state_dim // n_priors),
            ),
            "collision": nn.Sequential(
                nn.Linear(d_model, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, state_dim // n_priors),
            ),
            "occlusion": nn.Sequential(
                nn.Linear(d_model, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, state_dim // n_priors),
            ),
            "conservation": nn.Sequential(
                nn.Linear(d_model, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, state_dim // n_priors),
            ),
            "continuity": nn.Sequential(
                nn.Linear(d_model, hidden_dim),
                nn.ReLU(),
                nn.Linear(hidden_dim, state_dim // n_priors),
            ),
        })

        self.prior_gate = nn.Sequential(
            nn.Linear(d_model, n_priors),
            nn.Softmax(dim=-1),
        )

        self.output_proj = nn.Sequential(
            nn.Linear(state_dim // n_priors * n_priors, state_dim), # FIX: state_dim // n_priors * n_priors
            nn.LayerNorm(state_dim),
            nn.ReLU(),
        )

        print(f"[890.2] PhysicsPriorsModule: {d_model}→{state_dim}, {n_priors} priors")

    def forward(self, text_embedding: torch.Tensor) -> torch.Tensor:
        if text_embedding.dim() == 1:
            text_embedding = text_embedding.unsqueeze(0)
            squeeze = True
        else:
            squeeze = False

        batch_size = text_embedding.size(0)

        prior_outputs = []
        for name, proj in self.prior_projections.items():
            prior_emb = proj(text_embedding)  # [batch, state_dim//n_priors]
            prior_outputs.append(prior_emb)

        prior_stack = torch.cat(prior_outputs, dim=-1)  # [batch, state_dim // n_priors * n_priors]

        gate_weights = self.prior_gate(text_embedding)  # [batch, n_priors]

        prior_dim = self.state_dim // self.n_priors
        gated_priors = []
        for i in range(self.n_priors):
            w = gate_weights[:, i:i+1]  # [batch, 1]
            block = prior_stack[:, i*prior_dim:(i+1)*prior_dim]
            gated_priors.append(w * block)

        gated_output = torch.cat(gated_priors, dim=-1)

        physics_embedding = self.output_proj(gated_output)

        if squeeze:
            physics_embedding = physics_embedding.squeeze(0)

        return physics_embedding

    def get_prior_importance(self, text_embedding: torch.Tensor) -> dict:
        with torch.no_grad():
            gate_weights = self.prior_gate(text_embedding)
            if gate_weights.dim() == 2:
                gate_weights = gate_weights.squeeze(0)

        prior_names = list(self.prior_projections.keys())
        return {name: float(gate_weights[i]) for i, name in enumerate(prior_names)}
