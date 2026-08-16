'use client'

import { Sheet, StatusState } from '@/components/ui'
import {
  CommentComposer,
  CommentList,
  SignedOutCommentPrompt,
} from '@/components/comments/CommentThread'
import { useBoardComments } from '@/components/comments/useBoardComments'
import { useCommentIdentity } from '@/components/comments/useCommentIdentity'
import type { Board } from '@/types'

interface RightCommentPanelProps {
  board: Board | null
  onClose: () => void
  isArchived?: boolean
  /** Bump from parent on realtime comment events to trigger a refetch. */
  commentNonce?: number
}

export default function RightCommentPanel({
  board,
  onClose,
  isArchived = false,
  commentNonce = 0,
}: RightCommentPanelProps) {
  const { user, authorName } = useCommentIdentity()
  const thread = useBoardComments({
    boardId: board?.id,
    refreshKey: commentNonce,
    postErrorMessage: 'Failed to post comment',
  })

  if (!board) return null

  return (
    <Sheet
      open
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
        />
      </div>

      <div className="mt-4 flex-shrink-0 border-t border-border pt-4">
        {isArchived ? (
          <StatusState status="info" title="This workspace is archived" description="Existing comments remain available, but new comments are disabled." />
        ) : user ? (
          <CommentComposer
            id="board-comment"
            value={thread.newComment}
            onChange={thread.setNewComment}
            onSubmit={() => { void thread.postComment(authorName) }}
            posting={thread.posting}
            textareaRef={thread.textareaRef}
          />
        ) : (
          <SignedOutCommentPrompt />
        )}
      </div>
    </Sheet>
  )
}
