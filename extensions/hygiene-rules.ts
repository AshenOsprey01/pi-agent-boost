import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Pi packages cannot ship an AGENTS.md, so the rules reach the model through the system prompt.
export const RULES = `## Project hygiene
- Code explains itself. Comment only: WHY a non-obvious choice was made, business/domain rules and units (e.g. FX quote conventions), and warnings. Public functions get at most a one-line docstring (what + units). No comments that restate code, no file headers, no TODO comments, no commented-out code.
- The only lasting md file in a project is AGENTS.md: max 200 lines / 16,000 characters, sections (only if real content): what it is, how to run/check, project-wide facts, key decisions (one line of why each), gotchas. Never file trees or anything the code already shows. Do not create other md files (README, DECISIONS, CHANGELOG, notes...) unless the user asks.
- PLAN.md and TODO.md are temporary: create them only for multi-step tasks and delete them when the task is done.
- Where a fact goes: local to one place in code -> WHY comment next to it; project-wide -> AGENTS.md; stale or finished -> delete. Never duplicate a fact.
- Remove dead code you replace. Do not leave old versions around.
- Git: before your first edit in a repo on main/master, create a short task branch (e.g. \`git switch -c fix-usdjpy-chart\`). Commit in small steps. When the user says OK, merge into main locally and push.`;

export function withRules(systemPrompt: string): string {
	// Guard against double-appending if Pi ever hands back an already-extended prompt.
	if (systemPrompt.includes(RULES)) return systemPrompt;
	return `${systemPrompt}\n\n${RULES}`;
}

export default function hygieneRules(pi: ExtensionAPI) {
	if ((process.env.PI_BOOST_RULES ?? "").toLowerCase() === "off") return;
	// Returning systemPrompt (not mutating systemPromptOptions) is the one form 0.84 and 0.87 both honour.
	pi.on("before_agent_start", (event) => ({ systemPrompt: withRules(event.systemPrompt) }));
}
