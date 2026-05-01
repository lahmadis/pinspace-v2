'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'
import { Building2, Briefcase } from 'lucide-react'

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

export default function InstitutionCard({ institution, index = 0 }: InstitutionCardProps) {
  const { name, slug, type, logo_url, studio_count, student_count } = institution
  const isUniversity = type === 'university'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-4 hover:shadow-md transition-shadow duration-200"
    >
      {/* Logo / Fallback */}
      <div className="flex items-start justify-between">
        <div className="w-12 h-12 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
          {logo_url ? (
            <Image src={logo_url} alt={name} width={48} height={48} className="object-contain w-full h-full p-1" />
          ) : isUniversity ? (
            <Building2 className="w-6 h-6 text-gray-400" />
          ) : (
            <Briefcase className="w-6 h-6 text-gray-400" />
          )}
        </div>

        {/* Type badge */}
        <span className={`text-xs font-medium px-2 py-1 rounded-full ${
          isUniversity
            ? 'bg-blue-50 text-blue-600'
            : 'bg-amber-50 text-amber-600'
        }`}>
          {isUniversity ? 'University' : 'Firm'}
        </span>
      </div>

      {/* Name */}
      <div>
        <h3 className="font-semibold text-gray-900 text-base leading-snug">{name}</h3>
        <p className="text-sm text-gray-400 mt-1">
          {studio_count} {studio_count === 1 ? 'studio' : 'studios'} · {student_count} {student_count === 1 ? 'student' : 'students'}
        </p>
      </div>

      {/* CTA */}
      <Link
        href={`/explore?institution_slug=${slug}`}
        className="mt-auto self-start text-sm font-medium text-primary hover:text-primary-light transition-colors"
      >
        Enter →
      </Link>
    </motion.div>
  )
}
