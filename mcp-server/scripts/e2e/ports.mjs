/**
 * Picks free TCP ports for the harness's throwaway backend + reverse-proxy
 * (plan's "local backend" for T9's e2e) so repeated/parallel runs never
 * collide on a hardcoded port.
 */
import net from "node:net";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** Returns `{ backendPort, proxyPort }`, two distinct free ports. */
export async function getFreePorts() {
  const backendPort = await getFreePort();
  let proxyPort = await getFreePort();
  while (proxyPort === backendPort) {
    proxyPort = await getFreePort();
  }
  return { backendPort, proxyPort };
}
