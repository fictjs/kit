#!/usr/bin/env node

import('../dist/cli.js')
  .then(mod => mod.runCli())
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
