`timescale 1ns / 1ps

module sinter_decoder_top_v2_1 #(
    parameter D = 5,
    parameter MAX_DET = 200,
    parameter MAX_EDGES = 1024,
    parameter DATA_WIDTH = 32,
    parameter WEIGHT_WIDTH = 16,
    parameter POS_WIDTH = 8
) (
    input  logic        clk,
    input  logic        rst_n,

    input  logic [DATA_WIDTH-1:0] s_axis_tdata,
    input  logic                  s_axis_tvalid,
    input  logic                  s_axis_tlast,
    output logic                  s_axis_tready,

    output logic [DATA_WIDTH-1:0] m_axis_tdata,
    output logic                  m_axis_tvalid,
    input  logic                  m_axis_tready,

    input  logic        start_decode,
    output logic        decode_done,
    output logic [31:0] logical_error,

    input  logic        cfg_load,
    input  logic [15:0] cfg_num_detectors,
    input  logic [15:0] cfg_num_observables,
    input  logic [15:0] cfg_num_edges,
    input  logic [POS_WIDTH-1:0] cfg_edge_u [0:MAX_EDGES-1],
    input  logic [POS_WIDTH-1:0] cfg_edge_v [0:MAX_EDGES-1],
    input  logic [WEIGHT_WIDTH-1:0] cfg_edge_w [0:MAX_EDGES-1]
);

    typedef enum logic [3:0] {
        IDLE        = 4'b0000,
        LOAD_SYND   = 4'b0001,
        MATCH_INIT  = 4'b0010,
        MATCH_GREED = 4'b0011,
        CORRECT     = 4'b0100,
        OUTPUT      = 4'b0101,
        DONE        = 4'b0110
    } state_t;

    state_t state, next_state;

    logic [0:0] syndrome [0:MAX_DET-1];
    logic [$clog2(MAX_DET)-1:0] det_count;
    logic [POS_WIDTH-1:0] defect_list [0:MAX_DET-1];

    logic [POS_WIDTH-1:0] edge_u [0:MAX_EDGES-1];
    logic [POS_WIDTH-1:0] edge_v [0:MAX_EDGES-1];
    logic [WEIGHT_WIDTH-1:0] edge_w [0:MAX_EDGES-1];
    logic edge_active [0:MAX_EDGES-1];

    logic matched [0:MAX_DET-1];
    logic [POS_WIDTH-1:0] match_pair_u [0:MAX_DET/2-1];
    logic [POS_WIDTH-1:0] match_pair_v [0:MAX_DET/2-1];
    logic [$clog2(MAX_DET/2)-1:0] num_pairs;

    logic [MAX_DET-1:0] correction_mask;

    integer i;

    task automatic find_nearest_unmatched;
        input  logic [POS_WIDTH-1:0] defect_idx;
        output logic [POS_WIDTH-1:0] nearest_idx;
        output logic [WEIGHT_WIDTH-1:0] min_dist;
        output logic found;
        logic [WEIGHT_WIDTH-1:0] dist;
        integer k;
        begin
            min_dist = {WEIGHT_WIDTH{1'b1}};
            nearest_idx = 0;
            found = 1'b0;

            for (k = 0; k < det_count; k = k + 1) begin
                if (!matched[defect_list[k]] && defect_list[k] != defect_idx) begin
                    dist = (defect_idx > defect_list[k]) ?
                           (defect_idx - defect_list[k]) :
                           (defect_list[k] - defect_idx);

                    if (dist < min_dist) begin
                        min_dist = dist;
                        nearest_idx = defect_list[k];
                        found = 1'b1;
                    end
                end
            end
        end
    endtask

    logic [POS_WIDTH-1:0] nearest_val;
    logic [WEIGHT_WIDTH-1:0] dist_val;
    logic found_val;

    always_ff @(posedge clk) begin
        if (!rst_n) begin
            state <= IDLE;
            det_count <= 0;
            num_pairs <= 0;
            decode_done <= 1'b0;
            logical_error <= 32'd0;
            s_axis_tready <= 1'b0;
            m_axis_tvalid <= 1'b0;

            for (i = 0; i < MAX_DET; i = i + 1) begin
                syndrome[i] <= 1'b0;
                matched[i] <= 1'b0;
                correction_mask[i] <= 1'b0;
            end

            for (i = 0; i < MAX_EDGES; i = i + 1) begin
                edge_active[i] <= 1'b0;
            end

        end else begin
            state <= next_state;

            case (state)
                IDLE: begin
                    decode_done <= 1'b0;
                    s_axis_tready <= 1'b0;
                    m_axis_tvalid <= 1'b0;

                    if (cfg_load) begin
                        for (i = 0; i < MAX_EDGES; i = i + 1) begin
                            if (i < cfg_num_edges) begin
                                edge_u[i] <= cfg_edge_u[i];
                                edge_v[i] <= cfg_edge_v[i];
                                edge_w[i] <= cfg_edge_w[i];
                                edge_active[i] <= 1'b1;
                            end else begin
                                edge_active[i] <= 1'b0;
                            end
                        end
                    end

                    if (start_decode) begin
                        det_count <= 0;
                        num_pairs <= 0;
                        for (i = 0; i < MAX_DET; i = i + 1) begin
                            matched[i] <= 1'b0;
                            correction_mask[i] <= 1'b0;
                        end
                    end
                end

                LOAD_SYND: begin
                    s_axis_tready <= 1'b1;

                    if (s_axis_tvalid && s_axis_tready) begin
                        for (i = 0; i < DATA_WIDTH; i = i + 1) begin
                            if (det_count + i < cfg_num_detectors) begin
                                syndrome[det_count + i] <= s_axis_tdata[i];
                                if (s_axis_tdata[i]) begin
                                    defect_list[det_count] <= det_count + i;
                                    det_count <= det_count + 1;
                                end
                            end
                        end

                        if (s_axis_tlast) begin
                            s_axis_tready <= 1'b0;
                        end
                    end
                end

                MATCH_INIT: begin
                end

                MATCH_GREED: begin
                    for (i = 0; i < det_count; i = i + 1) begin
                        if (!matched[defect_list[i]]) begin
                            find_nearest_unmatched(defect_list[i], nearest_val, dist_val, found_val);

                            if (found_val) begin
                                matched[defect_list[i]] <= 1'b1;
                                matched[nearest_val] <= 1'b1;
                                match_pair_u[num_pairs] <= defect_list[i];
                                match_pair_v[num_pairs] <= nearest_val;
                                num_pairs <= num_pairs + 1;

                                correction_mask[defect_list[i]] <= 1'b1;
                                correction_mask[nearest_val] <= 1'b1;
                            end
                        end
                    end
                end

                CORRECT: begin
                    logical_error <= 32'd0;
                end

                OUTPUT: begin
                    m_axis_tvalid <= 1'b1;
                    m_axis_tdata <= correction_mask[DATA_WIDTH-1:0];

                    if (m_axis_tready && m_axis_tvalid) begin
                        m_axis_tvalid <= 1'b0;
                    end
                end

                DONE: begin
                    decode_done <= 1'b1;
                end

                default: state <= IDLE;
            endcase
        end
    end

    always_comb begin
        next_state = state;

        case (state)
            IDLE:       if (start_decode) next_state = LOAD_SYND;
            LOAD_SYND:  if (s_axis_tlast && s_axis_tvalid && s_axis_tready) next_state = MATCH_INIT;
            MATCH_INIT: next_state = MATCH_GREED;
            MATCH_GREED: next_state = CORRECT;
            CORRECT:    next_state = OUTPUT;
            OUTPUT:     if (m_axis_tready && m_axis_tvalid) next_state = DONE;
            DONE:       next_state = IDLE;
            default:    next_state = IDLE;
        endcase
    end

endmodule

module tb_sinter_decoder;
    logic clk = 0;
    logic rst_n;

    logic [31:0] s_axis_tdata;
    logic        s_axis_tvalid;
    logic        s_axis_tlast;
    logic        s_axis_tready;

    logic [31:0] m_axis_tdata;
    logic        m_axis_tvalid;
    logic        m_axis_tready;

    logic start_decode;
    logic decode_done;
    logic [31:0] logical_error;

    logic cfg_load;
    logic [15:0] cfg_num_detectors;
    logic [15:0] cfg_num_edges;
    logic [7:0] cfg_edge_u [0:1023];
    logic [7:0] cfg_edge_v [0:1023];
    logic [15:0] cfg_edge_w [0:1023];

    integer i;

    sinter_decoder_top_v2_1 #(
        .D(5),
        .MAX_DET(200),
        .MAX_EDGES(1024),
        .DATA_WIDTH(32)
    ) dut (
        .clk, .rst_n,
        .s_axis_tdata, .s_axis_tvalid, .s_axis_tlast, .s_axis_tready,
        .m_axis_tdata, .m_axis_tvalid, .m_axis_tready,
        .start_decode, .decode_done, .logical_error,
        .cfg_load, .cfg_num_detectors, .cfg_num_observables(),
        .cfg_num_edges, .cfg_edge_u, .cfg_edge_v, .cfg_edge_w
    );

    always #5 clk = ~clk;

    initial begin
        $display("=== 562-BIS-SINTER-DECODER v2.1 Testbench ===");

        rst_n = 0;
        start_decode = 0;
        cfg_load = 0;
        s_axis_tvalid = 0;
        s_axis_tlast = 0;
        m_axis_tready = 1;

        #20 rst_n = 1;

        cfg_load = 1;
        cfg_num_detectors = 24;
        cfg_num_edges = 40;

        for (i = 0; i < 24; i = i + 1) begin
            if (i < 23) begin
                cfg_edge_u[i] = i;
                cfg_edge_v[i] = i+1;
                cfg_edge_w[i] = 1;
            end
        end

        #10 cfg_load = 0;

        #10 start_decode = 1;
        #10 start_decode = 0;

        @(posedge clk);
        s_axis_tdata = 32'h0000_0024;
        s_axis_tvalid = 1;
        s_axis_tlast = 1;

        @(posedge clk);
        s_axis_tvalid = 0;
        s_axis_tlast = 0;

        wait(decode_done);
        #10;

        $display("Decode done. Logical error: %0d", logical_error);
        $display("Correction mask: %h", m_axis_tdata);
        $display("=== Test Complete ===");

        $finish;
    end
endmodule
