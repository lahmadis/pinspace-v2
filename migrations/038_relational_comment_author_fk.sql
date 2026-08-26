-- Migration 038: Relational Foreign Keys for Comment Author Profiles
-- Ensures author_id columns in comments and board_comments reference user_profiles(user_id)
-- so profile updates (full_name, avatar, role) dynamically normalize across all board comment threads.

-- 1. Index on comments(author_id)
CREATE INDEX IF NOT EXISTS idx_comments_author_id ON public.comments(author_id);

-- 2. Index on board_comments(author_id)
CREATE INDEX IF NOT EXISTS idx_board_comments_author_id ON public.board_comments(author_id);

-- 3. Add FK constraint from comments.author_id to user_profiles.user_id if table exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_comments_author_user_profile'
    ) THEN
        ALTER TABLE public.comments
        ADD CONSTRAINT fk_comments_author_user_profile
        FOREIGN KEY (author_id) REFERENCES public.user_profiles(user_id)
        ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add fk_comments_author_user_profile constraint: %', SQLERRM;
END $$;

-- 4. Add FK constraint from board_comments.author_id to user_profiles.user_id if table exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_board_comments_author_user_profile'
    ) THEN
        ALTER TABLE public.board_comments
        ADD CONSTRAINT fk_board_comments_author_user_profile
        FOREIGN KEY (author_id) REFERENCES public.user_profiles(user_id)
        ON DELETE SET NULL;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE NOTICE 'Could not add fk_board_comments_author_user_profile constraint: %', SQLERRM;
END $$;
