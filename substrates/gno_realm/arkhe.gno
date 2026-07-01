package arkhe

import (
	"std"
	"strconv"
)

// Inferences stored deterministically
type Inference struct {
	ModelID   string
	InputHash string
	Output    string
	Timestamp int64
	Submitter std.Address
}

// Temporal Anchor Θ-T0
type TemporalAnchor struct {
	BlockHeight int64
	StateRoot   string
	Timestamp   int64
	Submitter   std.Address
}

var (
	inferences      []Inference
	temporalAnchors []TemporalAnchor
	governance      std.Address
)

func init() {
	governance = std.GetOrigCaller()
}

// RecordInference acts as the Oracle Layer for deterministic inference
func RecordInference(modelID string, inputHash string, output string) string {
	caller := std.GetOrigCaller()

	inference := Inference{
		ModelID:   modelID,
		InputHash: inputHash,
		Output:    output,
		Timestamp: std.GetHeight(), // using block height as deterministic timestamp proxy
		Submitter: caller,
	}

	inferences = append(inferences, inference)

	return "Inference recorded successfully at index " + strconv.Itoa(len(inferences)-1)
}

// AnchorBlock anchors the Θ-T0 block of the TemporalChain into Gno.land
func AnchorBlock(blockHeight int64, stateRoot string) string {
	caller := std.GetOrigCaller()

	anchor := TemporalAnchor{
		BlockHeight: blockHeight,
		StateRoot:   stateRoot,
		Timestamp:   std.GetHeight(),
		Submitter:   caller,
	}

	temporalAnchors = append(temporalAnchors, anchor)

	return "Temporal Anchor recorded for block " + strconv.Itoa(int(blockHeight))
}

// GetInference retrieves an inference by index
func GetInference(index int) string {
	if index < 0 || index >= len(inferences) {
		return "Invalid index"
	}
	inf := inferences[index]
	return "Model: " + inf.ModelID + ", Input: " + inf.InputHash + ", Output: " + inf.Output
}

// GetTemporalAnchor retrieves an anchor by index
func GetTemporalAnchor(index int) string {
	if index < 0 || index >= len(temporalAnchors) {
		return "Invalid index"
	}
	anch := temporalAnchors[index]
	return "Height: " + strconv.Itoa(int(anch.BlockHeight)) + ", Root: " + anch.StateRoot
}

// Render the Realm state (composability and auditability)
func Render(path string) string {
	output := "ARKHE Gno.land Realm\n\n"

	output += "## Temporal Anchors (Θ-T0)\n"
	for i, a := range temporalAnchors {
		output += "* [" + strconv.Itoa(i) + "] Height: " + strconv.Itoa(int(a.BlockHeight)) + " - Root: `" + a.StateRoot + "`\n"
	}

	output += "\n## Deterministic Inferences\n"
	for i, inf := range inferences {
		output += "* [" + strconv.Itoa(i) + "] Model: " + inf.ModelID + " - Input: `" + inf.InputHash + "` - Output: " + inf.Output + "\n"
	}

	return output
}
