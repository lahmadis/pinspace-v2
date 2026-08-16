'use client'

import { useRef, type FormEvent } from 'react'

import { Button, Dialog, Input } from '@/components/ui'

type NamedProject = { id: string; name: string }
type RenameProject = { id: string; value: string }

interface DashboardActionDialogsProps {
  rename: RenameProject | null
  deletion: NamedProject | null
  leave: NamedProject | null
  renamePending?: boolean
  deletePending?: boolean
  leavePending?: boolean
  onRenameChange: (value: string) => void
  onCancelRename: () => void
  onSubmitRename: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onCancelLeave: () => void
  onConfirmLeave: () => void
}

export function DashboardActionDialogs({
  rename,
  deletion,
  leave,
  renamePending = false,
  deletePending = false,
  leavePending = false,
  onRenameChange,
  onCancelRename,
  onSubmitRename,
  onCancelDelete,
  onConfirmDelete,
  onCancelLeave,
  onConfirmLeave,
}: DashboardActionDialogsProps) {
  const renameInputRef = useRef<HTMLInputElement>(null)

  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    if (rename?.value.trim() && !renamePending) onSubmitRename()
  }

  return (
    <>
      <Dialog
        open={Boolean(rename)}
        onOpenChange={(open) => {
          if (!open && !renamePending) onCancelRename()
        }}
        title="Rename project"
        description="Choose a clear name that collaborators will recognize."
        initialFocusRef={renameInputRef}
        closeOnOutsideClick={!renamePending}
        hideCloseButton={renamePending}
      >
        <form onSubmit={submitRename} className="space-y-5">
          <div>
            <label htmlFor="dashboard-project-name" className="mb-2 block text-sm font-semibold text-text-primary">
              Project name
            </label>
            <Input
              ref={renameInputRef}
              id="dashboard-project-name"
              value={rename?.value ?? ''}
              maxLength={100}
              disabled={renamePending}
              onChange={(event) => onRenameChange(event.target.value)}
            />
          </div>
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" disabled={renamePending} onClick={onCancelRename}>
              Cancel
            </Button>
            <Button type="submit" loading={renamePending} disabled={!rename?.value.trim()}>
              {renamePending ? 'Renaming…' : 'Rename project'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deletion)}
        onOpenChange={(open) => {
          if (!open && !deletePending) onCancelDelete()
        }}
        title="Delete project?"
        description={
          <>
            <strong className="text-text-primary">“{deletion?.name}”</strong> and all its boards will be permanently
            deleted. This cannot be undone.
          </>
        }
        closeOnOutsideClick={!deletePending}
        hideCloseButton={deletePending}
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={deletePending} onClick={onCancelDelete}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={deletePending}
            aria-label={deletePending ? 'Deleting project' : 'Delete project'}
            onClick={onConfirmDelete}
          >
            {deletePending ? 'Deleting…' : 'Delete project'}
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(leave)}
        onOpenChange={(open) => {
          if (!open && !leavePending) onCancelLeave()
        }}
        title="Leave project?"
        description={
          <>
            You will lose access to <strong className="text-text-primary">“{leave?.name}”</strong> until you are
            invited again. Boards you created stay with the project.
          </>
        }
        closeOnOutsideClick={!leavePending}
        hideCloseButton={leavePending}
      >
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" disabled={leavePending} onClick={onCancelLeave}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            loading={leavePending}
            aria-label={leavePending ? 'Leaving project' : 'Leave project'}
            onClick={onConfirmLeave}
          >
            {leavePending ? 'Leaving…' : 'Leave project'}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
