// Adds up playtime sessions into days or months for the game page chart.
const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Builds the time slots for a period:
// week = last 7 days, month = last 30 days, year = last 12 months.
function periodBuckets(period, now = new Date()) {
  const buckets = [];
  if (period === 'year') {
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start, end, label: start.toLocaleDateString(undefined, { month: 'short' }) });
    }
  } else {
    const days = period === 'week' ? 7 : 30;
    const today = startOfDay(now);
    for (let i = days - 1; i >= 0; i--) {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const end = new Date(start.getTime() + DAY);
      const label = period === 'week'
        ? start.toLocaleDateString(undefined, { weekday: 'short' })
        : String(start.getDate());
      buckets.push({ start, end, label });
    }
  }
  return buckets;
}

// Returns the buckets with the milliseconds played in each one.
function playtimeByPeriod(sessions = [], period, now = new Date()) {
  return periodBuckets(period, now).map((bucket) => {
    let ms = 0;
    for (const [start, end] of sessions) {
      ms += Math.max(0, Math.min(end, bucket.end) - Math.max(start, bucket.start));
    }
    return { ...bucket, ms };
  });
}

function totalPlaytime(sessions = []) {
  return sessions.reduce((sum, [start, end]) => sum + (end - start), 0);
}

// 0 → "0 min", 45 minutes → "45 min", 90 minutes → "1.5 hrs".
function formatDuration(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = ms / 3600000;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hrs`;
}

if (typeof module !== 'undefined') module.exports = { playtimeByPeriod, totalPlaytime, formatDuration };
