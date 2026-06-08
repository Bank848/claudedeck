import { FolderPicker } from '@/components/controls/FolderPicker'
import { BranchPicker } from '@/components/controls/BranchPicker'
import { WorktreeButton } from '@/components/controls/WorktreeButton'
import { useGit } from '@/cli/useGit'

interface FooterPickersProps {
  cwd: string
  onSetCwd: (path: string) => void
  onAnnounce: (msg: string) => void
}

export function FooterPickers({ cwd, onSetCwd, onAnnounce }: FooterPickersProps): JSX.Element {
  const git = useGit(cwd)
  return (
    <div className="flex items-center gap-2">
      <FolderPicker cwd={cwd} onPick={onSetCwd} onAnnounce={onAnnounce} />
      <BranchPicker
        branch={git.status.branch}
        branches={git.branches}
        isWorktree={git.status.isWorktree}
        onCheckout={git.checkout}
        onAnnounce={onAnnounce}
      />
      <WorktreeButton
        disabled={!git.status.isRepo}
        onAdd={git.addWorktree}
        onCreated={onSetCwd}
        onAnnounce={onAnnounce}
      />
    </div>
  )
}
