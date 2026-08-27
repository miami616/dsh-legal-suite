// Asset and Vite environment declarations needed when bundling the original
// renderer sources through the `@` alias.
declare module '*.svg' {
  const src: string
  export default src
}
declare module '*.png' {
  const src: string
  export default src
}
declare module '*.jpeg' {
  const src: string
  export default src
}
declare module '*.jpg' {
  const src: string
  export default src
}
declare module '*.webp' {
  const src: string
  export default src
}
declare module '*.gif' {
  const src: string
  export default src
}
// Vite asset-suffix modules used by the original renderer sources
// (?worker / ?url / ?inline) — bundler-only sugar; the DSH client bundle
// inlines the same payloads via the tsdown asset plugin or loader config.
declare module '*?worker' {
  const workerConstructor: new (options?: WorkerOptions) => Worker
  export default workerConstructor
}
declare module '*?url' {
  const url: string
  export default url
}
declare module '*?inline' {
  const content: string
  export default content
}
interface ImportMetaEnv {
  readonly MODE: string
  readonly DEV: boolean
  readonly PROD: boolean
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
