// Test-only: lets plain `node` import our extensions for unit tests by stubbing
// Pi's runtime packages (Pi supplies them when it loads the real extension).
// Usage: node --import ./test/stub-pi.mjs test/<name>.test.ts
import { registerHooks } from "node:module";

const STUB = "data:text/javascript," + encodeURIComponent("export class BorderedLoader {}; export const Key = {};");
// Tool schemas are only passed to Pi, so any Type.X(...) call may return a plain object.
const TYPEBOX = "data:text/javascript," + encodeURIComponent("export const Type = new Proxy({}, { get: () => (...a) => ({ a }) });");

registerHooks({
	resolve(specifier, context, next) {
		if (/^@earendil-works\/(pi-coding-agent|pi-tui|pi-ai)$/.test(specifier)) return { url: STUB, shortCircuit: true };
		if (specifier === "typebox") return { url: TYPEBOX, shortCircuit: true };
		return next(specifier, context);
	},
});
