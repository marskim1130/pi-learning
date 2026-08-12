import { spawn } from "node:child_process";

/**
 * Open a URL in the system browser (spec 19). Never rejects: the caller has
 * already shown the URL, so a missing opener must not break the command.
 * Uses spawn (no shell string interpolation) to avoid quoting issues.
 *
 * Headless/CI (spec 19): set PI_LEARNING_NO_BROWSER=1 to skip the opener
 * entirely. The workspace URL is still printed by /learn, so an automated or
 * remote run loses nothing.
 */
export function openWorkspace(url: string): Promise<void> {
  if (process.env.PI_LEARNING_NO_BROWSER === "1") {
    return Promise.resolve();
  }

  let command: string;
  let args: string[];
  if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/c", "start", "", url];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });
}
