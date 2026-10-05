import { app } from './users-app.js'

/**
 * The host app behind a real socket, for the generated client to be measured over HTTP.
 *
 * A program of its own rather than `app.listen()` inside a test: the suite runs under happy-dom,
 * whose `Response` is the browser's, and a `Bun.serve` handler in that process would answer with
 * one Bun does not accept. The port is ephemeral and printed, one line, for the parent to read.
 */
app.listen(0)
process.stdout.write(`port ${String(app.server?.port)}\n`)
