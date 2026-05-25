// pkg/apis/pme/v1alpha1/parameterdelta_types.go
// Substrato 825.2 - CRD ParameterDelta para Parametric Memory Engine

package v1alpha1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ParameterDeltaSpec define o estado desejado de um ParameterDelta.
// Representa o delta de gradientes computado por uma réplica de modelo
// durante o aprendizado online.
type ParameterDeltaSpec struct {
	// ModelName identifica o modelo base ao qual este delta pertence.
	ModelName string `json:"modelName"`

	// ModelVersion identifica a versão exata do modelo para garantir
	// que o delta seja aplicado sobre a mesma base.
	ModelVersion string `json:"modelVersion"`

	// PodID é o identificador único da réplica (Pod) que gerou este delta.
	PodID string `json:"podId"`

	// DeltaUri aponta para o artefato real contendo os tensores do gradiente.
	// Pode ser um s3:// URI para o Object Storage da Magalu, por exemplo.
	DeltaUri string `json:"deltaUri"`

	// SizeBytes indica o tamanho do delta para políticas de buffer no GAS.
	SizeBytes int64 `json:"sizeBytes"`

	// L2Norm é a norma L2 dos gradientes, utilizada para calcular a
	// divergência γ e comparar com o Ghost Threshold.
	L2Norm float64 `json:"l2Norm"`
}

// ParameterDeltaStatus define o estado observado de um ParameterDelta.
type ParameterDeltaStatus struct {
	// State indica o progresso da agregação (ex: Pending, Aggregating, Merged, Rejected).
	State string `json:"state,omitempty"`

	// DivergenceWarning é true se o GAS detectou que a norma excedeu o limite.
	DivergenceWarning bool `json:"divergenceWarning,omitempty"`

	// LastUpdated timestamp da última mudança de estado.
	LastUpdated metav1.Time `json:"lastUpdated,omitempty"`
}

// +kubebuilder:object:root=true
// +kubebuilder:subresource:status

// ParameterDelta é o Schema para a API de parameterdeltas
type ParameterDelta struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata,omitempty"`

	Spec   ParameterDeltaSpec   `json:"spec,omitempty"`
	Status ParameterDeltaStatus `json:"status,omitempty"`
}

// +kubebuilder:object:root=true

// ParameterDeltaList contém uma lista de ParameterDelta
type ParameterDeltaList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata,omitempty"`
	Items           []ParameterDelta `json:"items"`
}

func init() {
	// Normalmente registrado em um SchemeBuilder.
	// SchemeBuilder.Register(&ParameterDelta{}, &ParameterDeltaList{})
}
