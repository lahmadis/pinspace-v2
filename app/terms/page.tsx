import fs from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import LegalDocument from '@/components/LegalDocument'

export const metadata: Metadata = {
  title: 'Terms of Service · pinspace',
  description: 'pinspace Terms of Service.',
}

export default function TermsPage() {
  const filePath = path.join(process.cwd(), 'content', 'legal', 'terms.md')
  const content = fs.readFileSync(filePath, 'utf8')
  return <LegalDocument content={content} />
}
