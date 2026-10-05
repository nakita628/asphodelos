import { GlobalRegistrator } from '@happy-dom/global-registrator'

/**
 * `bun test` has no DOM, and the SWR hooks are React hooks: rendering one needs a document.
 *
 * Preloaded (see bunfig.toml) so it is in place before any test module is evaluated — a hook
 * imported at module scope would otherwise see a `window` that does not exist yet.
 */

type Descriptors = Record<string | symbol, PropertyDescriptor | undefined>

function ownDescriptors(target: object): Descriptors {
  return Object.fromEntries(
    Reflect.ownKeys(target).map((key) => [key, Object.getOwnPropertyDescriptor(target, key)]),
  )
}

/** Defines each global named in `descriptors`, or removes it where the descriptor is absent. */
function defineGlobals(descriptors: Descriptors) {
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key]
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
}

const runtimeGlobals = ownDescriptors(globalThis)
GlobalRegistrator.register()
const browserGlobals = ownDescriptors(globalThis)

// The globals happy-dom added or replaced, with what the runtime had there before (nothing, for
// most of them).
const touched = Reflect.ownKeys(browserGlobals).filter((key) => {
  const before = runtimeGlobals[key]
  const after = browserGlobals[key]
  return before === undefined || before.value !== after?.value || before.get !== after?.get
})
const asBrowser: Descriptors = Object.fromEntries(touched.map((key) => [key, browserGlobals[key]]))
const asRuntime: Descriptors = Object.fromEntries(touched.map((key) => [key, runtimeGlobals[key]]))

/**
 * Puts the runtime's own globals back for a test that drives a Node program — the Vite dev server
 * calls `.unref()` on what `setTimeout` returns, and the OpenAPI parser wants Node's `URL`.
 *
 * The window stays open. `GlobalRegistrator.unregister()` would close it, and React DOM keeps the
 * `queueMicrotask` of the window it was loaded under, so after a close every React hooks file run
 * later in the process would stop re-rendering outside `act`.
 */
export function suspendHappyDom() {
  defineGlobals(asRuntime)
}

/** Restores the browser globals after `suspendHappyDom`. */
export function resumeHappyDom() {
  defineGlobals(asBrowser)
}
