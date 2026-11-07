/*
 * Publishes the tracks from main: checks they build, commits tracks/, tags the next version and pushes.
 * The pushed v* tag makes .github/workflows/release.yml build the image.
 *
 *   npm run publish-tracks              # add -- --dry-run to stop before anything is committed
 */
import { execFileSync, execSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trimEnd();

function fail(message) {
	console.error(`publish: ${message}`);
	process.exit(1);
}

const branch = git("branch", "--show-current");
if (branch !== "main") fail(`on "${branch}": merge into main first, a release is what main holds.`);

let upstream = "";
try {
	upstream = git("rev-parse", "--abbrev-ref", "main@{upstream}");
} catch {
	fail("main has no upstream branch: push it once with git push -u.");
}
const remote = upstream.split("/")[0];
git("fetch", remote, "main");
if (git("rev-list", "--count", "HEAD..@{upstream}") !== "0") fail(`main is behind ${upstream}: pull first.`);

const changed = git("status", "--porcelain", "--", "tracks").split("\n").filter(Boolean);
const slugs = [...new Set(changed.map((line) => line.slice(3).split("/")[1]))];
if (!slugs.length && git("tag", "--points-at", "HEAD", "--list", "v*")) fail("nothing new to publish.");

const tags = git("tag", "--list", "v*", "--sort=-v:refname").split("\n");
const latest = tags.find((t) => /^v\d+(\.\d+){0,2}$/.test(t));
const [major, minor = 0, patch = 0] = latest?.slice(1).split(".").map(Number) ?? [];
// Three parts: the image build's semver tags need them, and v2.2.0 would be the same release as v2.2.
const tag = latest ? `v${major}.${minor}.${patch + 1}` : "v1.0.0";

// A broken track or stale tiles would otherwise only fail in the image build.
execSync("npm run tiles", { stdio: "inherit" });
execSync("npm run build", { stdio: "inherit" });

const message = `Publish tracks: ${slugs.join(", ")}`;
if (dryRun) {
	console.log(`\nDry run: would commit "${message}" (${changed.length} changes), tag ${tag}, push to ${remote}.`);
	process.exit(0);
}
if (slugs.length) {
	git("add", "--", "tracks");
	git("commit", "-m", message, "--", "tracks");
}
git("tag", tag);
try {
	git("push", remote, "main", tag);
} catch {
	fail(`committed and tagged ${tag}, but the push failed. Once fixed, run: git push ${remote} main ${tag}`);
}
console.log(`\nPushed ${tag}. Once the image build finishes on GitHub, pull the new image in Portainer.`);
