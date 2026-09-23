const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

// True when the target is a form field or inside a contenteditable element,
// where global shortcuts must not override the native editing behavior.
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(target.tagName) || target.isContentEditable) return true;
  const editableHost = target.closest("[contenteditable]");
  return editableHost !== null && editableHost.getAttribute("contenteditable") !== "false";
}
