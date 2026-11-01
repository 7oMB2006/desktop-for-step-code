import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [upstreamDir, patchPath] = process.argv.slice(2);
if (!upstreamDir || !patchPath) {
	throw new Error("Usage: node apply-step-code-desktop-patch.mjs <step-code-dir> <patch-file>");
}
const resolvedPatchPath = path.resolve(patchPath);
const integrationPatches = ["v015", "v016"].map(version =>
	path.resolve(import.meta.dirname, `../patches/${version}/step-code-desktop.patch`));

function gitBlobHash(bytes) {
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

// Preserve historical replay while checking the selected baseline and platform additions.
if (integrationPatches.includes(resolvedPatchPath)) {
	const directory = path.dirname(resolvedPatchPath);
	const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
	const commit = execFileSync("git", ["-C", upstreamDir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
	if (commit !== manifest.commit) throw new Error("Unexpected Step Code baseline");
	const collect = async (entries, label, sink) => {
		for (const [name, expected] of Object.entries(entries)) {
			const bytes = Buffer.from((await readFile(path.join(directory, name), "utf8")).replace(/\r\n/g, "\n"));
			if (gitBlobHash(bytes) !== expected) throw new Error(`Unexpected ${label}: ${name}`);
			sink.push({ name, bytes });
		}
	};
	// Upstream commits ride on top of the pinned checkout as uncommitted worktree
	// edits, so HEAD and manifest.commit stay the reviewable pin while sources
	// below already describe the combined state the desktop patches expect.
	const upstreamEntries = Object.fromEntries((manifest.upstream?.commits ?? [])
		.map(entry => [entry.patch, entry.hash]));
	const upstreamPatches = [];
	await collect(upstreamEntries, "upstream commit patch", upstreamPatches);
	const patches = [];
	await collect(manifest.patches, "integration patch", patches);
	await collect(manifest.platforms?.[process.platform]?.patches ?? {}, `${process.platform} integration patch`, patches);
	// Everything below mutates the worktree, so any failure unwinds every applied
	// patch in reverse and leaves the checkout exactly as it was found.
	const applied = [];
	const undo = () => {
		for (const entry of [...applied].reverse()) {
			execFileSync("git", ["-C", upstreamDir, "apply", "-R", "-"], { input: entry.bytes, stdio: ["pipe", "pipe", "pipe"] });
		}
	};
	try {
		for (const entry of upstreamPatches) {
			execFileSync("git", ["-C", upstreamDir, "apply", "--check", "-"], { input: entry.bytes, stdio: ["pipe", "pipe", "pipe"] });
			execFileSync("git", ["-C", upstreamDir, "apply", "-"], { input: entry.bytes, stdio: ["pipe", "pipe", "pipe"] });
			applied.push(entry);
		}
		for (const [relative, expected] of Object.entries(manifest.sources)) {
			const hash = execFileSync("git", ["-C", upstreamDir, "hash-object", relative], { encoding: "utf8" }).trim();
			if (hash !== expected) throw new Error(`Unexpected pinned source: ${relative}`);
		}
		// Validate every patch before touching source, including platform additions.
		// The manifest key order is the apply order, and later patches edit lines that
		// earlier ones add, so a single combined check is what keeps that sequence
		// honest. Its error only names a file and line, though, so when it fails, walk
		// the prefixes to report the patch that actually broke.
		const combined = Buffer.concat(patches.map((entry) => entry.bytes));
		const check = (input) => execFileSync("git", ["-C", upstreamDir, "apply", "--check", "-"], {
			input, stdio: ["pipe", "pipe", "pipe"],
		});
		try {
			check(combined);
		} catch {
			let prefix = 0;
			for (let end = 1; end < patches.length; end += 1) {
				try {
					check(Buffer.concat(patches.slice(0, end).map((entry) => entry.bytes)));
					prefix = end;
				} catch {
					break;
				}
			}
			throw new Error(`Integration patch does not apply: ${patches[prefix].name}`);
		}
		execFileSync("git", ["-C", upstreamDir, "apply", "-"], { input: combined, stdio: ["pipe", "inherit", "inherit"] });
		applied.push({ name: "combined integration patch", bytes: combined });
		const platform = manifest.platforms?.[process.platform];
		for (const [relative, expected] of Object.entries({ ...manifest.patchedSources, ...platform?.patchedSources })) {
			const hash = execFileSync("git", ["-C", upstreamDir, "hash-object", relative], { encoding: "utf8" }).trim();
			if (hash !== expected) throw new Error(`Unexpected patched source: ${relative}`);
		}
	} catch (error) {
		undo();
		throw error;
	}

} else {
const patchText = (await readFile(resolvedPatchPath, "utf8")).replace(/\r\n/g, "\n");
if (patchText.includes("\r")) {
	throw new Error("The Step Code integration patch has unsupported line endings");
}
const patchBytes = Buffer.from(patchText, "utf8");
if (gitBlobHash(patchBytes) !== "4cadbad2b07f273a64a4039165d376e03c5e54f6") {
	throw new Error("The Step Code integration patch changed; review and update this applier");
}

const codingAgentPath = path.join(upstreamDir, "packages/coding-agent/src/index.ts");
const authStoragePath = path.join(upstreamDir, "packages/coding-agent/src/core/auth-storage.ts");
const bundleScriptPath = path.join(upstreamDir, "scripts/build-coding-agent-bundle.mjs");
const subagentRpcAdapterPath = path.join(upstreamDir, "packages/coding-agent/src/features/subagent/rpc-adapter.ts");
const authStorageBytes = await readFile(authStoragePath);
const codingAgentBytes = await readFile(codingAgentPath);
const bundleScriptBytes = await readFile(bundleScriptPath);
if (gitBlobHash(authStorageBytes) !== "b7d72e885b80c53e17920a405ec7ce9612a3e2e7") {
	throw new Error("Unexpected pinned auth storage source content");
}
if (gitBlobHash(codingAgentBytes) !== "b41b022648dcb1ce31e30c0ba333136062f28d96") {
	throw new Error("Unexpected pinned coding-agent source content");
}
if (gitBlobHash(bundleScriptBytes) !== "59fdc3ebc3f8d9e7a8b0d6d5fb919f0f7cd44d89") {
	throw new Error("Unexpected pinned bundle script content");
}
const subagentRpcAdapterBytes = await readFile(subagentRpcAdapterPath);
if (gitBlobHash(subagentRpcAdapterBytes) !== "9010d79a8f74ad026f805e2706b29a774ba5818d") {
	throw new Error("Unexpected pinned subagent rpc adapter source content");
}

const applyOptions = { input: patchBytes, stdio: ["pipe", "inherit", "inherit"] };
for (const [relative, expected] of [
	["packages/coding-agent/src/modes/rpc/rpc-mode.ts", "fd9aabca7465b6b104dcdd3f83f13ff2bd6b8ec9"],
	["packages/coding-agent/src/modes/rpc/rpc-types.ts", "1565bd4ab5bea1d427fb11a4a7218187d8a91db7"],
	["packages/coding-agent/src/step/mcp.ts", "055d0d3e91cd1a82214a711f7db9cecb3c3e5277"],
]) {
	if (gitBlobHash(await readFile(path.join(upstreamDir, relative))) !== expected) {
		throw new Error(`Unexpected pinned source content: ${relative}`);
	}
}
const planPatch = Buffer.from((await readFile(path.join(path.dirname(resolvedPatchPath), "step-code-desktop-plan.patch"), "utf8")).replace(/\r\n/g, "\n"));
if (gitBlobHash(planPatch) !== "2dcb49e6e9f0082c57d9a4ceae05a49ce6c6e763") throw new Error("Unexpected Desktop Plan integration patch");
for (const [relative, hash] of [
	["packages/coding-agent/src/features/step-plan.ts", "cf56888872efcd6e00999a2cbf7681959d0fc4a0"],
	["packages/coding-agent/src/features/plan-mode-tools.ts", "54c7da072038c16567f4a58efb13063208b14c32"],
]) if (gitBlobHash(await readFile(path.join(upstreamDir, relative))) !== hash) throw new Error(`Unexpected Plan source: ${relative}`);
const clarificationPatch = Buffer.from((await readFile(path.join(path.dirname(resolvedPatchPath), "step-code-desktop-clarification.patch"), "utf8")).replace(/\r\n/g, "\n"));
if (gitBlobHash(clarificationPatch) !== "7e876da1dc885e18cae0923102d4189ccc444e80") throw new Error("Unexpected Beta Desktop clarification patch");
if (gitBlobHash(await readFile(path.join(upstreamDir, "packages/coding-agent/src/features/step-questionnaire.ts"))) !== "7301fc9a497581e9e4a88f880c4da12cdc74f8e0")
	throw new Error("Unexpected pinned clarification source");
const combined = Buffer.concat([patchBytes, planPatch, clarificationPatch]);
const cronPatch = Buffer.from((await readFile(path.join(path.dirname(resolvedPatchPath), "step-code-desktop-cron.patch"), "utf8")).replace(/\r\n/g, "\n"));
if (gitBlobHash(cronPatch) !== "647de75f3a7ef7d4e5b5bdc4ffe8b73955609fff") throw new Error("Unexpected Desktop Cron observer patch");
if (gitBlobHash(await readFile(path.join(upstreamDir, "packages/coding-agent/src/features/step-cron.ts"))) !== "6f881338a5d4ac34a416706a1e72b1f6e181cff3")
	throw new Error("Unexpected pinned Cron source");
const cronManagementPatch = Buffer.from((await readFile(path.join(path.dirname(resolvedPatchPath), "step-code-desktop-cron-management.patch"), "utf8")).replace(/\r\n/g, "\n"));
if (gitBlobHash(cronManagementPatch) !== "1f228c5b065b2376170e3bca6ea9c8943e5f5dbc") throw new Error("Unexpected Desktop Cron management patch");
const pluginsPatch = Buffer.from((await readFile(path.join(path.dirname(resolvedPatchPath), "step-code-desktop-plugins.patch"), "utf8")).replace(/\r\n/g, "\n"));
if (gitBlobHash(pluginsPatch) !== "b0642b17db291a9d1d3f110d4b16c55350c18ca3") throw new Error("Unexpected Desktop plugin management exports patch");
const allPatches = Buffer.concat([combined, cronPatch, cronManagementPatch, pluginsPatch]);
execFileSync("git", ["-C", upstreamDir, "apply", "--check", "-"], { ...applyOptions, input: allPatches });
execFileSync("git", ["-C", upstreamDir, "apply", "-"], { ...applyOptions, input: allPatches });
}
