import { describe, expect, it } from 'vitest'

import {
  buildBoardStorageCopyPlan,
  collectBoardStoragePaths,
  collectWallConfigModelPaths,
  extractBoardStoragePath,
  isOwnedBoardStoragePath,
  trustedBoardStoragePath,
  unreferencedBoardStoragePaths,
} from '@/lib/storage/boardObjects'

const bucketUrl = (path: string) =>
  `https://example.supabase.co/storage/v1/object/public/board-images/${path}`

describe('board storage objects', () => {
  it('extracts and decodes board-images paths without throwing on malformed escapes', () => {
    expect(extractBoardStoragePath(`${bucketUrl('user/a%20b.jpg')}?v=1`)).toBe('user/a b.jpg')
    expect(extractBoardStoragePath(bucketUrl('user/bad%zz.jpg'))).toBe('user/bad%zz.jpg')
    expect(extractBoardStoragePath('https://cdn.example.com/image.jpg')).toBeNull()
  })

  it('accepts only normalized object paths inside the verified user folder', () => {
    expect(isOwnedBoardStoragePath('user-1/123.jpg', 'user-1')).toBe(true)
    expect(isOwnedBoardStoragePath('user-2/123.jpg', 'user-1')).toBe(false)
    expect(isOwnedBoardStoragePath('user-1/../user-2/123.jpg', 'user-1')).toBe(false)
    expect(isOwnedBoardStoragePath('/user-1/123.jpg', 'user-1')).toBe(false)
  })

  it('accepts export objects only from the configured Supabase public bucket origin', () => {
    const supabaseUrl = 'https://project.supabase.co'
    expect(trustedBoardStoragePath(
      `${supabaseUrl}/storage/v1/object/public/board-images/user-1/board.jpg`,
      supabaseUrl,
    )).toBe('user-1/board.jpg')
    expect(trustedBoardStoragePath(
      `${supabaseUrl}/storage/v1/object/public/board-images/user-1/a%20b.jpg?download=1`,
      supabaseUrl,
    )).toBe('user-1/a b.jpg')

    expect(trustedBoardStoragePath('http://project.supabase.co/storage/v1/object/public/board-images/user-1/board.jpg', supabaseUrl)).toBeNull()
    expect(trustedBoardStoragePath('https://evil.test/storage/v1/object/public/board-images/user-1/board.jpg', supabaseUrl)).toBeNull()
    expect(trustedBoardStoragePath('https://project.supabase.co@evil.test/storage/v1/object/public/board-images/user-1/board.jpg', supabaseUrl)).toBeNull()
    expect(trustedBoardStoragePath('https://project.supabase.co/storage/v1/object/public/other/user-1/board.jpg', supabaseUrl)).toBeNull()
    expect(trustedBoardStoragePath('file:///storage/v1/object/public/board-images/user-1/board.jpg', supabaseUrl)).toBeNull()
    expect(trustedBoardStoragePath(`${supabaseUrl}/storage/v1/object/public/board-images/user-1/../user-2/board.jpg`, supabaseUrl)).toBeNull()
  })

  it('creates one independent copy when thumbnail and full image share an object', () => {
    const url = bucketUrl('user-1/original.pdf')
    const plan = buildBoardStorageCopyPlan(url, url, 'user-2', 'board-copy-1')

    expect(plan.copies).toEqual([
      {
        sourcePath: 'user-1/original.pdf',
        destinationPath: 'user-2/duplicates/board-copy-1-1.pdf',
      },
    ])
    expect(plan.thumbnailDestinationPath).toBe(plan.fullDestinationPath)
  })

  it('creates separate independent copies for distinct thumbnail and full objects', () => {
    const plan = buildBoardStorageCopyPlan(
      bucketUrl('user-1/original-thumb.jpg'),
      bucketUrl('user-1/original.jpg'),
      'user-2',
      'board-copy-2'
    )

    expect(plan.copies).toHaveLength(2)
    expect(plan.thumbnailDestinationPath).not.toBe(plan.fullDestinationPath)
  })

  it('keeps only candidate paths that no remaining board references', () => {
    const candidates = new Set(['user/a.jpg', 'user/b.jpg', 'user/c.jpg'])
    const remaining = [
      { thumbnail_url: bucketUrl('user/a.jpg'), full_image_url: bucketUrl('user/other.jpg') },
      { thumbnail_url: null, full_image_url: bucketUrl('user/b.jpg') },
    ]

    expect(collectBoardStoragePaths(remaining)).toEqual(
      new Set(['user/a.jpg', 'user/other.jpg', 'user/b.jpg'])
    )
    expect(unreferencedBoardStoragePaths(candidates, remaining)).toEqual(['user/c.jpg'])
  })

  it('collects model objects from valid wall configurations only', () => {
    expect(collectWallConfigModelPaths([
      { tables: [
        { modelUrl: bucketUrl('user/models/table.glb') },
        { modelUrl: 'blob:local-preview' },
        { modelUrl: null },
      ] },
      { tables: [{ modelUrl: bucketUrl('user/models/chair.stl') }] },
      null,
    ])).toEqual(new Set(['user/models/table.glb', 'user/models/chair.stl']))
  })
})
