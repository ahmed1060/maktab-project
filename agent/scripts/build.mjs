// Builds the agent.
//
//   node scripts/build.mjs          dist/nizmo-agent.cjs: one file, runs with `node`
//   node scripts/build.mjs --exe    dist/nizmo-agent.exe as well: a single executable
//                                   with Node inside (Node's own "single executable
//                                   applications"), built on Windows by the Agent
//                                   workflow. Nothing else to install on the office PC.
//
// Signing is a separate step (the workflow's), with the company's code-signing
// certificate when one is configured.
import { build } from "esbuild"
import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
mkdirSync(dist, { recursive: true })

const bundle = join(dist, "nizmo-agent.cjs")
await build({
    entryPoints: [join(root, "src", "main.ts")],
    bundle: true,
    platform: "node",
    target: "node22",
    format: "cjs",
    outfile: bundle,
    legalComments: "none",
})
console.log(`built ${bundle}`)

if (process.argv.includes("--exe")) {
    const exe = join(dist, process.platform === "win32" ? "nizmo-agent.exe" : "nizmo-agent")
    const blob = join(dist, "sea-prep.blob")
    const seaConfig = join(dist, "sea-config.json")
    writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }))
    execFileSync(process.execPath, ["--experimental-sea-config", seaConfig], { stdio: "inherit" })
    copyFileSync(process.execPath, exe)
    const postject = join(root, "node_modules", "postject", "dist", "cli.js")
    const args = [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]
    if (process.platform === "darwin") args.push("--macho-segment-name", "NODE_SEA")
    execFileSync(process.execPath, args, { stdio: "inherit" })
    console.log(`built ${exe} (${Math.round(readFileSync(exe).length / 1e6)} MB)`)
}
