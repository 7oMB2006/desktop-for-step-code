// Match the child-session namespaces reserved by the pinned Step runtime.
export function isChildSession(id: string) {
  return id.startsWith('subagent-') || id.startsWith('workflow-');
}
