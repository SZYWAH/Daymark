import { build, preview } from "vite";

await build();
const server = await preview({
  preview: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await new Promise((resolve) => server.httpServer.close(resolve));
  process.exit(0);
}

process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
