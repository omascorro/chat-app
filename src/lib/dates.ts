// Separadores de dia en el chat (como WhatsApp): "Hoy", "Ayer", el dia de la semana o la fecha

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfDay = new Date(d);
  startOfDay.setHours(0, 0, 0, 0);
  const daysAgo = Math.round((startOfToday.getTime() - startOfDay.getTime()) / DAY_MS);
  if (daysAgo === 0) return 'Hoy';
  if (daysAgo === 1) return 'Ayer';
  if (daysAgo > 1 && daysAgo < 7) {
    const weekday = d.toLocaleDateString('es', { weekday: 'long' });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  const sameYear = d.getFullYear() === startOfToday.getFullYear();
  return d.toLocaleDateString('es', { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
}
