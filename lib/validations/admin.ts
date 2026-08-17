import { z } from 'zod'

export const DOMAIN_REGEX = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/

export const domainInputSchema = z.string()
  .trim()
  .toLowerCase()
  .transform((val) => val.replace(/^https?:\/\//i, ''))
  .refine((val) => DOMAIN_REGEX.test(val), {
    message: 'Invalid domain format — use e.g. wit.edu',
  })

export const createOrgSchema = z.object({
  name: z.string().min(1, { message: 'Organization name is required' }).max(120),
  slug: z.string()
    .min(1, { message: 'Slug is required' })
    .transform((val) => val.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')),
  type: z.enum(['university', 'firm']),
  network_label: z.string().optional(),
  domains: z.array(z.string()).optional().default([]),
})

export const editOrgSchema = z.object({
  name: z.string().min(1, { message: 'Organization name is required' }).max(120),
  slug: z.string()
    .min(1, { message: 'Slug is required' })
    .transform((val) => val.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')),
  type: z.enum(['university', 'firm']),
  network_label: z.string().optional(),
})

export const createStudioSchema = z.object({
  name: z.string().min(1, { message: 'Studio name is required' }).max(100),
  instructorUserId: z.string().min(1, { message: 'Pick an instructor' }),
  department: z.string().min(1, { message: 'A valid department is required' }),
  yearLevel: z.string().min(1, { message: 'A valid year level is required' }),
  academicYear: z.string().min(1, { message: 'A valid academic year is required' }),
})

export const transferOwnerSchema = z.object({
  ownerId: z.string().min(1, { message: 'Pick the new owner' }),
})

export const updateUserRoleSchema = z.object({
  userId: z.string().min(1, { message: 'User ID is required' }),
  accountRole: z.enum(['student', 'instructor']),
})

export type CreateOrgInput = z.infer<typeof createOrgSchema>
export type EditOrgInput = z.infer<typeof editOrgSchema>
export type CreateStudioInput = z.infer<typeof createStudioSchema>
export type TransferOwnerInput = z.infer<typeof transferOwnerSchema>
export type UpdateUserRoleInput = z.infer<typeof updateUserRoleSchema>
