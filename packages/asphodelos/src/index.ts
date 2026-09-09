#!/usr/bin/env node
import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'
import { Console, Effect } from 'effect'

import { asphodelos } from './cli/index.js'

NodeRuntime.runMain(
  asphodelos(process.argv.slice(2)).pipe(
    Effect.tap((log) => Console.log(log)),
    Effect.provide(NodeServices.layer),
  ),
)
