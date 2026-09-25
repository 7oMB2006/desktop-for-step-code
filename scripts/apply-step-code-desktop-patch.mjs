import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [upstreamDir, patchPath] = process.argv.slice(2);
if (!upstreamDir || !patchPath) {
	throw new Error("Usage: node apply-step-code-desktop-patch.mjs <step-code-dir> <patch-file>");
}

function gitBlobHash(bytes) {
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function replaceExactlyOnce(source, before, after, label) {
	const first = source.indexOf(before);
	if (first === -1 || source.indexOf(before, first + before.length) !== -1) {
		throw new Error(`Expected exactly one matching source block in ${label}`);
	}
	return source.slice(0, first) + after + source.slice(first + before.length);
}

const patchText = (await readFile(patchPath, "utf8")).replace(/\r\n/g, "\n");
if (patchText.includes("\r")) {
	throw new Error("The Step Code integration patch has unsupported line endings");
}
const patchBytes = Buffer.from(patchText, "utf8");
if (gitBlobHash(patchBytes) !== "6c4701c302b193563d63d43278584b895ce534af") {
	throw new Error("The Step Code integration patch changed; review and update this applier");
}

const codingAgentPath = path.join(upstreamDir, "packages/coding-agent/src/index.ts");
const bundleScriptPath = path.join(upstreamDir, "scripts/build-coding-agent-bundle.mjs");
const codingAgentBytes = await readFile(codingAgentPath);
const bundleScriptBytes = await readFile(bundleScriptPath);
if (gitBlobHash(codingAgentBytes) !== "5b9a78f41c0fd3a6c5556be0623ac2d7f5ffe7e5") {
	throw new Error("Unexpected pinned coding-agent source content");
}
if (gitBlobHash(bundleScriptBytes) !== "59fdc3ebc3f8d9e7a8b0d6d5fb919f0f7cd44d89") {
	throw new Error("Unexpected pinned bundle script content");
}

let codingAgent = codingAgentBytes.toString("utf8");
codingAgent = replaceExactlyOnce(
	codingAgent,
	'export { createStepProviderConfig, STEP_PROVIDER_ID } from "./features/step-provider/index.ts";',
	'export { createStepProviderConfig, STEP_PROVIDER_ID, loginStepOAuth } from "./features/step-provider/index.ts";',
	"packages/coding-agent/src/index.ts",
);
codingAgent = replaceExactlyOnce(
	codingAgent,
	"\tsyncStepLoginProfileEndpoint,\n",
	"\tsyncStepLoginProfileEndpoint,\n\twriteStepLoginCredential,\n",
	"packages/coding-agent/src/index.ts",
);

let bundleScript = bundleScriptBytes.toString("utf8");
bundleScript = replaceExactlyOnce(
	bundleScript,
	'execFileSync("npm", ["--prefix", appEntryDir, "run", "build"], { stdio: "inherit", cwd: repoRoot });',
	[
		"const npmCliPath = process.env.npm_execpath;",
		'if (!npmCliPath) {',
		'\tthrow new Error("npm_execpath is required to build the CLI entry.");',
		"}",
		'execFileSync(process.execPath, [npmCliPath, "--prefix", appEntryDir, "run", "build"], {',
		'\tstdio: "inherit",',
		"\tcwd: repoRoot,",
		"});",
	].join("\n"),
	"scripts/build-coding-agent-bundle.mjs",
);

await writeFile(codingAgentPath, codingAgent, "utf8");
await writeFile(bundleScriptPath, bundleScript, "utf8");
