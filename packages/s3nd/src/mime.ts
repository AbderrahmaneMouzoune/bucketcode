const MIME_TYPES: Record<string, string> = {
  // images
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  heic: 'image/heic',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  // documents
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  txt: 'text/plain; charset=utf-8',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // web
  css: 'text/css; charset=utf-8',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  json: 'application/json',
  map: 'application/json',
  md: 'text/markdown; charset=utf-8',
  xml: 'application/xml',
  // media
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'video/webm',
  // archives + fonts
  gz: 'application/gzip',
  otf: 'font/otf',
  tar: 'application/x-tar',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  zip: 'application/zip',
}

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream'

/**
 * Best-effort content type from a key or filename extension.
 * Returns `undefined` when the extension is unknown, so callers can decide
 * whether to fall back to `application/octet-stream`.
 */
export function lookupContentType(nameOrKey: string): string | undefined {
  const lastSegment = nameOrKey.split('/').pop() ?? ''
  const dotIndex = lastSegment.lastIndexOf('.')
  if (dotIndex <= 0 || dotIndex === lastSegment.length - 1) return undefined

  const extension = lastSegment.slice(dotIndex + 1).toLowerCase()
  return MIME_TYPES[extension]
}
