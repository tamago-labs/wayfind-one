import path from 'node:path'

// Workspace containment: every file tool resolves through here.
// Absolute paths, `..` escapes, and drive-letter tricks all land
// inside the workspace root or throw.
export function inside(workspaceDir, rel) {
  const root = path.resolve(workspaceDir)
  const target = path.resolve(root, String(rel ?? '.'))
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('path escapes workspace')
  }
  return target
}
