import { treaty } from '@elysiajs/eden'

import { app } from './users-app.js'

/**
 * The Eden client the generated hooks import.
 *
 * `treaty(app)` calls the app in memory, so nothing here binds a port or leaves a server running
 * between test files.
 */
export const client = treaty(app)
