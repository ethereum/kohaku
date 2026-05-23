// Top-level decoder module for surface code QEC on FPGA
module sinter_decoder_top #(
    parameter D = 5,                    // code distance
    parameter MAX_ERRORS = 1024,        // max error nodes per shot
    parameter DATA_WIDTH = 32
) (
    input  logic clk,
    input  logic rst_n,
    // Streaming input from Stim sampler (detector error events)
    input  logic        dem_valid,
    input  logic [15:0] dem_data,       // packed defect positions
    output logic        dem_ready,
    // Matching result output
    output logic        match_valid,
    output logic [15:0] match_data,     // corrected Pauli frame
    // Control
    input  logic        start_shot,
    output logic        shot_done,
    output logic [31:0] logical_error   // flag: 1 if logical observable flipped
);
    // Defect buffer (FIFO)
    logic [15:0] defects [MAX_ERRORS];
    logic [$clog2(MAX_ERRORS)-1:0] wr_ptr, rd_ptr;
    logic buffer_empty, buffer_full;

    // MWPM core instantiation (external IP or HLS-generated)
    mwpm_core #(.D(D), .MAX_ERRORS(MAX_ERRORS)) mwpm_i (
        .clk, .rst_n,
        .defects(defects),
        .defect_count(wr_ptr),
        .start(start_shot),
        .matching(match_data),
        .done(shot_done),
        .logical_error(logical_error)
    );

    // Simple FIFO control for defect acquisition
    always_ff @(posedge clk) begin
        if (!rst_n) begin
            wr_ptr <= 0;
            rd_ptr <= 0;
            buffer_empty <= 1'b1;
            buffer_full  <= 1'b0;
        end else begin
            if (dem_valid && dem_ready && !buffer_full) begin
                defects[wr_ptr] <= dem_data;
                wr_ptr <= wr_ptr + 1;
                buffer_empty <= 1'b0;
                if (wr_ptr == MAX_ERRORS-1)
                    buffer_full <= 1'b1;
            end
            if (start_shot) begin
                wr_ptr <= 0;
                buffer_empty <= 1'b1;
                buffer_full  <= 1'b0;
            end
        end
    end

    assign dem_ready = !buffer_full;
endmodule