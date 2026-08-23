import { registerHooks } from "node:module";

const cloudflareWorkersShim = `
  export const env = new Proxy({}, {
    get(_target, property) {
      return globalThis.__HACKMUSIC_TEST_BINDINGS__?.[property];
    },
  });
`;

const cloudflareWorkersUrl = `data:text/javascript;base64,${Buffer.from(cloudflareWorkersShim).toString("base64")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return { url: cloudflareWorkersUrl, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
