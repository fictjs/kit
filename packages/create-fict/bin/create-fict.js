#!/usr/bin/env node

import('../dist/index.js')
  .then(mod => mod.runCreateFict())
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
