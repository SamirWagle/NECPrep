/**
 * `id` wiring for the tablist/tab/tabpanel relationship. Tab values are
 * arbitrary strings (slugs, labels, ids from the API), so they are sanitised
 * before being used as HTML ids.
 */
function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function tabId(baseId: string, value: string): string {
  return `${baseId}-tab-${slug(value)}`;
}

export function tabPanelId(baseId: string, value: string): string {
  return `${baseId}-panel-${slug(value)}`;
}
