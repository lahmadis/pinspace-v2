'use client'

import Image from 'next/image'
import Link from 'next/link'
import { Briefcase, Building2, ArrowUpRight } from 'lucide-react'

import { Badge, Card } from '@/components/ui'

export interface Institution {
  id: string
  name: string
  slug: string
  type: 'university' | 'firm'
  logo_url: string | null
  studio_count: number
  student_count: number
}

interface InstitutionCardProps {
  institution: Institution
  index?: number
}

export default function InstitutionCard({ institution }: InstitutionCardProps) {
  const { name, slug, type, logo_url, studio_count, student_count } = institution
  const isUniversity = type === 'university'

  return (
    <Link
      href={`/explore?institution_slug=${slug}`}
      className="group block h-full min-w-0 rounded-pinspace-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
    >
      <Card className="flex h-full min-w-0 flex-col gap-4 transition-[transform,box-shadow] group-hover:-translate-y-0.5 group-hover:shadow-[var(--shadow-raised)]">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-pinspace border border-border bg-background-lighter">
            {logo_url ? (
              <Image src={logo_url} alt="" width={48} height={48} className="h-full w-full object-contain p-1" />
            ) : isUniversity ? (
              <Building2 className="h-6 w-6 text-accent" aria-hidden="true" />
            ) : (
              <Briefcase className="h-6 w-6 text-accent" aria-hidden="true" />
            )}
          </span>
          <Badge variant={isUniversity ? 'accent' : 'warning'}>{isUniversity ? 'University' : 'Firm'}</Badge>
        </div>

        <div className="min-w-0">
          <h3 className="break-words text-base font-bold leading-snug text-text-primary">{name}</h3>
          <p className="mt-1 break-words text-sm text-text-secondary">
            {studio_count} {studio_count === 1 ? 'studio' : 'studios'} · {student_count} {student_count === 1 ? 'student' : 'students'}
          </p>
        </div>

        <span className="mt-auto inline-flex min-h-11 items-center gap-2 self-start font-semibold text-accent">
          Explore institution
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </span>
      </Card>
    </Link>
  )
}
