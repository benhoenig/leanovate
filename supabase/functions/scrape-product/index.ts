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
  _debug?: string[]
}

// Collects debug trace lines that get returned in the response body
const debugTrace: string[] = []
function trace(msg: string) {
  debugTrace.push(msg)
  console.log(msg)
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
    // Reset debug trace for each request
    debugTrace.length = 0

    const { url } = await req.json()
    trace('[scrape-product] Received URL: ' + url)
    if (!url || typeof url !== 'string') {
      return jsonError('url is required', 400)
    }

    let domain: string
    try {
      domain = new URL(url).hostname.replace('www.', '')
    } catch {
      trace('[scrape-product] Invalid URL: ' + url)
      return jsonError('Invalid URL', 400)
    }

    trace('[scrape-product] Domain: ' + domain)

    let result: ScrapedProduct
    let strategy: string

    if (domain.includes('shopee.co.th') || domain.includes('shopee.')) {
      strategy = 'shopee'
      trace('[scrape-product] Using Shopee strategy')
      result = await scrapeShopee(url, domain)
    } else if (domain.includes('ikea.com')) {
      strategy = 'ikea'
      trace('[scrape-product] Using IKEA strategy')
      result = await scrapeIkea(url, domain)
    } else {
      strategy = 'generic'
      trace('[scrape-product] Using generic fallback strategy')
      result = await scrapeGeneric(url, domain)
    }

    trace(`[scrape-product] ${strategy} result: name="${result.name?.slice(0, 60)}" price=${result.price_thb} dims=${result.width_cm}×${result.depth_cm}×${result.height_cm}`)

    // Attach debug trace to response
    result._debug = [...debugTrace]

    return new Response(JSON.stringify(result), {
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    trace('[scrape-product] Unhandled error: ' + String(err))
    return new Response(JSON.stringify({ error: 'Scrape failed: ' + String(err), _debug: [...debugTrace] }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})

// ── Shopee ────────────────────────────────────────────────────────────────────

async function scrapeShopee(url: string, domain: string): Promise<ScrapedProduct> {
  // Resolve short URLs (s.shopee.co.th/xxx) by following redirects to get the real product URL
  let resolvedUrl = url
  if (domain.startsWith('s.shopee') || !url.match(/i\.(\d+)\.(\d+)/) && !url.match(/\/(\d+)\/(\d+)\/?$/)) {
    trace('[shopee] Short/non-standard URL detected, resolving redirect…')
    try {
      const redirectResp = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(8000),
      })
      resolvedUrl = redirectResp.url
      trace('[shopee] Resolved to: ' + resolvedUrl)
      // Update domain from resolved URL
      try {
        domain = new URL(resolvedUrl).hostname.replace('www.', '')
      } catch { /* keep original domain */ }
    } catch (err) {
      trace('[shopee] Redirect resolution failed: ' + String(err))
    }
  }

  // Extract item ID and shop ID from URL
  // Shopee URLs: /product/{shopid}/{itemid} or /-i.{shopid}.{itemid}
  trace('[shopee] Trying regex on: ' + resolvedUrl)
  const m1 = resolvedUrl.match(/i\.(\d+)\.(\d+)/)
  const m2 = resolvedUrl.match(/\/product\/(\d+)\/(\d+)/)
  const m3 = resolvedUrl.match(/\/(\d+)\/(\d+)\/?(?:[?#]|$)/)
  trace('[shopee] Regex results: m1=' + JSON.stringify(m1?.slice(0,3)) + ' m2=' + JSON.stringify(m2?.slice(0,3)) + ' m3=' + JSON.stringify(m3?.slice(0,3)))
  const itemMatch = m1 ?? m2 ?? m3
  if (!itemMatch) {
    trace('[shopee] No itemid/shopid found — falling back to generic')
    return scrapeGeneric(resolvedUrl, domain)
  }

  const shopId = itemMatch[1]
  const itemId = itemMatch[2]
  trace('[shopee] Extracted shopId=' + shopId + ' itemId=' + itemId)

  // Shopee public product API (no auth required for basic product data)
  const apiUrl = `https://shopee.co.th/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`
  trace('[shopee] Fetching API: ' + apiUrl)
  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://shopee.co.th',
      'Accept': 'application/json',
    },
  })

  trace('[shopee] API response status: ' + resp.status)
  if (!resp.ok) {
    trace('[shopee] API returned non-OK, falling back to generic')
    return scrapeGeneric(url, domain)
  }

  const rawText = await resp.text()
  trace('[shopee] API response length: ' + rawText.length + ' chars')
  trace('[shopee] API response preview: ' + rawText.slice(0, 500))

  let json: Record<string, unknown>
  try {
    json = JSON.parse(rawText)
  } catch {
    trace('[shopee] Failed to parse API JSON, falling back to generic')
    return scrapeGeneric(url, domain)
  }

  trace('[shopee] API top-level keys: ' + Object.keys(json).join(', '))
  const item = (json?.data as Record<string, unknown>) ?? (json as Record<string, unknown>)?.item ?? ((json as Record<string, unknown>)?.result as Record<string, unknown>)?.item
  trace('[shopee] item found: ' + !!item + ' | keys: ' + (item ? Object.keys(item).slice(0, 15).join(',') : 'n/a'))

  if (!item) {
    trace('[shopee] No item data in response — top-level JSON: ' + JSON.stringify(json).slice(0, 300))
    trace('[shopee] Falling back to generic')
    return scrapeGeneric(url, domain)
  }

  const name = (item as Record<string, unknown>).name as string ?? ''
  const description = (item as Record<string, unknown>).description as string ?? ''
  // Price is in cents (price_min / 100000)
  const priceMin = (item as Record<string, unknown>).price_min as number | undefined
  const price = priceMin != null ? Math.round(priceMin / 100000) : null
  const priceThb = price != null && price > 0 ? price : null
  trace('[shopee] Parsed: name="' + (name || '').slice(0, 60) + '" price_min=' + priceMin + ' price_thb=' + priceThb)

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
  trace('[ikea] Fetching HTML…')
  const html = await fetchHtml(url)
  trace('[ikea] HTML received: ' + (html ? `${html.length} chars` : 'null'))
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
  trace('[generic] Fetching HTML…')
  const html = await fetchHtml(url)
  trace('[generic] HTML received: ' + (html ? `${html.length} chars` : 'null (fetch failed or timed out)'))
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
    trace('[fetchHtml] Fetching: ' + url)
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    })
    trace('[fetchHtml] Status: ' + resp.status + ' | content-type: ' + resp.headers.get('content-type'))
    if (!resp.ok) {
      trace('[fetchHtml] Non-OK response, returning null')
      return null
    }
    const text = await resp.text()
    trace('[fetchHtml] Got ' + text.length + ' chars')
    return text
  } catch (err) {
    trace('[fetchHtml] Error: ' + String(err))
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
