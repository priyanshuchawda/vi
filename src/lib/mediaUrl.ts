export function toMediaUrl(filePath: string): string {
  return `app-media://local/${encodeURIComponent(filePath)}`;
}
