use aetherweave::api::{
    BraidLog, BraidPathElement, BraidRequest, BraidResponse, MeasureRequest, MeasureResponse,
    VortexCreate, VortexResponse,
};
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::Mutex;

struct AppState {
    pub braid_log: Vec<BraidLog>,
    // we would also hold the oracle/stats here in a real app
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let state = Arc::new(Mutex::new(AppState {
        braid_log: Vec::new(),
    }));

    let app = Router::new()
        .route("/api/v1/vortex", post(create_vortex))
        .route("/api/v1/braid", post(braid_anyons))
        .route("/api/v1/measure", post(measure_fusion))
        .route("/api/v1/audit", get(audit_trail))
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    tracing::info!("Listening on {}", listener.local_addr().unwrap());
    axum::serve(listener, app).await.unwrap();
}

async fn create_vortex(
    State(_state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<VortexCreate>,
) -> impl IntoResponse {
    // 1. Verify Theosis Index (mock)
    // 2. Verify Ising-phase pre-condition
    let in_phase = (0.3 < payload.gamma && payload.gamma < 0.8)
        && (0.2 < payload.alpha && payload.alpha < 0.6)
        && (0.8 < payload.omega && payload.omega < 1.2);

    if !in_phase {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"detail": "Parameters outside Ising phase - cannot create σ-anyons"})),
        ).into_response();
    }

    let res = VortexResponse {
        vortex_id: "VXT-1001".to_string(),
        status: "CREATED".to_string(),
        kappa: payload.gamma * 1.5,
        tau: payload.alpha * 2.0,
    };

    (StatusCode::CREATED, Json(res)).into_response()
}

async fn braid_anyons(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<BraidRequest>,
) -> impl IntoResponse {
    if payload.targets.iter().any(|t| t.target_type != "σ") {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"detail": "Only σ-anyons may be braided in discovery mode"})),
        ).into_response();
    }

    let braid_id = format!("B-2025-0522-{:03}", payload.iterations);

    let res = BraidResponse {
        braid_id: braid_id.clone(),
        status: "COMPLETED".to_string(),
        unitary_matrix: vec![vec![1.0, 0.0], vec![0.0, 1.0]],
        new_ti: 0.9987,
    };

    let log = BraidLog {
        vortex_id: payload.vortex_id,
        braid_path: vec![BraidPathElement {
            element_type: "adjacent".to_string(),
            coefficient: 1.0,
            variables: vec![0, 1],
        }],
        n_steps: payload.iterations,
        timestamp: "2026-05-22T14:22:01Z".to_string(),
    };

    state.lock().await.braid_log.push(log);

    (StatusCode::OK, Json(res)).into_response()
}

async fn measure_fusion(
    State(state): State<Arc<Mutex<AppState>>>,
    Json(payload): Json<MeasureRequest>,
) -> impl IntoResponse {
    let log_len = state.lock().await.braid_log.len();
    if log_len == 0 {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"detail": "No braid recorded for this request"})),
        ).into_response();
    }

    let outcome = if std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() % 2 == 0 {
        "σ"
    } else {
        "ψ"
    };

    let res = MeasureResponse {
        vortex_id: payload.braid_id,
        measured_charge: outcome.to_string(),
        probability: 0.5,
        timestamp: "2026-05-22T14:22:01Z".to_string(),
    };

    (StatusCode::OK, Json(res)).into_response()
}

#[derive(Deserialize)]
struct AuditQuery {
    vortex_id: Option<String>,
}

async fn audit_trail(
    State(state): State<Arc<Mutex<AppState>>>,
    Query(query): Query<AuditQuery>,
) -> impl IntoResponse {
    let logs = state.lock().await.braid_log.clone();

    let filtered_logs = if let Some(vid) = query.vortex_id {
        logs.into_iter().filter(|l| l.vortex_id == vid).collect::<Vec<_>>()
    } else {
        logs
    };

    (StatusCode::OK, Json(filtered_logs)).into_response()
}
