import path from 'path'
import { PluginOption } from 'vite'
import {
  DEFAULT_EXTENSIONS,
  multilineCommentsRE,
  singlelineCommentsRE
} from 'vite-plugin-utils/constant'
import { MagicString, walk } from 'vite-plugin-utils/function'

export const dynamicImportRE = /\bimport[\s\r\n]*?\(/
// this is probably less accurate
export const normallyImporteeRE = /^\.{1,2}\/[.-/\w]+(\.\w+)$/
export const viteIgnoreRE = /\/\*\s*@vite-ignore\s*\*\//
// export const bareImportRE = /^[\w@](?!.*:\/\/)/
// export const deepImportRE = /^([^@][^/]*)\/|^(@[^/]+\/[^/]+)\//

export function hasDynamicImport(code: string) {
  code = code.replace(singlelineCommentsRE, '').replace(multilineCommentsRE, '')
  return dynamicImportRE.test(code)
}

// ;(await import('hls.js')).default
// ;(await import(true ? 'hls.js' : 'hls.js/dist/hls.min.js')).default
// ;(await (true ? import('hls.js') : import('hls.js/dist/hls.min.js'))).default

// const hls = await import('hls.js')
// hls.default.xxx

export default function (): PluginOption {
  let globals = {} as Record<string, string>
  let extensions = DEFAULT_EXTENSIONS
  return {
    name: 'dynamic-imports',
    config(config) {
      // @ts-ignore
      globals = config.build?.rollupOptions?.output?.globals
      if (config.resolve?.extensions) extensions = config.resolve.extensions
    },
    async transform(code, id) {
      if (/node_modules\/(?!\.vite\/)/.test(id)) return
      if (!extensions.includes(path.extname(id))) return
      if (!hasDynamicImport(code)) return

      const ast = this.parse(code) as any
      const ms = new MagicString(code)

      await walk(ast, {
        async ImportExpression(node) {
          const importStatement = code.slice(node.start, node.end)
          const importeeRaw = code.slice(node.source.start, node.source.end)

          // skip @vite-ignore
          if (viteIgnoreRE.test(importStatement)) return

          if (node.source.type === 'Literal') {
            const importee = importeeRaw.slice(1, -1)
            // empty value
            if (!importee) return
            // normally importee
            if (normallyImporteeRE.test(importee)) return

            const id = globals[importee]
            if (!id) return

            ms.overwrite(
              node.start,
              node.end,
              `(window.${id}, window.${id}.default = window.${id}, window.${id})`
            )
          }
        },
        async MemberExpression(node) {
          if (node.object.type == 'ConditionalExpression') {
            if (node.object.consequent.type == 'ImportExpression') {
              const consequent = node.object.consequent
              const id = consequent.source.value
              ms.overwrite(consequent.start, consequent.end, `window.${globals[id]}`)
            }

            if (node.object.alternate.type == 'ImportExpression') {
              const alternate = node.object.alternate
              const id = alternate.source.value
              ms.overwrite(alternate.start, alternate.end, `window.${globals[id]}`)
            }
          }

          if (node.property.name == 'default') {
            if (node.object.type == 'AwaitExpression') {
              if (
                node.object.argument.type == 'ImportExpression' ||
                (node.object.argument.type == 'ConditionalExpression' &&
                  node.object.argument.consequent.type == 'ImportExpression' &&
                  node.object.argument.alternate.type == 'ImportExpression')
              ) {
                ms.overwrite(node.property.start - 1, node.property.end, '')
              }
            }
          }
        }
      })

      return ms.toString()
    }
  }
}

// export default function pluginDynamicImports(options = {}) {
//   return {
//     name: 'dynamic-imports',
//     transform(code, filename) {
//       // TODO: warn/error if globalName is not specified in UMD environment.
//       // TODO: global is hardcoded to window, which is wrong.
//       const transformedCode = code.replace(
//         /await import\(['"`](?![\.\/])(.*?)['"`]\)/gi,
//         (match, request) => {
//           const globalName = options.globals[request]
//           return `new Promise(function (resolve, reject) {
//           (function (global) {
//             typeof exports === 'object' && typeof module !== 'undefined' ? resolve(require("${request}")) :
//             typeof define === 'function' && define.amd ? require(["${request}"], resolve, reject) :
//             (global = global || self, resolve(global["${globalName}"]));
//           }(window));
//         })`
//         }
//       )

//       return transformedCode
//     }
//   }
// }
