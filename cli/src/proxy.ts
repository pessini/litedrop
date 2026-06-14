// Bun's fetch honors HTTP(S)_PROXY natively; Node's does not. When a proxy is
// configured and we're on Node, route the global fetch through a dispatcher
// that reads the proxy env vars (HTTPS_PROXY / HTTP_PROXY / NO_PROXY). The
// import is lazy so proxy-free runs pay nothing.
export async function configureProxyFromEnv(): Promise<void> {
  if (process.versions.bun) return;
  const { env } = process;
  const proxy =
    env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy;
  if (!proxy) return;
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
