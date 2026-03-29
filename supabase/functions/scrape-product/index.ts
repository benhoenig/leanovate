/**
 * scrape-product — Supabase Edge Function
 *
 * Scrapes product details (name, description, price, dimensions) from a
 * Shopee Thailand or IKEA product URL.
 *
 * Request body:  { url: string }
 * Response body: ScrapedProduct | { error: string }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

interface ScrapedProduct {
  name: string
  description: string
  price_thb: number | null
  width_cm: number | null
  depth_cm: number | null
  height_cm: number | null
  source_domain: string
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { url } = await req.json()
    if (!url || typeof url !== 'string') {
      return jsonError('url is required', 400)
    }

    let domain: string
    try {
      domain = new URL(url).hostname.replace('www.', '')
    } catch {
      return jsonError('Invalid URL', 400)
    }

    let result: ScrapedProduct

    if (domain.includes('shopee.co.th') || domain.includes('shopee.')) {
      result = await scrapeShopee(url, domain)
    } else if (domain.includes('ikea.com')) {
      result = await scrapeIkea(url, domain)
    } else {
      // Generic fallback — try Open Graph / JSON-LD
      result = await scrapeGeneric(url, domain)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('scrape-product error:', err)
    return jsonError('Scrape failed: ' + String(err), 500)
  }
})

// ── Shopee ────────────────────────────────────────────────────────────────────

async function scrapeShopee(url: string, domain: string): Promise<ScrapedProduct> {
  // Extract item ID and shop ID from URL
  // Shopee URLs: /product/{shopid}/{itemid} or /-i.{shopid}.{itemid}
  const itemMatch = url.match(/i\.(\d+)\.(\d+)/) ?? url.match(/\/(\d+)\/(\d+)\/?$/)
  if (!itemMatch) {
    // Fall back to generic HTML scrape
    return scrapeGeneric(url, domain)
  }

  const shopId = itemMatch[1]
  const itemId = itemMatch[2]

  // Shopee public product API (no auth required for basic product data)
  const apiUrl = `https://shopee.co.th/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`
  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Referer': 'https://shopee.co.th',
    },
  })

  if (!resp.ok) {
    return scrapeGeneric(url, domain)
  }

  const json = await resp.json()
  const item = json?.data ?? json?.result?.item

  if (!item) {
    return scrapeGeneric(url, domain)
  }

  const name = item.name ?? ''
  const description = item.description ?? ''
  // Price is in cents (price_min / 100000)
  const price = item.price_min != null ? Math.round(item.price_min / 100000) : null
  const priceThb = price != null && price > 0 ? price : null

  // Try to extract dimensions from description using regex
  const dims = parseDimensions(description)

  return {
    name,
    description: description.slice(0, 500),
    price_thb: priceThb,
    ...dims,
    source_domain: domain,
  }
}

// ── IKEA ──────────────────────────────────────────────────────────────────────

async function scrapeIkea(url: string, domain: string): Promise<ScrapedProduct> {
  const html = await fetchHtml(url)
  if (!html) return emptyResult(domain)

  // IKEA embeds JSON-LD and Open Graph
  const jsonLd = extractJsonLd(html)
  const name = jsonLd?.name ?? extractMeta(html, 'og:title') ?? extractTitle(html) ?? ''
  const description = jsonLd?.description ?? extractMeta(html, 'og:description') ?? ''

  // IKEA prices are often in a <span class="pip-price"> element
  const priceMatch = html.match(/class="pip-price[^"]*"[^>]*>\s*[\d,]+\.?\d*/i) ??
    html.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:฿|THB|Baht)/i)
  const priceThb = priceMatch ? parseFloat(priceMatch[0].replace(/[^\d.]/g, '')) : null

  // Dimensions from JSON-LD additionalProperty or description
  let dims = { width_cm: null, depth_cm: null, height_cm: null } as Pick<ScrapedProduct, 'width_cm' | 'depth_cm' | 'height_cm'>
  if (jsonLd?.additionalProperty) {
    for (const prop of jsonLd.additionalProperty) {
      const val = parseFloat(String(prop.value ?? '').replace(',', '.'))
      const name = String(prop.name ?? '').toLowerCase()
      if (name.includes('width')) dims.width_cm = val || null
      if (name.includes('depth')) dims.depth_cm = val || null
      if (name.includes('height')) dims.height_cm = val || null
    }
  }
  if (!dims.width_cm) {
    dims = parseDimensions(description)
  }

  return {
    name,
    description: description.slice(0, 500),
    price_thb: !isNaN(priceThb ?? NaN) ? priceThb : null,
    ...dims,
    source_domain: domain,
  }
}

// ── Generic fallback ──────────────────────────────────────────────────────────

async function scrapeGeneric(url: string, domain: string): Promise<ScrapedProduct> {
  const html = await fetchHtml(url)
  if (!html) return emptyResult(domain)

  const jsonLd = extractJsonLd(html)
  const name = jsonLd?.name ?? extractMeta(html, 'og:title') ?? extractTitle(html) ?? ''
  const description = jsonLd?.description ?? extractMeta(html, 'og:description') ?? ''

  // Price from JSON-LD
  const priceRaw = jsonLd?.offers?.price ?? jsonLd?.price ?? null
  const priceThb = priceRaw != null ? parseFloat(String(priceRaw)) : null

  const dims = parseDimensions(description)

  return {
    name,
    description: description.slice(0, 500),
    price_thb: !isNaN(priceThb ?? NaN) ? priceThb : null,
    ...dims,
    source_domain: domain,
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

function extractJsonLd(html: string): Record<string, unknown> | null {
  const match = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[1])
    // Could be an array
    const item = Array.isArray(parsed) ? parsed[0] : parsed
    return item ?? null
  } catch {
    return null
  }
}

function extractMeta(html: string, property: string): string | null {
  const match = html.match(new RegExp(
    `<meta[^>]*(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
    'i'
  )) ?? html.match(new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
    'i'
  ))
  return match ? htmlDecode(match[1]) : null
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? htmlDecode(match[1].trim()) : null
}

function htmlDecode(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

/**
 * Tries to extract W×D×H dimensions from freeform text.
 * Handles patterns like "90x45x75 cm", "W90 D45 H75", "Width: 90cm"
 */
function parseDimensions(text: string): Pick<ScrapedProduct, 'width_cm' | 'depth_cm' | 'height_cm'> {
  // Pattern: NNN x NNN x NNN cm/m
  const tripleMatch = text.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:cm|m)?/i)
  if (tripleMatch) {
    const [, a, b, c] = tripleMatch.map(Number)
    // Heuristic: largest = depth or width, smallest might be height; assign W/D/H by size
    const sorted = [a, b, c].sort((x, y) => y - x)
    return {
      width_cm: Math.round(sorted[0]),
      depth_cm: Math.round(sorted[1]),
      height_cm: Math.round(sorted[2]),
    }
  }

  // Labelled pattern: W90 D45 H75 or Width: 90 Depth: 45 Height: 75
  const width = text.match(/(?:width|w)[:\s]*(\d+(?:\.\d+)?)\s*(?:cm)?/i)?.[1]
  const depth = text.match(/(?:depth|d)[:\s]*(\d+(?:\.\d+)?)\s*(?:cm)?/i)?.[1]
  const height = text.match(/(?:height|h)[:\s]*(\d+(?:\.\d+)?)\s*(?:cm)?/i)?.[1]

  return {
    width_cm: width ? Math.round(parseFloat(width)) : null,
    depth_cm: depth ? Math.round(parseFloat(depth)) : null,
    height_cm: height ? Math.round(parseFloat(height)) : null,
  }
}

function emptyResult(domain: string): ScrapedProduct {
  return {
    name: '',
    description: '',
    price_thb: null,
    width_cm: null,
    depth_cm: null,
    height_cm: null,
    source_domain: domain,
  }
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
