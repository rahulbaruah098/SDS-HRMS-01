export function apiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
