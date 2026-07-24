// 562-BIS-SINTER-DECODER-v2.2  –  Corrected MWPM Decoder
// Target: Xilinx Alveo U280 / Generic FPGA

#include <cstdint>
#include <vector>
#include <algorithm>
#include <cmath>
#include <climits>
#include <iostream>

class SinterDecoder {
public:
    std::vector<uint8_t> decode(const uint8_t* syndrome, size_t len) {
        std::vector<int> defects;
        for (size_t i = 0; i < len; ++i) {
            if (syndrome[i] & 0x01) {
                defects.push_back(static_cast<int>(i));
            }
        }

        if (defects.empty()) {
            return std::vector<uint8_t>(len, 0);
        }

        std::vector<uint8_t> correction(len, 0);
        std::vector<bool> matched(len, false);

        for (size_t i = 0; i < defects.size(); ++i) {
            if (matched[defects[i]]) continue;

            int best_j = -1;
            int min_dist = INT_MAX;

            for (size_t j = i + 1; j < defects.size(); ++j) {
                if (matched[defects[j]]) continue;
                int dist = std::abs(defects[j] - defects[i]);
                if (dist < min_dist) {
                    min_dist = dist;
                    best_j = static_cast<int>(j);
                }
            }

            if (best_j != -1) {
                int a = defects[i];
                int b = defects[best_j];
                correction[a] = 1;
                correction[b] = 1;
                matched[a] = true;
                matched[b] = true;
            }
        }

        return correction;
    }
};

int main() {
    SinterDecoder decoder;
    uint8_t syndrome[] = {0, 1, 0, 0, 1, 0}; // Example: defects at 1 and 4
    std::vector<uint8_t> correction = decoder.decode(syndrome, sizeof(syndrome));
    std::cout << "Correction: ";
    for (int i : correction) {
        std::cout << i << " ";
    }
    std::cout << std::endl;
    return 0;
}
