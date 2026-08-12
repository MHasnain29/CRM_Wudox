/** Safe {{placeholder}} interpolation for notification templates. */
export function renderNotificationTemplate(
  template: string,
  context: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? '');
}

export function extractPlaceholders(template: string): string[] {
  const keys = new Set<string>();
  for (const match of template.matchAll(/\{\{(\w+)\}\}/g)) {
    keys.add(match[1]);
  }
  return [...keys];
}
