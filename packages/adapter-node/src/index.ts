export interface AdapterNodeOptions {
  outFile?: string
}

export function adapterNode(options: AdapterNodeOptions = {}) {
  return {
    name: '@fictjs/adapter-node',
    options,
  }
}

export default adapterNode
