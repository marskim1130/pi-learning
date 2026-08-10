/* RPC smoke（HANDOFF.md）：启动 pi RPC 模式 + learning extension，
 * get_commands 应返回 4 个 learning 命令；stderr 不得出现 unhandledRejection。 */
import { join, resolve } from "node:path";

import { RpcClient } from "@earendil-works/pi-coding-agent";

const cliPath = resolve(
  "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"
);

const client = new RpcClient({
  cliPath,
  cwd: process.cwd(),
  args: ["-e", join(process.cwd(), "extension/index.ts")]
});

try {
  await client.start();
  const commands = await client.getCommands();
  const learning = commands
    .filter((c) => c.name.startsWith("learn"))
    .map((c) => c.name)
    .sort();
  console.log("learning commands:", JSON.stringify(learning));
  const stderr = client.getStderr();
  const crash = /unhandledRejection|Unhandled/i.test(stderr) ? stderr.slice(-500) : "";
  console.log("unhandledRejection:", crash === "" ? "none" : crash);
  if (learning.length !== 4) {
    throw new Error(`expected 4 learning commands, got ${learning.length}`);
  }
  if (crash !== "") {
    throw new Error("unhandledRejection detected in stderr");
  }
  console.log("RPC SMOKE OK");
} finally {
  await client.stop();
}
