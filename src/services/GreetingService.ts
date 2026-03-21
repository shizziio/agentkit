function getTimeOfDay(date: Date): 'morning' | 'afternoon' | 'evening' {
  const hour = date.getHours()
  if (hour >= 5 && hour <= 11) return 'morning'
  if (hour >= 12 && hour <= 16) return 'afternoon'
  return 'evening'
}

export class GreetingService {
  greet(name: string | null | undefined, date: Date = new Date()): string {
    const resolved = (name ?? '').trim() ? name! : 'Guest'
    const period = getTimeOfDay(date)
    const salutation = period === 'morning'
      ? 'Good morning'
      : period === 'afternoon'
        ? 'Good afternoon'
        : 'Good evening'
    return `${salutation}, ${resolved}! Welcome aboard.`
  }
}
