/**
 * Browser client bundle for dsh-legal-suite.
 *
 * The suite mounts two UI renderer layers, both vendored inside this repo
 * under vendor/ (self-contained snapshots, not published):
 *   vendor/panel-ui/  业务面板渲染层（诉讼 / 非诉 / 任务 / 皮肤）
 *   vendor/sidebar-ui/ 工作区右边栏渲染层
 * The dual-renderer alias routes `@/...` by importer ownership so both layers
 * build into ONE self-contained client.js (single entry, one version).
 */
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, extname, join, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

const nodeRequire = createRequire(import.meta.url)
const configDir = fileURLToPath(new URL('.', import.meta.url))
const id = 'dsh-legal-suite'

/** Package version baked into the client bundle (settings page version display). */
const packageVersion = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version

/** 工作区右边栏域的 client 目录与两套 vendored 渲染层根。 */
const WS_SIDEBAR_CLIENT = resolvePath(configDir, 'src/domains/workspace-sidebar/client')
const APP_RENDERER = resolvePath(configDir, 'vendor/sidebar-ui/renderer')
const LEGACY_RENDERER = resolvePath(configDir, 'vendor/panel-ui/renderer')

/**
 * Externals resolved from the loader module table at runtime. Only the
 * platform seed entries this bundle actually requires; everything else
 * inlines.
 */
const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-runtime/client',
]

/** Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/* ───────────────── 工作区右边栏（vendored sidebar-ui）构建支持 ───────────────── */

/**
 * 双渲染层 `@/` 解析：importer 位于 vendored sidebar-ui 或 workspace-sidebar
 * 域 → 路由到 vendor/sidebar-ui；其余（业务域）→ vendor/panel-ui。另把
 * sidebar 构建中的关键模块覆盖（DSH 对接版）指到域内实现。
 */
const WS_OVERRIDES: Record<string, string> = {
  '@/hooks/useWorkspaceFileService': resolvePath(WS_SIDEBAR_CLIENT, 'dsh-file-service.ts'),
  '@/hooks/useWorkspaceChangeSignal': resolvePath(WS_SIDEBAR_CLIENT, 'stubs.ts'),
  '@/context/TabContext': resolvePath(WS_SIDEBAR_CLIENT, 'stubs.ts'),
  '@/context/ImagePreviewContext': resolvePath(WS_SIDEBAR_CLIENT, 'ImagePreviewContext.tsx'),
  '@/api/searchClient': resolvePath(WS_SIDEBAR_CLIENT, 'dsh-search-client.ts'),
  '@/components/AgentCapabilitiesPanel': resolvePath(WS_SIDEBAR_CLIENT, 'AgentCapabilitiesPanel.tsx'),
}

const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const RESOLVE_INDEXES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx']

/** 自定义 resolveId 返回的是最终模块 id，必须解析到真实文件（扩展名/index），
 *  否则 rolldown 直接按原路径加载（目录/无扩展名会报错）。 */
function resolveToFile(base: string): string | null {
  if (existsSync(base) && !statSync(base).isDirectory()) return base
  for (const ext of RESOLVE_EXTS) {
    const candidate = base + ext
    if (existsSync(candidate) && !statSync(candidate).isDirectory()) return candidate
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const entry of RESOLVE_INDEXES) {
      const candidate = join(base, entry)
      if (existsSync(candidate) && !statSync(candidate).isDirectory()) return candidate
    }
  }
  return null
}

function dualRendererAliasPlugin() {
  return {
    name: 'agentlex-dual-renderer-alias',
    resolveId(source: string, importer: string | undefined) {
      // Monaco `./MonacoEditor` 覆盖（仅 vendored app renderer 内的相对导入）。
      if (source === './MonacoEditor' && importer?.includes('/vendor/sidebar-ui/renderer/')) {
        return resolveToFile(resolvePath(WS_SIDEBAR_CLIENT, 'MonacoEditor.tsx'))
      }
      const override = WS_OVERRIDES[source]
      if (override !== undefined) return resolveToFile(override)
      if (!source.startsWith('@/')) return null
      const imp = importer ?? ''
      const appSide = imp.includes('/vendor/sidebar-ui/renderer/') || imp.includes('/domains/workspace-sidebar/')
      return resolveToFile(resolvePath(appSide ? APP_RENDERER : LEGACY_RENDERER, source.slice(2)))
    },
  }
}

/* ---------- vendored renderer 依赖的资源内联（svg/png/?inline/?url/css） ---------- */

const ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp'])
const ASSET_MIME = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
} as const

const ASSET_PREFIX = '\0agentlex-asset:'
const NODE_SHIM_PREFIX = '\0agentlex-node:'

function resolveAsset(id: string, importer: string | undefined): string {
  if (id.startsWith('.') || id.startsWith('/')) {
    return resolvePath(dirname(importer ?? process.cwd()), id)
  }
  try {
    return nodeRequire.resolve(id)
  } catch {
    return resolvePath(dirname(importer ?? process.cwd()), id)
  }
}

function assetPlugin() {
  return {
    name: 'agentlex-asset-inline',
    resolveId(source: string, importer: string | undefined) {
      if (source.startsWith(ASSET_PREFIX)) return source
      if (!importer) return null
      const inline = source.endsWith('?inline') ? 'inline' : null
      const url = source.endsWith('?url') ? 'url' : null
      if (inline !== null || url !== null) {
        const bare = source.slice(0, source.length - (inline !== null ? '?inline'.length : '?url'.length))
        const abs = resolveAsset(bare, importer)
        return `${ASSET_PREFIX}${inline !== null ? 'inline' : 'url'}:${abs}.js`
      }
      const ext = extname(source).toLowerCase()
      if (ext === '.css') {
        // Side-effect CSS（Markdown.css / katex / pdfTextLayer…）：样式已由
        // generated-workspace-css 注入，这里以空模块保持可构建。
        const abs = resolveAsset(source, importer)
        return `${ASSET_PREFIX}css:${abs}.js`
      }
      if (!ASSET_EXTENSIONS.has(ext)) return null
      const abs = resolveAsset(source, importer)
      return `${ASSET_PREFIX}img:${abs}.js`
    },
    load(this: { addWatchFile(file: string): void }, moduleId: string) {
      if (!moduleId.startsWith(ASSET_PREFIX)) return null
      const body = moduleId.slice(ASSET_PREFIX.length)
      const sep = body.indexOf(':')
      const kind = sep === -1 ? 'img' : body.slice(0, sep)
      const file = (sep === -1 ? body : body.slice(sep + 1)).replace(/\.js$/, '')
      this.addWatchFile(file)
      if (kind === 'css') return 'export {}'
      if (kind === 'inline') {
        const content = readFileSync(file, 'utf8')
        return `export default ${JSON.stringify(content)}`
      }
      const ext = extname(file).toLowerCase() as keyof typeof ASSET_MIME
      const mime = ext === '.mjs' ? 'text/javascript' : (ASSET_MIME[ext] ?? 'application/octet-stream')
      const data = readFileSync(file).toString('base64')
      return `export default "data:${mime};base64,${data}"`
    },
  }
}

/* ---------------- Node 内置垫片（打包的 markdown/unified 链需要） ---------------- */

const NODE_SHIM_CONTENTS: Record<string, string> = {
  path: `(() => {
    const join = (...parts) => parts.filter(Boolean).join('/').replace(/\\/+/g, '/')
    const dirname = (p) => { const i = p.lastIndexOf('/'); return i <= 0 ? '.' : p.slice(0, i) }
    const basename = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1) }
    const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i <= 0 ? '' : b.slice(i) }
    const resolve = (...parts) => join(...parts)
    const normalize = (p) => { const out = []; for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg !== '.' && seg !== '') out.push(seg) } return (p.startsWith('/') ? '/' : '') + out.join('/') }
    const relative = (from, to) => to
    const isAbsolute = (p) => p.startsWith('/')
    const parse = (p) => ({ root: isAbsolute(p) ? '/' : '', dir: dirname(p), base: basename(p), ext: extname(p), name: basename(p).slice(0, basename(p).length - extname(p).length) })
    const format = (o) => (o.dir ? o.dir + '/' + o.base : o.base)
    const api = { join, dirname, basename, extname, resolve, normalize, relative, isAbsolute, parse, format, sep: '/', delimiter: ':' }
    api.posix = api; api.win32 = api
    return api
  })()`,
  process: `(() => ({ env: {}, platform: 'browser', browser: true, cwd: () => '/', nextTick: (f, ...a) => setTimeout(() => f(...a), 0), version: '', versions: {} }))()`,
  url: `(() => { const fileURLToPath = (u) => { const url = typeof u === 'string' ? new URL(u) : u; const pathname = url.protocol === 'file:' ? decodeURIComponent(url.pathname) : String(u); return pathname.replace(/^\\/([A-Za-z]:)/, '$1') }; const pathToFileURL = (p) => new URL('file://' + p); return { URL, URLSearchParams, fileURLToPath, pathToFileURL, parse: (u) => new URL(u) } })()`,
  util: `(() => ({ inherits: () => {}, promisify: (fn) => fn, inspect: (x) => String(x), isDeepStrictEqual: (a, b) => a === b, format: (...a) => a.map(String).join(' '), types: {} }))()`,
  events: `(() => { class EventEmitter { constructor(){ this.listeners = new Map() } on(event, cb){ const set = this.listeners.get(event) || []; set.push(cb); this.listeners.set(event, set); return this } emit(event, ...a){ (this.listeners.get(event) || []).forEach((cb) => cb(...a)); return true } off(event, cb){ this.listeners.set(event, (this.listeners.get(event) || []).filter((x) => x !== cb)); return this } once(event, cb){ return this.on(event, cb) } removeListener(event, cb){ return this.off(event, cb) } removeAllListeners(){ this.listeners.clear(); return this } } return { EventEmitter, once: (em, ev) => new Promise((res) => em.once(ev, res)) } })()`,
  os: `(() => ({ homedir: () => '/', tmpdir: () => '/tmp', platform: 'browser', EOL: '\\n', userInfo: () => ({ username: 'user', uid: 0, gid: 0, shell: '/', homedir: '/' }) }))()`,
  buffer: `(() => { class Buffer { static from(input){ const b = new Buffer(); b.data = String(input); return b } static isBuffer(){ return false } static alloc(){ return new Buffer() } constructor(){ this.data = '' } toString(){ return this.data } toJSON(){ return { type: 'Buffer', data: [] } } } return { Buffer } })()`,
  stream: `(() => { class Readable { pipe(){ return this } on(){ return this } } class Writable { on(){ return this } write(){ return true } end(){} } class Duplex extends Readable {} return { Readable, Writable, Duplex, Stream: Readable } })()`,
  fs: `(() => { const noop = async () => {}; return { readFile: noop, writeFile: noop, stat: async () => ({ isFile: () => false, isDirectory: () => false }), readdir: async () => [], promises: {} } })()`,
  crypto: `(() => { const g = globalThis; const noopDigest = () => ({ update: () => ({ digest: () => '' }), digest: () => '' }); return { getRandomValues: (a) => (g.crypto && g.crypto.getRandomValues(a)) || a, randomUUID: () => (g.crypto && g.crypto.randomUUID()) || String(Date.now()), createHash: () => noopDigest(), createHmac: () => noopDigest(), createCipheriv: () => ({ update: (d) => d, final: () => '' }), createDecipheriv: () => ({ update: (d) => d, final: () => '' }), randomBytes: (n) => new Uint8Array(n), timingSafeEqual: () => false } })()`,
  async_hooks: `(() => { class AsyncLocalStorage { constructor(){ this._store = undefined } run(store, cb, ...a){ const prev = this._store; this._store = store; try { return cb(...a) } finally { this._store = prev } } getStore(){ return this._store } enterWith(store){ this._store = store } disable(){ this._store = undefined } } class AsyncResource { constructor(type, opts){ this.asyncId = 0; this.triggerAsyncId = 0; this.type = type || 'AsyncResource' } runInAsyncScope(cb, ...a){ return cb(...a) } emitDestroy(){ return this } } const noopHook = () => ({ enable(){}, disable(){} }); return { createHook: () => noopHook(), executionAsyncId: () => 0, triggerAsyncId: () => 0, executionAsyncResource: () => undefined, AsyncLocalStorage, AsyncResource } })()`,
}

const NODE_SHIM_NAMED: Record<string, string[]> = {
  path: ['join', 'dirname', 'basename', 'extname', 'resolve', 'normalize', 'relative', 'isAbsolute', 'parse', 'format', 'sep', 'delimiter', 'posix', 'win32'],
  url: ['URL', 'URLSearchParams', 'fileURLToPath', 'pathToFileURL', 'parse'],
  util: ['inherits', 'promisify', 'inspect', 'format', 'types'],
  events: ['EventEmitter', 'once'],
  os: ['homedir', 'tmpdir', 'platform', 'EOL', 'userInfo'],
  buffer: ['Buffer'],
  stream: ['Readable', 'Writable', 'Duplex', 'Stream'],
  crypto: ['getRandomValues', 'randomUUID', 'createHash', 'createHmac', 'createCipheriv', 'createDecipheriv', 'randomBytes', 'timingSafeEqual'],
  async_hooks: ['createHook', 'executionAsyncId', 'triggerAsyncId', 'executionAsyncResource', 'AsyncLocalStorage', 'AsyncResource'],
}

function nodeShimPlugin() {
  return {
    name: 'agentlex-node-shim',
    resolveId(source: string) {
      const name = source.startsWith('node:') ? source.slice(5) : source
      if (Object.prototype.hasOwnProperty.call(NODE_SHIM_CONTENTS, name)) {
        return NODE_SHIM_PREFIX + name
      }
      return null
    },
    load(moduleId: string) {
      if (!moduleId.startsWith(NODE_SHIM_PREFIX)) return null
      const name = moduleId.slice(NODE_SHIM_PREFIX.length)
      const value = NODE_SHIM_CONTENTS[name]
      if (value === undefined) return null
      const named = (NODE_SHIM_NAMED[name] ?? []).map((k) => `  export const ${k} = mod.${k};`).join('\n')
      return `const mod = (${value});\nexport default mod;\n${named}`
    },
  }
}

/* ---------- react-dom/server 垫片（markdown 富剪贴板静态渲染） ---------- */

const REACT_DOM_SERVER_SHIM = `(() => {
  const ReactDOM = require('react-dom');
  const renderToStaticMarkup = (element) => {
    const container = document.createElement('div');
    ReactDOM.render(element, container);
    const html = container.innerHTML;
    ReactDOM.unmountComponentAtNode(container);
    return html;
  };
  const renderToString = renderToStaticMarkup;
  return { renderToStaticMarkup, renderToString, default: { renderToStaticMarkup, renderToString } };
})()`

function reactDomServerShimPlugin() {
  return {
    name: 'agentlex-react-dom-server-shim',
    resolveId(source: string) {
      if (source === 'react-dom/server') return '\0agentlex-react-dom-server'
      return null
    },
    load(moduleId: string) {
      if (moduleId !== '\0agentlex-react-dom-server') return null
      return `const mod = (${REACT_DOM_SERVER_SHIM});\nexport default mod;\nexport const renderToStaticMarkup = mod.renderToStaticMarkup;\nexport const renderToString = mod.renderToString;`
    },
  }
}

/* ------------ i18n 去重：与 vendored app renderer 共用同一份 react-i18next ------------ */

const I18N_DEDUPE_TARGETS: Record<string, string> = {
  'react-i18next': resolvePath(dirname(nodeRequire.resolve('react-i18next/package.json')), 'dist/es/index.js'),
  'i18next': resolvePath(dirname(nodeRequire.resolve('i18next/package.json')), 'dist/esm/i18next.js'),
}

function i18nDedupePlugin() {
  return {
    name: 'agentlex-i18n-dedupe',
    resolveId(source: string) {
      const target = I18N_DEDUPE_TARGETS[source]
      return target ?? null
    },
  }
}

export default defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: true,
  // tsdown auto-externalizes package dependencies; anything NOT in the loader
  // module table must inline instead — a require() the table cannot answer is
  // a guaranteed runtime throw.
  deps: {
    neverBundle: [...CLIENT_EXTERNALS],
    alwaysBundle: (source: string) => (CLIENT_EXTERNALS.includes(source) ? undefined : true),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
    '__PLUGIN_VERSION__': JSON.stringify(packageVersion),
    // vendored app renderer 源码是 Vite 项目拷贝，isDebugMode() 依赖 Vite define 替换
    '__DEBUG_MODE__': 'false',
  },
  alias: {
    '@tauri-apps/api/core': resolvePath(configDir, 'vendor/panel-ui/stubs/tauri-core.ts'),
    '@tauri-apps/api/event': resolvePath(configDir, 'vendor/panel-ui/stubs/tauri-event.ts'),
    '@tauri-apps/plugin-dialog': resolvePath(configDir, 'vendor/panel-ui/stubs/tauri-dialog.ts'),
  },
  plugins: [
    {
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(this: { addWatchFile(file: string): void }, virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
          targets: { chrome: 90 << 16, firefox: 100 << 16, safari: 13 << 16, edge: 90 << 16 },
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        // 合包版：多个业务域存在同名 CSS module（panel.module.css / mobile.module.css
        // 各 3 份），tagId 必须用「包内相对路径」而非 basename，否则后两个域的
        // 同名样式因 tagId 相同被去重跳过，面板/移动端样式缺失导致 UI 崩坏。
        const cssRel = relative(configDir, fileId)
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${id}/${cssRel}`)};`,
          `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
          `  const tag = document.createElement('style');`,
          `  tag.dataset.plugin = ${JSON.stringify(id)};`,
          `  tag.dataset.pluginCss = tagId;`,
          `  tag.textContent = css;`,
          `  document.head.appendChild(tag);`,
          `}`,
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    },
    assetPlugin(),
    nodeShimPlugin(),
    reactDomServerShimPlugin(),
    i18nDedupePlugin(),
    dualRendererAliasPlugin(),
  ],
  outputOptions: {
    entryFileNames: 'client.js',
    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})