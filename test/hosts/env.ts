/**
 * An environment a module exports, for the client case that takes its address from one.
 *
 * What a project would validate at startup is read here as it is: the runtime tests serve the app
 * in memory, where the address is never used.
 */
export const env = {
  API_URL: process.env.ASPHODELOS_TEST_API_URL ?? 'http://localhost',
}
