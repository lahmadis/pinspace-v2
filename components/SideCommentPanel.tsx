'use client'

import { Sheet } from '@/components/ui'
import { CommentComposer, CommentList } from '@/components/comments/CommentThread'
import { useBoardComments } from '@/components/comments/useBoardComments'
import { useCommentIdentity } from '@/components/comments/useCommentIdentity'
import type { Board } from '@/types'

interface SideCommentPanelProps {
  board: Board | null
  onClose: () => void
}

export default function SideCommentPanel({ board, onClose }: SideCommentPanelProps) {
  const { authorName } = useCommentIdentity()
  const thread = useBoardComments({ boardId: board?.id })

  if (!board) return null

  return (
    <Sheet
      open
      side="left"
      onOpenChange={(open) => {
        if (!open) {
          thread.resetDraft()
          onClose()
        }
      }}
      title={board.title || 'Board comments'}
      description={board.studentName || 'Read and add comments for this board.'}
      className="flex max-w-lg flex-col pb-[max(1.5rem,env(safe-area-inset-bottom))] motion-reduce:transition-none [&>button.absolute]:h-11 [&>button.absolute]:w-11"
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto" aria-live="polite">
        <CommentList
          comments={thread.comments}
          loading={thread.loading}
          error={thread.error}
          onRetry={() => { void thread.fetchComments() }}
          emptyDescription="Be the first to share your thoughts."
        />
      </div>

      <div className="mt-4 flex-shrink-0 border-t border-border pt-4">
        <CommentComposer
          id="side-board-comment"
          value={thread.newComment}
          onChange={thread.setNewComment}
          onSubmit={() => { void thread.postComment(authorName) }}
          posting={thread.posting}
          textareaRef={thread.textareaRef}
        />
      </div>
    </Sheet>
  )
}
