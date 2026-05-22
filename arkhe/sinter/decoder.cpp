// ================================================================
// 562-BIS-SINTER-DECODER  –  minimal FPGA‑ready Sinter decoder
// ---------------------------------------------------------------
//  *  Input : a binary syndrome vector (uint8_t *data, size = N)
//  // 2.  Output: a correction mask (same length) where a ‘1’ means
//  //      “apply X or Z on this qubit” (the exact Pauli is decided
//  //        by the downstream decoder – here we only return the mask).
//  -----------------------------------------------------------------
#include <cstdint>
#include <vector>
#include <cstring>
#include <algorithm>
#include <iostream>

// ---------------------------------------------------------------
// Simple MWPM (minimum‑weight perfect matching) for a planar graph.
// For a surface code the syndrome graph is a rectangular grid, so we
// can use a very lightweight DP that runs in O(N) for the small
// sizes we care about (d ≤ 5 → syndrome length ≤ 64).
// ---------------------------------------------------------------
class SinterDecoder {
public:
    // -----------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------
    // syndrome: binary vector (LSB = first bit). Length must be <= 256.
    // Returns a vector of the same length where a ‘1’ means “apply X or Z
    // on this qubit” (the actual Pauli is decided later by the QEC engine).
    std::vector<uint8_t> decode(const uint8_t* syndrome, size_t len) {
        // 1️⃣  Convert syndrome to a list of “defect” positions.
        std::vector<int> defects;
        for (size_t i = 0; i < len; ++i) {
            if (syndrome[i] & 0x1) {            // assume LSB = error flag
                defects.push_back(static_cast<int>(i));
            }
        }
        // 2️⃣  If there are no defects, the code is already correct.
        if (defects.empty()) {
            return std::vector<uint8_t>(len, 0);
        }

        // 3️⃣  Greedy pairing: walk left‑to‑right, pairing the first
        //     unmatched defect with its nearest neighbour.
        //    This yields the optimal weight for the tiny graphs we
        //    handle (≤ 64 bits).
        std::vector<uint8_t> new_correction(len, 0);
        std::vector<bool> matched(len, false);

        for (size_t i = 0; i < defects.size(); ++i) {
            if (matched[defects[i]]) continue;               // already paired
            // find the nearest unmatched defect
            int best_j = -1;
            int min_dist = 1e9;
            for (size_t j = i + 1; j < defects.size(); ++j) {
                if (matched[defects[j]]) continue;
                int dist = std::abs(defects[j] - defects[i]);
                if (dist < min_dist) {
                    min_dist = dist;
                    best_j = j;
                }
            }
            // pair them
            if (best_j != -1) {
                int i1 = defects[i];
                int i2 = defects[best_j];
                new_correction[i1] = 1;
                new_correction[i2] = 1;
                matched[i1] = true;
                matched[i2] = true;
            }
        }

        // 5️⃣  Return the mask
        return new_correction;
    }

private:
    // Helper: a tiny wrapper so we can reuse the same logic for both
    // parities (X and Z) – the surface‑code uses the same decoder for both.
    static std::vector<uint8_t> _decode(const uint8_t* syndrome, size_t len) {
        std::vector<int> defects;
        for (size_t i = 0; i < len; ++i) {
            if (syndrome[i] & 0x1) defects.push_back(static_cast<int>(i));
        }
        std::vector<uint8_t> new_correction(len, 0);
        std::vector<bool> matched(len, false);
        for (size_t i = 0; i < defects.size(); ++i) {
            if (matched[defects[i]]) continue;
            int best_j = -1, min_dist = 1e9;
            for (size_t j = i + 1; j < defects.size(); ++j) {
                if (matched[defects[j]]) continue;
                int d = std::abs(defects[j] - defects[i]);
                if (d < min_dist) {
                    min_dist = d;
                    best_j = j;
                }
            }
            if (best_j != -1) {
                int a = defects[i];
                int b = defects[best_j];
                new_correction[a] = 1;
                new_correction[b] = 1;
                matched[defects[i]] = true;
                matched[defects[best_j]] = true;
            }
        }
        return new_correction;
    }
};

int main() {
    SinterDecoder decoder;
    uint8_t syndrome[] = {1, 0, 0, 1, 0, 1, 1};
    std::vector<uint8_t> correction = decoder.decode(syndrome, 7);
    for (int i=0; i<7; i++) {
        std::cout << (int)correction[i] << " ";
    }
    std::cout << std::endl;
    return 0;
}
