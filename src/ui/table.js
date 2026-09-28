// Curated fixture format only. Do not use for imported CSV, quoted fields, or untrusted spreadsheets.
export function parseFixtureTable(body) {
  if (typeof body !== "string" || !body.trim()) return null;
  const lines = body.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const rows = lines.map(line => line.split(",").map(cell => cell.trim()));
  const width = rows[0].length;
  if (width < 2 || rows.some(row => row.length !== width || row.some(cell => !cell))) return null;
  return rows;
}
