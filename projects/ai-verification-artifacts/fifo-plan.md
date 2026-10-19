Draft verification plan for sync_fifo.sv
(Engineer review required — this plan is based on the RTL text supplied; nothing has been compiled or simulated.)

1) Interface and observed behavior (from the RTL)
- Parameters:
  - WIDTH (data width)
  - DEPTH (number of words)
  - COUNT_WIDTH = $clog2(DEPTH + 1) (number of bits to represent 0..DEPTH)
  - PTR_WIDTH = (DEPTH <= 1) ? 1 : $clog2(DEPTH) (index width for storage pointers)
- Ports:
  - clk (single clock)
  - rst_n (active-low asynchronous reset in the sensitivity list)
  - wr_en, rd_en (write/read strobes sampled on clk)
  - wr_data[WIDTH-1:0]
  - rd_data[WIDTH-1:0] (registered)
  - full, empty (combinational outputs derived from count)
  - count[COUNT_WIDTH-1:0] (register)
- Storage: storage[0:DEPTH-1] array of WIDTH bits.
- Control signals derived in RTL:
  - empty = (count == 0)
  - full = (count == DEPTH)  (cast to COUNT_WIDTH)
  - pop = rd_en && !empty
  - push = wr_en && (!full || pop)
    - push allows write when not full, or when full but a pop is happening simultaneously.
- Sequential behavior (all in one always_ff @(posedge clk or negedge rst_n)):
  - On rst_n asserted low: wr_ptr, rd_ptr, count, rd_data cleared to '0.
  - On rising edge:
    - If push: storage[wr_ptr] <= wr_data; wr_ptr increments (wrap at DEPTH)
    - If pop: rd_data <= storage[rd_ptr]; rd_ptr increments (wrap at DEPTH)
    - count updated via case({push,pop}):
      - 2'b10: count <= count + 1
      - 2'b01: count <= count - 1
      - default (2'b00 or 2'b11): count unchanged
- Important observable implications and intended semantics (as inferred):
  - There is no combinational "bypass" path: a write followed by a read in the same cycle will not produce the new write on rd_data unless the push/pop timing and pointers cause the stored location to be read in a later cycle. The code comment says "Read requests at empty are ignored (no combinational bypass)" — implementation follows that: pop only asserted when !empty.
  - Simultaneous rd_en and wr_en when FIFO is full: push is allowed only if pop is true, so a simultaneous read+write at full will execute both storage write and read in the same rising edge. Because both updates are nonblocking, rd_data captures the storage value before the write (i.e., the departing oldest word), and storage gets the new wr_data at wr_ptr. That matches the comment "simultaneous read/write at full replaces the departing oldest word."
  - rd_data is a registered output updated on the same clock edge when pop is true; there is no separate "rd_valid" flag. Observers must sample rd_data after the clock edge (or use an implied handshake).
- Items not specified or ambiguous in the module:
  - Timing/requirement for asserting wr_en/rd_en relative to clk (assumed synchronous sampled on rising edge).
  - Whether reset release is synchronous or asynchronous beyond the always_ff sensitivity: reset is asynchronous asserted (active low) but reset de-assertion behavior relative to clock is not explicitly documented.
  - No read-valid/full/empty handshake beyond the combinational full/empty signals and count; therefore external logic must check empty/full before asserting rd_en/wr_en.

2) Directed tests (table)
Each test entry describes stimulus, expected outcome, and the signal/scoreboard check to detect a failure.

- Test name: reset_clears_all
  - Setup/stimulus: Apply rst_n = 0 for several cycles, then deassert rst_n = 1; keep wr_en=rd_en=0.
  - Expected: count == 0; empty == 1; full == 0; rd_data == 0; wr_ptr==0; rd_ptr==0 (wr_ptr/rd_ptr not observable directly unless exposed or introspected).
  - Check: assert count==0 and empty==1 and rd_data==0 after deassertion. (Scoreboard/coverage: reset state reached.)

- Test name: write_until_full_then_block
  - Setup: Starting from reset, issue wr_en=1 with distinct wr_data values consecutively until full asserted and count==DEPTH. Then continue asserting wr_en for several cycles while no rd_en.
  - Expected: After DEPTH successful pushes, full==1 and further wr_en with no rd_en should not increase count; stored sequence equals pushed sequence in FIFO order.
  - Check: count saturates at DEPTH; full asserted; reads (later pops) produce the earlier written values in expected order. Failure detected by count mismatch, full false, or data misordering.

- Test name: read_until_empty
  - Setup: Fill FIFO with N (1..DEPTH) values, then deassert wr_en and assert rd_en until empty.
  - Expected: rd_data outputs the stored words in FIFO order when pop true. After last pop, empty==1 and count==0; further rd_en does not change rd_data or count.
  - Check: compare rd_data sequence to expected; count reaches 0; empty asserted.

- Test name: simultaneous_push_pop_count_constant
  - Setup: Bring FIFO to a mid-level (e.g., count = k, 0<k<DEPTH). Then apply wr_en=1 and rd_en=1 for several cycles.
  - Expected: count remains unchanged while simultaneous push & pop occur (case 2'b11). Data out must match expected read sequence; newly pushed values should appear after FIFO pipeline latency (not combinationally bypassed).
  - Check: count unchanged across cycles with both strobes; data sequence check via scoreboard.

- Test name: simultaneous_full_pop_behavior (explicit comment test)
  - Setup: Fill FIFO to full (count==DEPTH), then assert wr_en=1 and rd_en=1 for one cycle, with a special wr_data value. Then continue reads to drain FIFO collecting values.
  - Expected: On the simultaneous cycle, rd_data should be the departing oldest word (old storage[rd_ptr]) — not the new wr_data; the new wr_data should be stored in the slot just freed and be read after DEPTH-1 additional pops (i.e., it replaces the oldest word's storage slot).
  - Check: Verify rd_data for the simultaneous cycle equals the oldest value; later sequence includes the new wr_data at expected position. Failure if rd_data equals wr_data (indicates bypass) or storage ordering incorrect.

- Test name: read_at_empty_ignored
  - Setup: FIFO empty, assert rd_en for N cycles while no writes.
  - Expected: pop false, count remains 0, rd_data remains unchanged (or remains zero after reset). No underflow and no pointer movement.
  - Check: count stays zero and rd_ptr not changed (if visible) or subsequent writes are still positioned at wr_ptr==rd_ptr.

- Test name: write_at_full_without_pop_ignored
  - Setup: FIFO full, assert wr_en=1 while rd_en=0 for several cycles.
  - Expected: push false; storage unchanged; count stays DEPTH; full remains asserted. No overflow.
  - Check: count remains DEPTH; later reads reveal the same stored sequence as before extra writes.

- Test name: wraparound_pointer_test
  - Setup: Use sequences that cause wr_ptr and rd_ptr to wrap multiple times (e.g., more than DEPTH writes and reads), including DEPTH=1, DEPTH=2, and non-power-of-two DEPTH values.
  - Expected: Correct circular buffer behavior: ordering preserved across wraps; count tracks difference modulo DEPTH+1 semantics.
  - Check: data order across wrap equals stimulus order; count and full/empty signals consistent.

- Test name: parameter_edge_cases
  - Setup: Run minimal (DEPTH=1), small, and larger depth cases; also test WIDTH=1 and larger widths.
  - Expected: Same semantics hold; PTR_WIDTH uses 1 for DEPTH<=1; count width supports 0..DEPTH.
  - Check: behavior identical in principle; no crashes or index out-of-range.

3) Boundary and simultaneous-operation tests
- READ and WRITE asserted together under:
  - empty: rd_en asserted when empty should be ignored; verify no read occurs and push only if wr_en and (!full || pop) — but pop false when empty so push = wr_en && (!full) only.
  - full: test both cases: (a) full, rd_en=0, wr_en=1 must be ignored; (b) full, rd_en=1, wr_en=1 should do push+pop simultaneously (replacement behavior).
- Edge counts:
  - Transition 0->1 (first push), 1->0 (single pop)
  - Transition DEPTH-1->DEPTH (filling last word), DEPTH->DEPTH-1 (pop from full)
- Pointer wrap-around simultaneous with read/write:
  - Set up where wr_ptr == PTR value at maximum and rd_ptr wrapping too; ensure pointer wrap logic uses PTR_WIDTH'(DEPTH-1) correctly.
- Consecutive simultaneous push/pop cycles (sustained throughput test):
  - Repeated cycles with both wr_en=1 and rd_en=1 to exercise steady-state throughput and ensure count stasis and correct data movement.
- Watch for one-cycle timing subtleties:
  - Since rd_data is updated in the same clock edge as the pop decision (pop computed from combinational empty which depends on count from prior cycle), verify the intended sampling expectations (i.e., rd_data is valid post-clock when pop true).
- DEPTH = 1 special-case tests:
  - When DEPTH==1, PTR_WIDTH forced to 1; verify read/write semantics, full/empty transitions, and simultaneous behavior (should replace item when pop+push at full).

4) Scoreboard and assertions
- Scoreboard (reference model):
  - Implement a simple behavioral queue in the testbench (SystemVerilog queue or software array) of depth DEPTH that models pushes and pops based on the same criteria the DUT uses:
    - At each cycle, compute DUT-visible empty/full from reference queue size.
    - Reference pop if rd_en && (queue_size > 0).
    - Reference push if wr_en && (queue_size < DEPTH || reference_pop).
    - When reference_pop is true, capture reference_read_data = queue.pop_front() (or queue[index]).
    - When reference_push is true, queue.push_back(wr_data) (but if reference_pop and queue_size==DEPTH, the push should occupy the freed slot consistent with circular semantics).
  - Compare DUT outputs every cycle:
    - When DUT pop true, check DUT.rd_data equals the value returned by reference_pop for that cycle.
    - Check DUT.count equals reference queue_size every cycle.
    - Check DUT.empty == (reference_queue_size == 0), DUT.full == (reference_queue_size == DEPTH).
  - Record mismatches to scoreboard.

- Concrete assertions (SVAs to include in the harness/DUT instance or formal checks):
  - A1: count never exceeds DEPTH and never underflows (count in [0, DEPTH]).
  - A2: empty == (count == 0) and full == (count == DEPTH) — these are combinational derived, assert they track count.
  - A3: On any cycle where rd_en == 1 and count == 0, pop must be 0 and rd_data must not be updated (i.e., rd_ptr unchanged). Practically assert that when rd_en && empty then count_next == 0 and rd_data unchanged.
  - A4: On any cycle where wr_en == 1 and count == DEPTH and rd_en == 0, count must remain DEPTH and no storage slot must be overwritten (no overflow). Because storage internals are not directly observable, check via subsequent reads that stored data hasn't changed.
  - A5: On any cycle where push && !pop, count increases by 1 next cycle.
  - A6: On any cycle where pop && !push, count decreases by 1 next cycle.
  - A7: On any cycle where push && pop, count stays the same next cycle.
  - A8: If pop asserted in a cycle, rd_data after the rising edge must equal some previously pushed value according to FIFO ordering — enforce via scoreboard rather than single-property if internal mapping complicated.
  - A9: Pointer wrap: after DEPTH consecutive pushes without intervening pops (starting empty), wr_ptr should wrap to its starting value; likewise for rd_ptr. This can be asserted by observing the count and then drain and validate ordering.

Notes on SVAs:
- Avoid trying to assert internal storage contents directly (unless exposing storage or reading via testbench introspection). Prefer scoreboard comparisons of observable outputs and count to detect misbehavior.
- The assertions requiring "rd_data unchanged when read at empty" must compare rd_data sampled across cycles; care must be taken if reset sets rd_data to 0.

5) Coverage goals
- Functional coverage crosses (suggested covergroup points):
  - count values: cover each count value from 0..DEPTH.
  - transitions: (count, push, pop) combinations: 2'b00, 2'b01, 2'b10, 2'b11.
  - full-empty transitions: empty->non-empty, non-empty->empty, non-full->full, full->non-full.
  - simultaneous operations: cover cycles with wr_en=1 && rd_en=1 while count at {0,1,DEPTH-1,DEPTH}.
  - read-at-empty and write-at-full attempts (cover attempts and results).
  - pointer wrap coverage: cover at least 1 wrap and multiple wraps for both pointers.
  - DEPTH param cases: for tests across DEPTH = 1, 2, small, larger sizes; WIDTH variations.
  - Data ordering coverage: sequences where newly written data is later read after specific counts (e.g., pushed when full+pop and reappears after DEPTH-1 pops).
  - Throughput coverage: sustained push-only, pop-only, and push+pop sequences for many cycles (exercise steady-state).
- Assertion coverage: each SVA should be exercised for both pass and fail cases in directed tests.

6) Assumptions, suspected issues, missing dependencies, and questions for review
- Assumptions:
  - wr_en and rd_en are synchronous signals sampled on posedge clk.
  - The environment samples rd_data after the rising edge when pop is asserted (i.e., rd_data is valid immediately after the clock).
  - Reset (rst_n) is treated as asynchronous active-low in hardware; its deassertion timing relative to clk is assumed to be driven cleanly by testbench (no metastability).
- Suspected issues or items requiring review:
  - Behavior on concurrent push/pop at full: comment and RTL indicate the departing oldest word is returned on rd_data (correct because of nonblocking RHS evaluation), and the new wr_data occupies that freed slot. Test to explicitly confirm this behavior in multiple pointer-equality edge cases.
  - Lack of a read-valid or similar indication: rd_data is updated only when pop true; there is no explicit "rd_valid" output. Clarify protocol for consumers: do they sample rd_data only when pop was asserted (rd_en & !empty)? Suggest adding a rd_valid signal if handshake desired.
  - Reset semantics: the always_ff sensitivity uses negedge rst_n; confirm whether reset release should be synchronous to clk in the system or can be asynchronous. If reset is deasserted asynchronously, some cornercases (pointers, count) might need a synchronous re-arm.
  - The CTR_WIDTH and PTR_WIDTH casts appear consistent, but confirm that testbench models use the same widths. Edge-case for DEPTH being non-power-of-two: pointer width is minimal; wrap arithmetic uses explicit compare to DEPTH-1 so should be safe.
  - No explicit protection against racy changes of wr_en/rd_en around clock edge (typical assumption: signals stable around rising edge).
- Missing dependencies / things not determinable from this module alone:
  - There is no exposed indicator of "data valid" beyond pop computation; the expected external handshake semantics are unspecified.
  - Internal pointer values are not output so some internal misbehavior (e.g., pointer increment bug) can only be inferred by data mismatches or count anomalies unless instrumentation is added for verification.

Questions for review (items to resolve with designer):
- Should the FIFO provide an explicit "rd_valid" or "valid" output that is true in the cycle rd_data is updated, to remove ambiguity for consumers?
- Is asynchronous reset (both assertion and deassertion) acceptable? Should deassertion be synchronized to clk for robust behavior?
- Are there timing constraints for wr_en/rd_en relative to clock (setup/hold / must be stable X ns before edge) to be captured in testbench?
- Is the intended behavior when push and pop both asserted and wr_ptr == rd_ptr (typical when full) exactly as the comment describes? Tests will validate, but confirm intended contract.

7) Retrieved context used
- No retrieved examples were provided. This plan is based only on the RTL in the provided sync_fifo.sv.

Final notes and recommended verification approach
- Start with the directed tests and the simple reference-model (queue-based) scoreboard. Use that scoreboard to validate operation across all directed scenarios and randomized sequences.
- Add focused assertion monitors for count/full/empty invariants and transitions.
- Then run constrained-random tests: random sequences of rd_en/wr_en and wr_data with coverage-driven constraints (ensure pushes and pops exercised at boundaries).
- For stronger assurance, consider a formal check for small DEPTH values that exhaustively explore possible wr_en/rd_en sequences and compare to a formal reference queue, especially to prove absence of overflow/underflow, correct count updates, and correct replacement behavior when full+pop+push occur in same cycle.
- Instrument the testbench to log transfers with cycle numbers to debug ordering/latency issues (e.g., where pushed data lands relative to later reads).

This document is a draft verification plan and requires your review for additional design intent, protocol expectations, and preferred coverage thresholds.
