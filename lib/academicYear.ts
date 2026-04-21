export function currentAcademicYear(): string {
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`
}

// Returns N years ending with current, descending
export function academicYearOptions(count = 5): string[] {
  const month = new Date().getMonth() + 1
  const year = new Date().getFullYear()
  const startYear = month >= 8 ? year : year - 1
  return Array.from({ length: count }, (_, i) => {
    const y = startYear - i
    return `${y}-${y + 1}`
  })
}
