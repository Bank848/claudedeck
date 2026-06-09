import { FolderPlus, X } from 'lucide-react'
import { pickDirectory } from '@/system/pickDirectory'
import { folderLabel } from '@/system/recentFolders'

/**
 * Edit the list of extra directories granted to claude beyond the working folder
 * (`--add-dir`). "Add folder…" opens the native picker; each dir is a removable
 * row. Accessible: `role="list"`, each remove × is a real labelled button.
 */
export interface DirScopeEditorProps {
  dirs: string[]
  onChange: (next: string[]) => void
}

export function DirScopeEditor({ dirs, onChange }: DirScopeEditorProps): JSX.Element {
  const add = async (): Promise<void> => {
    const path = await pickDirectory()
    const t = path?.trim()
    if (t && !dirs.includes(t)) onChange([...dirs, t])
  }
  const remove = (dir: string): void => onChange(dirs.filter((d) => d !== dir))

  return (
    <div>
      {dirs.length > 0 && (
        <ul role="list" aria-label="โฟลเดอร์เพิ่มเติม" className="mb-2 space-y-1">
          {dirs.map((d) => (
            <li
              key={d}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg"
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={d}>
                {folderLabel(d)}
              </span>
              <button
                type="button"
                onClick={() => remove(d)}
                aria-label={`ลบโฟลเดอร์ ${folderLabel(d)}`}
                className="shrink-0 rounded p-0.5 text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => void add()}
        className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
      >
        <FolderPlus size={14} className="text-fg-muted" />
        เพิ่มโฟลเดอร์…
      </button>
    </div>
  )
}
