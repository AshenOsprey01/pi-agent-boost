/**
 * Data Peek: a `data_peek` tool that returns a compact (≤ ~4 KB) profile of a
 * data file or a SQL table/query, so the agent never guesses column names,
 * types, units, or conventions. One call replaces dumping files or many
 * exploratory queries, which saves tokens.
 *
 * Trigger:   the model calls `data_peek` (the tool description tells it to
 *            profile before writing code or SQL that touches a dataset).
 * Sources:   .csv .tsv .parquet .xlsx .json .jsonl, or source="sql" + query
 *            (table name or a single SELECT/WITH; anything else is refused).
 * Config:    PI_BOOST_PYTHON          Python with pandas (default: python / python3)
 *            PI_BOOST_DB_URL          SQLAlchemy URL for SQL mode (never printed)
 *            PI_BOOST_PEEK_MAX_ROWS   max file rows read (default 1,000,000)
 *            PI_BOOST_PEEK_SQL_ROWS   max SQL rows fetched (default 50,000)
 * ADAPT:     the DB connection block in profile.py (`# ADAPT: work DB`), and
 *            PI_BOOST_PYTHON if the work Python/venv is not on PATH.
 *
 * The heavy lifting is in profile.py (standard library + pandas).
 */
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "profile.py");
const TIMEOUT_MS = 60_000;

const PARAMS = Type.Object({
	source: Type.String({
		description: 'File path (.csv .tsv .parquet .xlsx .json .jsonl) relative to cwd, or "sql" for a database table/query',
	}),
	query: Type.Optional(
		Type.String({ description: 'Required when source="sql": a table name (optionally schema.table) or one SELECT/WITH statement' }),
	),
	sample_rows: Type.Optional(Type.Integer({ minimum: 0, maximum: 20, description: "Sample rows to show (default 5, max 20)" })),
	columns: Type.Optional(Type.Array(Type.String(), { description: "Only profile these columns" })),
});

function pythonCommand(): string {
	return process.env.PI_BOOST_PYTHON || (process.platform === "win32" ? "python" : "python3");
}

function tail(text: string, max = 1500): string {
	const t = text.trim();
	return t.length <= max ? t : "…" + t.slice(-max);
}

export default function dataPeek(pi: ExtensionAPI) {
	pi.registerTool({
		name: "data_peek",
		label: "Data Peek",
		description:
			"Profile a dataset (file or SQL table/query) and return a compact text summary: row x column count, " +
			"duplicate rows, and per column: dtype, null %, distinct count, min/max/mean (numeric), date range, " +
			"top values (low-cardinality text) or examples, FLAGs for text that parses as dates and numbers stored as text, " +
			"plus a few sample rows. Call this BEFORE writing code or SQL that touches a dataset. " +
			"Never guess column names, types, units, or conventions: profile first. " +
			"SQL mode is read-only (single SELECT/WITH or a table name).",
		promptSnippet: "Profile a data file or SQL table/query (columns, types, nulls, ranges, samples)",
		promptGuidelines: [
			"Before writing code or SQL that reads a dataset, call data_peek on it instead of guessing columns, types, or units, or dumping the file.",
		],
		parameters: PARAMS,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const args = [SCRIPT];
			const src = params.source.trim().replace(/^@/, "");
			if (src.toLowerCase() === "sql") {
				args.push("--source", "sql");
				if (params.query) args.push("--query", params.query);
			} else {
				args.push("--source", isAbsolute(src) ? src : resolve(ctx.cwd, src));
			}
			args.push("--sample-rows", String(params.sample_rows ?? 5));
			if (params.columns?.length) args.push("--columns", ...params.columns);

			const python = pythonCommand();
			let result;
			try {
				result = await pi.exec(python, args, { signal, timeout: TIMEOUT_MS, cwd: ctx.cwd });
			} catch (err) {
				throw new Error(`data_peek: could not run Python (${python}). Set PI_BOOST_PYTHON. ${String(err)}`);
			}
			if (result.killed) throw new Error(`data_peek: timed out or cancelled after ${TIMEOUT_MS / 1000}s`);
			if (result.code !== 0) {
				const msg =
					tail(result.stderr || result.stdout) ||
					`Python (${python}) exited with code ${result.code} and no output: is it installed? Set PI_BOOST_PYTHON`;
				// Errors from profile.py start with "data_peek:"; anything else means Python itself failed.
				const fromScript = msg.includes("data_peek:");
				const hint = !fromScript && /not recognized|not found|No module|9009/i.test(msg) ? " (check PI_BOOST_PYTHON)" : "";
				throw new Error(msg + hint);
			}
			const text = result.stdout.replace(/\r\n/g, "\n").trimEnd(); // Windows Python emits CRLF
			return { content: [{ type: "text", text }], details: { source: src } };
		},
	});
}
