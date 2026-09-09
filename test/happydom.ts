import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * `bun test` has no DOM, and the SWR hooks are React hooks: rendering one needs a document.
 *
 * Preloaded (see bunfig.toml) so it is in place before any test module is evaluated — a hook
 * imported at module scope would otherwise see a `window` that does not exist yet.
 */
GlobalRegistrator.register()
