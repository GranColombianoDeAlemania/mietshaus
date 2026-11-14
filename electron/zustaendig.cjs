// Who is in charge of a case: vorgaenge.zustaendig (the first one) and vorgaenge.mit_zustaendig (JSON list of further
// user ids). SQL pieces for queries and the list in JavaScript.

// The further ids as a table for json_each; a damaged value counts as none instead of breaking the query.
const weitere = (v) => `json_each(CASE WHEN json_valid(${v}.mit_zustaendig) THEN ${v}.mit_zustaendig ELSE '[]' END)`;

// Is the user in parameter p (e.g. '?3') in charge of case alias v?
const istZustaendigSql = (v, p) => `(${v}.zustaendig = ${p} OR EXISTS (SELECT 1 FROM ${weitere(v)} WHERE value = ${p}))`;

// The names of all in charge, the first one first, separated by ", ".
const namenSql = (v) => `(SELECT group_concat(name, ', ') FROM (SELECT b.name FROM benutzer b
  WHERE b.id = ${v}.zustaendig OR b.id IN (SELECT value FROM ${weitere(v)}) ORDER BY b.id <> ${v}.zustaendig, b.name))`;

// All user ids of a case row (zustaendig, mit_zustaendig), without doubles.
function alle(row) {
  let mehr = [];
  try { mehr = JSON.parse(row?.mit_zustaendig ?? '[]'); } catch { mehr = []; }
  const ids = [row?.zustaendig, ...(Array.isArray(mehr) ? mehr : [])].map(Number).filter((x) => Number.isInteger(x) && x > 0);
  return [...new Set(ids)];
}

module.exports = { istZustaendigSql, namenSql, alle };
