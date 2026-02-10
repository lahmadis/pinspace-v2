import { redirect } from 'next/navigation'

/**
 * Institution handoff: /i/wit → /?institution=wit (home landing page)
 * Give each school a clean link, e.g. pinspace.app/i/wit
 */
export default function InstitutionHandoffPage({
  params,
}: {
  params: { slug: string }
}) {
  const slug = params?.slug
  if (!slug) redirect('/')
  redirect(`/?institution=${encodeURIComponent(slug)}`)
}
