// One command for local development: worker + web + Rust prober (if a Rust toolchain exists).
// The prober builds into a folder outside the repo — project folders are often cloud-synced
// (OneDrive/Dropbox) and a Rust target/ dir is hundreds of MB of churn.
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const colors = { worker: 33, web: 31, prober: 36 };
const procs = [];

function run(name, cmd, args, env = {}) {
  // one command string: passing an args array together with shell:true is deprecated (DEP0190)
  const p = spawn([cmd, ...args].join(" "), { shell: true, env: { ...process.env, ...env } });
  const tag = `\x1b[${colors[name]}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = "";
    stream.on("data", (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + "\n");
    });
  };
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on("exit", (code) => console.log(`${tag}exited (${code})`));
  procs.push(p);
}

const hasCargo = spawnSync("cargo --version", { shell: true }).status === 0;
if (hasCargo) {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), ".cache");
  run("prober", "cargo", ["run", "--release", "--manifest-path", "services/prober/Cargo.toml"], {
    CARGO_TARGET_DIR: join(base, "WipeRadar", "target"),
  });
} else {
  console.log("[prober] no Rust toolchain found — worker will query servers from Node");
}
run("worker", "npm", ["run", "dev", "-w", "@wiperadar/worker"]);
run("web", "npm", ["run", "dev", "-w", "@wiperadar/web"]);

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
