/* eslint-disable @typescript-eslint/no-explicit-any */
import path from 'node:path'

import type * as Babel from '@babel/core'
import type { NodePath, PluginObj, PluginPass } from '@babel/core'
import type { Binding } from '@babel/traverse'
import type { Plugin, ViteDevServer } from 'vite'

type State = Omit<PluginPass, 'opts'> & {
  opts: { pick: string[] }
  refs: Set<NodePath>
  done: boolean
}

function treeShakeTransform({ types: t }: typeof Babel): PluginObj<State> {
  function getIdentifier(pathLike: any) {
    const parentPath = pathLike.parentPath

    if (parentPath.type === 'VariableDeclarator') {
      const name = parentPath.get('id')
      return name.node.type === 'Identifier' ? name : null
    }

    if (parentPath.type === 'AssignmentExpression') {
      const name = parentPath.get('left')
      return name.node.type === 'Identifier' ? name : null
    }

    if (pathLike.node.type === 'ArrowFunctionExpression') return null

    return pathLike.node.id && pathLike.node.id.type === 'Identifier' ? pathLike.get('id') : null
  }

  function isIdentifierReferenced(identifier: any) {
    const binding: Binding | undefined = identifier.scope.getBinding(identifier.node.name)

    if (!binding?.referenced) {
      return false
    }

    if (binding.path.type === 'FunctionDeclaration') {
      return !binding.constantViolations
        .concat(binding.referencePaths)
        .every((reference: any) => reference.findParent((parent: any) => parent === binding.path))
    }

    return true
  }

  function markFunction(pathLike: any, state: any) {
    const identifier = getIdentifier(pathLike)
    if (identifier?.node && isIdentifierReferenced(identifier)) {
      state.refs.add(identifier)
    }
  }

  function markImport(pathLike: any, state: any) {
    const local = pathLike.get('local')
    if (isIdentifierReferenced(local)) {
      state.refs.add(local)
    }
  }

  return {
    visitor: {
      Program: {
        enter(programPath, state) {
          state.refs = new Set<NodePath>()
          state.done = false

          programPath.traverse(
            {
              VariableDeclarator(variablePath, passState: any) {
                if (variablePath.node.id.type === 'Identifier') {
                  const local = variablePath.get('id')
                  if (isIdentifierReferenced(local)) {
                    passState.refs.add(local)
                  }
                  return
                }

                if (variablePath.node.id.type === 'ObjectPattern') {
                  const pattern = variablePath.get('id')
                  const properties = pattern.get('properties') as NodePath[]

                  for (const property of properties) {
                    const local = property.get(
                      property.node.type === 'ObjectProperty'
                        ? 'value'
                        : property.node.type === 'RestElement'
                          ? 'argument'
                          : (() => {
                              throw new Error('Unexpected object pattern node')
                            })(),
                    )

                    if (isIdentifierReferenced(local)) {
                      passState.refs.add(local)
                    }
                  }

                  return
                }

                if (variablePath.node.id.type === 'ArrayPattern') {
                  const pattern = variablePath.get('id')
                  const elements = pattern.get('elements') as NodePath[]

                  for (const element of elements) {
                    let local: NodePath<any> | undefined
                    if (element.node?.type === 'Identifier') {
                      local = element
                    } else if (element.node?.type === 'RestElement') {
                      local = element.get('argument')
                    }

                    if (local && isIdentifierReferenced(local)) {
                      passState.refs.add(local)
                    }
                  }
                }
              },

              ExportDefaultDeclaration(exportPath) {
                if (!state.opts.pick.includes('default')) {
                  exportPath.remove()
                }
              },

              ExportNamedDeclaration(exportPath) {
                const specifiers = exportPath.get('specifiers')
                if (specifiers.length > 0) {
                  for (const specifier of specifiers) {
                    const exported = t.isIdentifier(specifier.node.exported)
                      ? specifier.node.exported.name
                      : specifier.node.exported.value
                    if (!state.opts.pick.includes(exported)) {
                      specifier.remove()
                    }
                  }

                  if (exportPath.node.specifiers.length < 1) {
                    exportPath.remove()
                  }
                  return
                }

                const declaration = exportPath.get('declaration')
                if (!declaration.node) {
                  return
                }

                if (declaration.node.type === 'FunctionDeclaration') {
                  const name = declaration.node.id?.name
                  if (name && !state.opts.pick.includes(name)) {
                    exportPath.remove()
                  }
                  return
                }

                if (declaration.node.type === 'VariableDeclaration') {
                  const declarations = declaration.get('declarations') as NodePath<any>[]
                  for (const declarator of declarations) {
                    if (declarator.node.id.type !== 'Identifier') continue
                    if (!state.opts.pick.includes(declarator.node.id.name)) {
                      declarator.remove()
                    }
                  }

                  if (declaration.node.declarations.length < 1) {
                    exportPath.remove()
                  }
                }
              },

              FunctionDeclaration: markFunction,
              FunctionExpression: markFunction,
              ArrowFunctionExpression: markFunction,
              ImportSpecifier: markImport,
              ImportDefaultSpecifier: markImport,
              ImportNamespaceSpecifier: markImport,

              ImportDeclaration(importPath, passState: any) {
                if (importPath.node.source.value.endsWith('.css')) {
                  if (!passState.opts.pick.includes('$css')) {
                    importPath.remove()
                  }
                }
              },
            },
            state,
          )

          const refs = state.refs
          let removedCount = 0

          const sweepFunction = (sweepPath: any) => {
            const identifier = getIdentifier(sweepPath)
            if (!identifier?.node) return
            if (!refs.has(identifier)) return
            if (isIdentifierReferenced(identifier)) return

            removedCount += 1
            if (
              t.isAssignmentExpression(sweepPath.parentPath) ||
              t.isVariableDeclarator(sweepPath.parentPath)
            ) {
              sweepPath.parentPath.remove()
            } else {
              sweepPath.remove()
            }
          }

          const sweepImport = (sweepPath: any) => {
            const local = sweepPath.get('local')
            if (!refs.has(local)) return
            if (isIdentifierReferenced(local)) return

            removedCount += 1
            sweepPath.remove()
            if (sweepPath.parent.specifiers.length === 0) {
              sweepPath.parentPath.remove()
            }
          }

          do {
            programPath.scope.crawl()
            removedCount = 0
            programPath.traverse({
              VariableDeclarator(variablePath) {
                if (variablePath.node.id.type !== 'Identifier') return
                const local = variablePath.get('id')
                if (refs.has(local as NodePath) && !isIdentifierReferenced(local)) {
                  removedCount += 1
                  variablePath.remove()
                }
              },
              FunctionDeclaration: sweepFunction,
              FunctionExpression: sweepFunction,
              ArrowFunctionExpression: sweepFunction,
              ImportSpecifier: sweepImport,
              ImportDefaultSpecifier: sweepImport,
              ImportNamespaceSpecifier: sweepImport,
            })
          } while (removedCount)
        },
      },
    },
  }
}

export function kitTreeShake(): Plugin {
  const cache = new Map<string, Map<string, string>>()
  let devServer: ViteDevServer | undefined

  async function transformPickVariant(id: string, code: string) {
    const [, queryString = ''] = id.split('?')
    const query = new URLSearchParams(queryString)
    if (!query.has('pick')) {
      return null
    }

    const babel = await import('@babel/core')
    return babel.transformAsync(code, {
      plugins: [[treeShakeTransform, { pick: query.getAll('pick') }]],
      parserOpts: {
        plugins: ['jsx', 'typescript'],
      },
      filename: path.basename(id),
      sourceMaps: true,
      ast: false,
      configFile: false,
      babelrc: false,
      sourceFileName: id,
    })
  }

  return {
    name: 'fict-kit:tree-shake',
    enforce: 'pre',
    configureServer(server) {
      devServer = server
    },
    async handleHotUpdate(context) {
      const fileCache = cache.get(context.file)
      if (!fileCache || fileCache.size === 0 || !devServer) {
        return
      }

      const modules = []
      const nextCode = await context.read()

      for (const [variantId, previousCode] of fileCache.entries()) {
        const transformed = await transformPickVariant(variantId, nextCode)
        if (!transformed?.code) continue

        if (transformed.code !== previousCode) {
          const mod = devServer.moduleGraph.getModuleById(variantId)
          if (mod) modules.push(mod)
        }

        fileCache.set(variantId, transformed.code)
      }

      return modules
    },
    async transform(code, id) {
      const [filePath, queryString = ''] = id.split('?')
      if (!filePath) return

      const query = new URLSearchParams(queryString)
      if (!query.has('pick')) return

      const ext = path.extname(filePath)
      if (!['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
        return
      }

      const transformed = await transformPickVariant(id, code)
      if (!transformed?.code) return

      const fileCache = cache.get(filePath) ?? new Map<string, string>()
      fileCache.set(id, transformed.code)
      cache.set(filePath, fileCache)

      return {
        code: transformed.code,
        map: transformed.map,
      }
    },
  }
}
