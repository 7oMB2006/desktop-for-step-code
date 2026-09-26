import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const [upstreamDir, patchPath] = process.argv.slice(2);
if (!upstreamDir || !patchPath) {
	throw new Error("Usage: node apply-step-code-desktop-patch.mjs <step-code-dir> <patch-file>");
}
const resolvedPatchPath = path.resolve(patchPath);

function gitBlobHash(bytes) {
	return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

const patchText = (await readFile(resolvedPatchPath, "utf8")).replace(/\r\n/g, "\n");
if (patchText.includes("\r")) {
	throw new Error("The Step Code integration patch has unsupported line endings");
}
const patchBytes = Buffer.from(patchText, "utf8");
if (gitBlobHash(patchBytes) !== "94b89dd17a0c70b46233e0fd6a806f592b967b74") {
	throw new Error("The Step Code integration patch changed; review and update this applier");
}

const codingAgentPath = path.join(upstreamDir, "packages/coding-agent/src/index.ts");
const authStoragePath = path.join(upstreamDir, "packages/coding-agent/src/core/auth-storage.ts");
const bundleScriptPath = path.join(upstreamDir, "scripts/build-coding-agent-bundle.mjs");
const authStorageBytes = await readFile(authStoragePath);
const codingAgentBytes = await readFile(codingAgentPath);
const bundleScriptBytes = await readFile(bundleScriptPath);
if (gitBlobHash(authStorageBytes) !== "b7d72e885b80c53e17920a405ec7ce9612a3e2e7") {
	throw new Error("Unexpected pinned auth storage source content");
}
if (gitBlobHash(codingAgentBytes) !== "5b9a78f41c0fd3a6c5556be0623ac2d7f5ffe7e5") {
	throw new Error("Unexpected pinned coding-agent source content");
}
if (gitBlobHash(bundleScriptBytes) !== "59fdc3ebc3f8d9e7a8b0d6d5fb919f0f7cd44d89") {
	throw new Error("Unexpected pinned bundle script content");
}

execFileSync("git", ["-C", upstreamDir, "apply", "--check", resolvedPatchPath], { stdio: "inherit" });
execFileSync("git", ["-C", upstreamDir, "apply", resolvedPatchPath], { stdio: "inherit" });
