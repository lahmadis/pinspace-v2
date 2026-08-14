import fs from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import LegalDocument from '@/components/LegalDocument'

export const metadata: Metadata = {
  title: 'Privacy Policy · PinSpace',
  description: 'PinSpace Privacy Policy.',
}

export default function PrivacyPage() {
  const filePath = path.join(process.cwd(), 'content', 'legal', 'privacy.md')
  const content = fs.readFileSync(filePath, 'utf8')
  return <LegalDocument content={content} />
}
