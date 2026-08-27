/**
 * Renderer mirror of Rust `path_safety::validate_item_name` — gives the
 * inline create/rename editor LIVE feedback so users never hit a Rust error
 * round-trip for a name the UI could have rejected. Rust remains the
 * authority; this must stay rule-for-rule in sync (both files reference each
 * other). Sync is ENFORCED by the shared fixture
 * `src/shared/item-name-validation-cases.json` — both test suites assert
 * against it, so update the fixture together with any rule change here.
 *
 * Returns a user-facing localized message, or `null` when the name is valid.
 */
import { i18n } from "@/i18n";

function validationMessage(key: string, options?: Record<string, unknown>): string {
  return String(i18n.t(`app:workspaceNameValidation.${key}`, options));
}

export function validateItemName(name: string): string | null {
  if (name.length === 0 || name.trim().length === 0) {
    return validationMessage("empty");
  }
  if (name !== name.trim()) {
    return validationMessage("trim");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    return validationMessage("pathSeparators");
  }
  if (/[<>:"|?*]/.test(name)) {
    return validationMessage("illegalChars");
  }
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return validationMessage("controlChars");
    }
  }
  if ([...name].every((c) => c === ".")) {
    return validationMessage("dotsOnly");
  }
  if (isWindowsReservedName(name)) {
    return validationMessage("windowsReserved", { name });
  }
  return null;
}

const WINDOWS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

function isWindowsReservedName(name: string): boolean {
  // Windows strips trailing dots/spaces during normalization, so `CON.`,
  // `CON ` all resolve to the device `CON` — same stem treatment as Rust.
  const dotIdx = name.indexOf(".");
  const stemRaw = dotIdx >= 0 ? name.slice(0, dotIdx) : name;
  const stem = stemRaw.replace(/[ .]+$/, "").toUpperCase();
  return WINDOWS_RESERVED.has(stem);
}
