/**
 * Alpha2 harness host-side settings API — local type shim.
 *
 * The plugin compiles against rc.2 `@deepseek-ai/dsh-settings` types (the
 * repo's devDependency baseline), but the deployed harness is the alpha2 line
 * (0.1.2-alpha.2), whose `SettingsProvider` moved the legacy
 * `installSettingsSection(ctx, ns, schema, entry, hooks)` free function onto
 * the service as a method `ctx.settings.installSection(owner, ns, schema,
 * entry, hooks)`. This shim merges that method (plus its hooks type) onto the
 * rc.2 `SettingsProvider` so the host build typechecks against the alpha2
 * surface while keeping the dependency graph on the rc.2 baseline.
 *
 * Keeping the two in lockstep is a runtime concern: the deployed harness MUST
 * be alpha2 for `ctx.settings.installSection` to exist. The rc.2 graph is only
 * the compile-time baseline.
 */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'

declare module '@deepseek-ai/dsh-settings' {
  /** Owner-side lifecycle hooks for one settings section (alpha2). */
  interface SettingsSectionHooks<T> {
    /**
     * Receive the active configuration source: the resolved settings scope
     * while one is attached, the composition entry otherwise. Invoked before
     * the matching `onChange` at attach and at detach.
     */
    setSource(current: () => T): void
    /** Re-judge anything derived from the source after attach/detach/change. */
    onChange(): void
    /** Reject a resolved section this consumer could not act on. */
    validate?(value: T): void
  }

  /** Alpha2 service method merged onto the settings provider. */
  interface SettingsProvider {
    /**
     * Register a namespace schema and receive its owner scope. Equivalent to
     * the legacy `installSettingsSection`. Disposing the calling fiber removes
     * the namespace and its observers.
     */
    installSection<Namespace extends string, T>(
      owner: Context,
      ns: Namespace,
      schema: z<T>,
      entry: T,
      hooks: SettingsSectionHooks<T>,
    ): void
  }
}
