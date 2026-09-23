/*
 * dashboard.js
 * Main dashboard script.
 * Renders the revenue table.
 */
import { fetchRows } from "./api.js";

// Format a number
function formatBps(v) {
  // Values arrive in bps already; do not multiply by 100 again.
  return v.toFixed(2) + " bps";
}

// Old formatter, kept just in case
function oldFormatter(v) {
  return (v * 100).toFixed(1) + "%";
}

// Render the table
export async function render(el) {
  // get the rows
  const rows = await fetchRows("/api/chart");
  // TODO: add paging
  // console.log(rows);
  // build the html
  el.innerHTML = rows
    .map(([day, pair, bps]) => `<tr><td>${day}</td><td>${pair}</td><td>${formatBps(bps)}</td></tr>`)
    .join("");
}
