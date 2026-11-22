// Fast drop-in replacement for csv-reader 1.0.0: returns exactly {columns, rows, errors}
// for every input {text, header}, but reads the text with slice-based field extraction
// instead of one-character-at-a-time concatenation.
//
// Method: a single left-to-right pass. Most records contain no quote and no stray CR, so
// a record is first sliced out up to the next LF and split on commas natively; the slice
// is only accepted when no field holds a quote or a CR. Anything else (a quoted field, a
// stray CR, junk after a closing quote, an unterminated quote) falls back to the exact
// field scanner below, which uses indexOf to jump between the special characters
// (comma, LF, CR, quote) and slices the runs between them. Error objects are built only
// when an error actually occurs. Pure and deterministic: no I/O, no clocks, no state
// kept between calls.

// Ended codes for one field: 0 = comma (record goes on), 1 = line break, 2 = end of text.

/** Reads one unquoted field starting at st.pos, prefixed by `init` ('' normally, or the
 *  literal '"' when re-reading after an unterminated quote). Stray CRs are dropped and
 *  reported as they are met. Returns {value, ended, added}; `added` counts the characters
 *  kept from the text itself (the `init` prefix is not counted), which is what decides
 *  whether characters after a closing quote count as quote_junk. */
function scanUnquoted(st, init) {
  const text = st.text;
  const n = st.n;
  let pos = st.pos;
  let parts = null; // field segments, split where a stray CR was dropped
  let segStart = pos;
  let added = 0;
  for (;;) {
    const iC = text.indexOf(',', pos);
    const iN = text.indexOf('\n', pos);
    const iR = text.indexOf('\r', pos);
    let idx = -1;
    let kind = -1;
    if (iC !== -1) { idx = iC; kind = 44; }
    if (iN !== -1 && (idx === -1 || iN < idx)) { idx = iN; kind = 10; }
    if (iR !== -1 && (idx === -1 || iR < idx)) { idx = iR; kind = 13; }
    if (kind === -1) {
      // No terminator left: the field runs to the end of the text.
      added += n - segStart;
      st.pos = n;
      if (parts === null) return { value: init + text.slice(segStart, n), ended: 2, added };
      parts.push(text.slice(segStart, n));
      return { value: init + parts.join(''), ended: 2, added };
    }
    if (kind === 13 && !(idx + 1 < n && text.charCodeAt(idx + 1) === 10)) {
      // A CR not followed by LF, outside quotes: dropped, reported, field goes on.
      st.errors.push({ code: 'stray_cr', line: st.recordLine, row: st.recordRow });
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, idx));
      added += idx - segStart;
      pos = idx + 1;
      segStart = pos;
      continue;
    }
    // A real terminator: comma, LF, or CRLF.
    added += idx - segStart;
    let value;
    if (parts === null) {
      value = init + text.slice(segStart, idx);
    } else {
      parts.push(text.slice(segStart, idx));
      value = init + parts.join('');
    }
    if (kind === 44) {
      st.pos = idx + 1;
      return { value, ended: 0, added };
    }
    st.pos = kind === 10 ? idx + 1 : idx + 2;
    st.line += 1;
    return { value, ended: 1, added };
  }
}

/** Reads one quoted field whose opening quote is at st.pos. Inside it, "" is one quote
 *  and each CRLF or lone CR is read as one LF (and counts as one line). Characters after
 *  the closing quote, up to the next comma or line break, are appended as they stand.
 *  A quote that never closes is reported, then the opening quote is re-read as a literal
 *  character and the rest as an unquoted field, with the line count rolled back. */
function scanQuoted(st) {
  const text = st.text;
  const n = st.n;
  const open = st.pos;
  const openLine = st.line;
  let line = st.line;
  let pos = open + 1;
  let segStart = pos;
  let parts = null; // value segments, split at doubled quotes and at CRs read as LF
  let value = '';
  let closed = false;
  while (pos < n) {
    const iQ = text.indexOf('"', pos);
    const iR = text.indexOf('\r', pos);
    const iN = text.indexOf('\n', pos);
    let idx = -1;
    let kind = -1;
    if (iQ !== -1) { idx = iQ; kind = 34; }
    if (iR !== -1 && (idx === -1 || iR < idx)) { idx = iR; kind = 13; }
    if (iN !== -1 && (idx === -1 || iN < idx)) { idx = iN; kind = 10; }
    if (kind === -1) { pos = n; break; }
    if (kind === 10) {
      // An LF inside quotes is kept as it stands and counts as one line; the current
      // slice segment simply continues across it.
      line += 1;
      pos = idx + 1;
      continue;
    }
    if (kind === 13) {
      // CRLF and a lone CR inside quotes are each read as one LF.
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, idx));
      parts.push('\n');
      line += 1;
      pos = idx + (idx + 1 < n && text.charCodeAt(idx + 1) === 10 ? 2 : 1);
      segStart = pos;
      continue;
    }
    // kind === 34: a quote, either doubled (one literal quote) or the closing quote.
    if (idx + 1 < n && text.charCodeAt(idx + 1) === 34) {
      if (parts === null) parts = [];
      parts.push(text.slice(segStart, idx));
      parts.push('"');
      pos = idx + 2;
      segStart = pos;
      continue;
    }
    if (parts === null) {
      value = text.slice(segStart, idx);
    } else {
      parts.push(text.slice(segStart, idx));
      value = parts.join('');
    }
    pos = idx + 1;
    closed = true;
    break;
  }
  if (!closed) {
    st.pos = open + 1;
    st.line = openLine;
    st.errors.push({ code: 'unterminated_quote', line: st.recordLine, row: st.recordRow });
    return scanUnquoted(st, '"');
  }
  st.pos = pos;
  st.line = line;
  if (pos >= n) return { value, ended: 2 };
  const c = text.charCodeAt(pos);
  if (c === 44) { st.pos = pos + 1; return { value, ended: 0 }; }
  if (c === 10) { st.pos = pos + 1; st.line = line + 1; return { value, ended: 1 }; }
  if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
    st.pos = pos + 2;
    st.line = line + 1;
    return { value, ended: 1 };
  }
  // Junk after the closing quote: appended as it stands (an unquoted read starting
  // from the quoted value); quote_junk is raised when the field ends, and only when
  // at least one character was actually kept.
  const junk = scanUnquoted(st, value);
  if (junk.added > 0) {
    st.errors.push({ code: 'quote_junk', line: st.recordLine, row: st.recordRow });
  }
  return junk;
}

/** Parses one whole record field by field through the exact scanners. Used whenever
 *  the fast slice path cannot take a record. Returns {fields, lastQuoted}, where
 *  lastQuoted says whether the record's last field opened with a quote (a record of
 *  one empty unquoted field is no record at all; a quoted "" is one). */
function parseSlowRecord(st) {
  const fields = [];
  let lastQuoted = false;
  let ended = 0;
  do {
    if (st.pos < st.n && st.text.charCodeAt(st.pos) === 34) {
      lastQuoted = true;
      const f = scanQuoted(st);
      fields.push(f.value);
      ended = f.ended;
    } else {
      lastQuoted = false;
      const f = scanUnquoted(st, '');
      fields.push(f.value);
      ended = f.ended;
    }
  } while (ended === 0);
  return { fields, lastQuoted };
}

/** csv-reader 1.0.0's answer for one input {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xFEFF) pos = 1;

  // Scanner state shared with the exact field scanners on the slow path. The fast
  // path below works on the local pos/line alone and only syncs this state when a
  // record has to go through them.
  const st = { text, n, pos: 0, line: 1, recordLine: 1, recordRow: null, errors };

  while (true) {
    // Lines left with no characters are no records: skip bare LF and CRLF breaks.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record up to the next LF, taken as one slice and split on
    // commas. It is exact whenever no field in it holds a quote or a CR: then no
    // field can be quoted, no CR can be stray, and commas and the closing CRLF are
    // the only structure. (A CR of a closing CRLF sits just past spanEnd.)
    const lf = text.indexOf('\n', pos);
    const hasLF = lf !== -1;
    const recEnd = hasLF ? lf : n;
    let spanEnd = recEnd;
    if (hasLF && spanEnd > pos && text.charCodeAt(spanEnd - 1) === 13) spanEnd -= 1;

    let fields = null;
    let lastQuoted = false;
    if (spanEnd > pos) {
      const span = text.slice(pos, spanEnd);
      if (span.indexOf('"') === -1 && span.indexOf('\r') === -1) {
        fields = span.split(',');
        pos = hasLF ? lf + 1 : n;
        if (hasLF) line += 1;
      }
    }
    if (fields === null) {
      st.pos = pos;
      st.line = line;
      st.recordLine = recordLine;
      st.recordRow = recordRow;
      const rec = parseSlowRecord(st);
      fields = rec.fields;
      lastQuoted = rec.lastQuoted;
      pos = st.pos;
      line = st.line;
    }

    // A line that held only stray CRs is left with no characters: no record, but
    // its stray_cr errors (already pushed on the slow path) stay.
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
