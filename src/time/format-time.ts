const OFFSET_MILLISECONDS = 8 * 60 * 60 * 1_000;

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

export function formatTimestamp(date: Date): string {
  const epochMilliseconds = date.getTime();

  if (!Number.isFinite(epochMilliseconds)) {
    throw new RangeError("formatTimestamp requires a valid Date");
  }

  const localDate = new Date(epochMilliseconds + OFFSET_MILLISECONDS);
  const year = pad(localDate.getUTCFullYear(), 4);
  const month = pad(localDate.getUTCMonth() + 1);
  const day = pad(localDate.getUTCDate());
  const hours = pad(localDate.getUTCHours());
  const minutes = pad(localDate.getUTCMinutes());
  const seconds = pad(localDate.getUTCSeconds());
  const milliseconds = pad(localDate.getUTCMilliseconds(), 3);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}+08:00`;
}
