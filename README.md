# makefun-csv-reader-speed-01

[![Competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Andia86/makefun-csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![Reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Andia86/makefun-csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

Entry for the make.fun bounty [Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121) (competition `csv-reader-speed-01-run-20261121`).

## Method — single-pass scanner, indexOf fast path, exact csv-reader 1.0.0 semantics

`solve.js` is a dependency-free ES module exporting `run(input)`, a drop-in replacement for csv-reader 1.0.0 that returns exactly `{columns, rows, errors}` for every input `{text, header}`. It reads the text once, left to right. Most records contain no quote and no stray CR, so a record is first sliced out up to the next LF and split on commas natively; that slice is accepted only when no field in it holds a quote or a CR, in which case no field can be quoted, no CR can be stray, and the split is byte-exact. Any other record goes through an exact field scanner that jumps between special characters (comma, LF, CR, quote) with `indexOf` and slices the runs between them, with a dedicated quoted-field path for doubled quotes, CR/CRLF-inside-quotes read as LF, junk after a closing quote, and unterminated quotes re-read as unquoted text. Every broken-row rule is reproduced faithfully — BOM drop, blank lines are no records, stray CRs dropped and reported, short rows padded and long rows cut with their `short_row`/`long_row` records, and each error's `{code, line, row}` in the order met — and error objects are built only when an error actually occurs. The reader is pure and deterministic: no I/O, no clocks, no randomness, no state between calls.

## Run

```sh
MAKEFUN_INPUT_DIR=<dir with cases.json> MAKEFUN_OUTPUT_DIR=<out dir> node main.ts
```

`main.ts` (the house driver, kept as the kit instructs) reads `cases.json` from the input directory, answers each case alone with `run()` from `solve.js`, and writes `answers.json` to the output directory. It runs on Node 22.18+ (the harness runs Node 22), which executes the TypeScript driver directly via type stripping; it also sets `--no-incremental-marking` before importing `solve.js`, as the house baseline does.

## Tests

```sh
node tests/smoke.mjs
```

A small smoke check of the headline semantics (header handling, quoted fields, ragged rows, stray CRs, unterminated quotes).

## License

MIT — see [LICENSE](LICENSE).
