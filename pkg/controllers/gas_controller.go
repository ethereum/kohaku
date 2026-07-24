// pkg/controllers/gas_controller.go
// Substrato 825.2 - Gradient Aggregation Service (GAS) Controller

package controllers

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/tools/record"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/log"

	pmev1alpha1 "github.com/arkhe/pme/pkg/apis/pme/v1alpha1"
)

const GhostThreshold = 0.5773502691896258 // 1/√3 (γ paramétrico)

// ParameterDeltaReconciler reconcilia um objeto ParameterDelta
type ParameterDeltaReconciler struct {
	client.Client
	Scheme   *runtime.Scheme
	Recorder record.EventRecorder
}

// +kubebuilder:rbac:groups=pme.arkhe.io,resources=parameterdeltas,verbs=get;list;watch;create;update;patch;delete
// +kubebuilder:rbac:groups=pme.arkhe.io,resources=parameterdeltas/status,verbs=get;update;patch
// +kubebuilder:rbac:groups=pme.arkhe.io,resources=parameterdeltas/finalizers,verbs=update

func (r *ParameterDeltaReconciler) Reconcile(ctx context.Context, req ctrl.Request) (ctrl.Result, error) {
	logger := log.FromContext(ctx)

	// Carrega o ParameterDelta
	var delta pmev1alpha1.ParameterDelta
	if err := r.Get(ctx, req.NamespacedName, &delta); err != nil {
		// Ignora erros de "not found", que podem ocorrer se o recurso for deletado
		return ctrl.Result{}, client.IgnoreNotFound(err)
	}

	// Se já foi processado, não faz nada
	if delta.Status.State == "Merged" || delta.Status.State == "Rejected" {
		return ctrl.Result{}, nil
	}

	logger.Info("Processando novo ParameterDelta", "PodID", delta.Spec.PodID, "L2Norm", delta.Spec.L2Norm)

	// Avalia a divergência usando o Ghost Threshold (γ paramétrico)
	divergenceWarning := false
	if delta.Spec.L2Norm > GhostThreshold {
		logger.Error(nil, "🚨 GHOST THRESHOLD BREACHED (Divergência Paramétrica)",
			"L2Norm", delta.Spec.L2Norm, "Threshold", GhostThreshold, "PodID", delta.Spec.PodID)
		divergenceWarning = true

		if r.Recorder != nil {
			r.Recorder.Event(&delta, corev1.EventTypeWarning, "GhostThresholdBreach",
				fmt.Sprintf("A divergência (L2=%.4f) excedeu o limite paramétrico (%.4f)", delta.Spec.L2Norm, GhostThreshold))
		}
	}

	// Aqui aconteceria a lógica real de federação (Gradient Accumulator):
	// 1. Fazer o download do `delta.Spec.DeltaUri`
	// 2. Acumular no buffer local do GAS
	// 3. Checar políticas de disparo (tamanho/timeout)
	// 4. Integrar com PyTorch/JAX para aplicar os pesos na versão base

	// Para o PoC, marcamos como "Merged" (ou "Rejected" em caso de extrema divergência)
	newState := "Merged"
	if delta.Spec.L2Norm > GhostThreshold*2.0 {
		newState = "Rejected" // Se a divergência for muito absurda, rejeita o gradiente
	}

	delta.Status.State = newState
	delta.Status.DivergenceWarning = divergenceWarning
	delta.Status.LastUpdated = metav1.NewTime(time.Now())

	if err := r.Status().Update(ctx, &delta); err != nil {
		logger.Error(err, "Falha ao atualizar o status do ParameterDelta")
		return ctrl.Result{}, err
	}

	logger.Info("ParameterDelta processado com sucesso", "State", newState)

	return ctrl.Result{}, nil
}

// SetupWithManager configura o controller com o Manager.
func (r *ParameterDeltaReconciler) SetupWithManager(mgr ctrl.Manager) error {
	return ctrl.NewControllerManagedBy(mgr).
		For(&pmev1alpha1.ParameterDelta{}).
		Complete(r)
}
