export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Bundled (not path.join dynamic-import) so the module is traced into the
    // standalone Docker build — the custom-server.js import silently fails there.
    const { startBackgroundComboHealthPoll } = await import("@/lib/backgroundComboHealthPoll");
    startBackgroundComboHealthPoll();
  }
}
