/**
 * recheck-links — Supabase Edge Function
 *
 * Batch-checks furniture variant source URLs for availability and price changes.
 * Picks the oldest-checked variants, verifies the product page is still live,
 * and updates link_status, last_checked_at, price_thb, and price_changed.
 *
 * Invocation:
 *   - Manual: Admin clicks "Run Recheck Now" in LinkHealthOverview (auth required)
 *   - Scheduled: pg_cron or external cron calls with service_role_key
 *
 * Request body: { batch_size?: number }  (default 50)
 * Response:     { success, checked, updated, newly_inactive, price_changes, errors }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

// Maximum total runtime before we stop processing (leave buffer for response)
const MAX_RUNTIME_MS = 50_000
const PER_URL_TIMEOUT_MS = 8_000
const DELAY_BETWEEN_REQUESTS_MS = 500

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    // If Authorization header is present, verify admin role
    const authHeader = req.headers.get('Authorization')
    if (authHeader && !authHeader.includes(SERVICE_ROLE_KEY)) {
      const token = authHeader.replace('Bearer ', '')
      const { data: { user }, error: authError } = await supabase.auth.getUser(token)
      if (authError || !user) return jsonError('Unauthorized', 401)

      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

      if (profile?.role !== 'admin') return jsonError('Admin access required', 403)
    }

    const body = await req.json().catch(() => ({}))
    const batchSize = Math.min(body.batch_size ?? 50, 100)

    // Query batch: oldest checked first, only for approved items
    const { data: variants, error: queryError } = await supabase
      .from('furniture_variants')
      .select('id, source_url, price_thb, link_status, furniture_item_id')
      .order('last_checked_at', { ascending: true, nullsFirst: true })
      .limit(batchSize)

    if (queryError) return jsonError('Query failed: ' + queryError.message, 500)
    if (!variants || variants.length === 0) {
      return jsonOk({ success: true, checked: 0, updated: 0, newly_inactive: 0, price_changes: 0, errors: 0 })
    }

    // Get parent items for source_url fallback + domain + status filter
    const itemIds = [...new Set(variants.map((v: Record<string, unknown>) => v.furniture_item_id))]
    const { data: items } = await supabase
      .from('furniture_items')
      .select('id, source_url, source_domain, status')
      .in('id', itemIds)

    const itemMap = new Map((items ?? []).map((i: Record<string, unknown>) => [i.id, i]))

    const startTime = Date.now()
    let checked = 0
    let updated = 0
    let newlyInactive = 0
    let priceChanges = 0
    let errors = 0

    for (const variant of variants) {
      // Check runtime budget
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        console.log('[recheck-links] Approaching timeout, stopping batch early')
        break
      }

      const item = itemMap.get(variant.furniture_item_id) as Record<string, unknown> | undefined
      if (!item || item.status !== 'approved') continue

      const effectiveUrl = (variant.source_url as string) || (item.source_url as string)
      if (!effectiveUrl || effectiveUrl === 'manual') continue

      const domain = (item.source_domain as string) ?? ''
      const currentPrice = variant.price_thb as number | null

      try {
        const result = await checkUrl(effectiveUrl, domain)
        checked++

        const priceChanged = (
          currentPrice != null &&
          result.price != null &&
          Math.abs(result.price - currentPrice) / currentPrice > 0.20
        )

        const updateData: Record<string, unknown> = {
          link_status: result.status,
          last_checked_at: new Date().toISOString(),
        }

        if (result.price != null) {
          updateData.price_thb = result.price
        }
        updateData.price_changed = priceChanged

        if (result.status === 'inactive' && variant.link_status !== 'inactive') {
          newlyInactive++
        }
        if (priceChanged) priceChanges++

        const { error: updateError } = await supabase
          .from('furniture_variants')
          .update(updateData)
          .eq('id', variant.id)

        if (updateError) {
          console.error('[recheck-links] Update error for', variant.id, updateError)
          errors++
        } else {
          updated++
        }
      } catch (err) {
        console.error('[recheck-links] Check error for', variant.id, err)
        errors++
        // Don't mark as inactive on errors — skip and retry next cycle
        await supabase
          .from('furniture_variants')
          .update({ last_checked_at: new Date().toISOString() })
          .eq('id', variant.id)
      }

      // Delay between requests to avoid rate limiting
      if (DELAY_BETWEEN_REQUESTS_MS > 0) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_REQUESTS_MS))
      }
    }

    console.log(`[recheck-links] Done: checked=${checked} updated=${updated} inactive=${newlyInactive} prices=${priceChanges} errors=${errors}`)

    return jsonOk({
      success: true,
      checked,
      updated,
      newly_inactive: newlyInactive,
      price_changes: priceChanges,
      errors,
    })
  } catch (err) {
    console.error('[recheck-links] Fatal error:', err)
    return jsonError('Recheck failed: ' + String(err), 500)
  }
})

// ── URL checking by domain ──────────────────────────────────────────────────

interface CheckResult {
  status: 'active' | 'inactive'
  price: number | null
}

async function checkUrl(url: string, domain: string): Promise<CheckResult> {
  if (domain.includes('shopee.co.th') || domain.includes('shopee.')) {
    return checkShopee(url)
  } else if (domain.includes('ikea.com')) {
    return checkIkea(url)
  } else {
    return checkGeneric(url)
  }
}

async function checkShopee(url: string): Promise<CheckResult> {
  // Extract shopid/itemid from URL
  const itemMatch = url.match(/i\.(\d+)\.(\d+)/) ?? url.match(/\/(\d+)\/(\d+)\/?$/)
  if (!itemMatch) return checkGeneric(url)

  const shopId = itemMatch[1]
  const itemId = itemMatch[2]

  const apiUrl = `https://shopee.co.th/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`
  const resp = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Referer': 'https://shopee.co.th',
    },
    signal: AbortSignal.timeout(PER_URL_TIMEOUT_MS),
  })

  if (!resp.ok) return { status: 'inactive', price: null }

  const json = await resp.json()
  const item = json?.data ?? json?.result?.item

  if (!item || !item.name) return { status: 'inactive', price: null }

  const price = item.price_min != null ? Math.round(item.price_min / 100000) : null
  return { status: 'active', price: price != null && price > 0 ? price : null }
}

async function checkIkea(url: string): Promise<CheckResult> {
  const html = await fetchHtml(url)
  if (!html) return { status: 'inactive', price: null }

  // Check if page has product content
  const hasProduct = html.includes('pip-price') || html.includes('"@type":"Product"') || html.includes('og:product')
  if (!hasProduct) return { status: 'inactive', price: null }

  // Extract price
  const priceMatch = html.match(/class="pip-price[^"]*"[^>]*>\s*[\d,]+\.?\d*/i) ??
    html.match(/(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:฿|THB|Baht)/i)
  const price = priceMatch ? parseFloat(priceMatch[0].replace(/[^\d.]/g, '')) : null

  return { status: 'active', price: !isNaN(price ?? NaN) ? price : null }
}

async function checkGeneric(url: string): Promise<CheckResult> {
  const html = await fetchHtml(url)
  if (!html) return { status: 'inactive', price: null }

  // Check for product-like content
  const jsonLd = extractJsonLd(html)
  const hasProduct = jsonLd?.['@type'] === 'Product' ||
    html.includes('"@type":"Product"') ||
    html.includes('og:product') ||
    html.includes('og:title')

  if (!hasProduct) return { status: 'inactive', price: null }

  // Extract price from JSON-LD
  const offers = jsonLd?.offers as Record<string, unknown> | undefined
  const priceRaw = offers?.price ?? jsonLd?.price ?? null
  const price = priceRaw != null ? parseFloat(String(priceRaw)) : null

  return { status: 'active', price: !isNaN(price ?? NaN) ? price : null }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
      },
      signal: AbortSignal.timeout(PER_URL_TIMEOUT_MS),
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
    const item = Array.isArray(parsed) ? parsed[0] : parsed
    return item ?? null
  } catch {
    return null
  }
}

function jsonOk(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify(data), {
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
