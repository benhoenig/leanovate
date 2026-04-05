/**
 * extract-from-screenshot — Supabase Edge Function
 *
 * Receives a product page screenshot (base64), sends it to Claude Vision API,
 * and returns structured furniture product data.
 *
 * Request body:  { image_base64: string, media_type?: string }
 * Response body: ExtractedProduct | { error: string }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const MODEL = 'claude-haiku-4-5-20251001'
// Haiku 4.5 pricing: $0.80/M input, $4/M output
const COST_PER_INPUT_TOKEN = 0.80 / 1_000_000
const COST_PER_OUTPUT_TOKEN = 4.0 / 1_000_000

interface ExtractedProduct {
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  try {
    const { image_base64, media_type } = await req.json()

    if (!image_base64 || typeof image_base64 !== 'string') {
      return jsonResp({ error: 'image_base64 is required' }, 400)
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) {
      return jsonResp({ error: 'ANTHROPIC_API_KEY not configured' }, 500)
    }

    // Extract user ID from auth header (for usage logging)
    let userId: string | null = null
    const authHeader = req.headers.get('authorization')
    if (authHeader) {
      try {
        const token = authHeader.replace('Bearer ', '')
        const payload = JSON.parse(atob(token.split('.')[1]))
        userId = payload.sub ?? null
      } catch { /* ignore — anon key or malformed */ }
    }

    const imageMediaType = media_type || 'image/png'

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: imageMediaType,
                  data: image_base64,
                },
              },
              {
                type: 'text',
                text: `You are a furniture product data extractor. Analyze this screenshot of a furniture product page and extract the following details.

Return ONLY a JSON object with these fields (no markdown, no explanation):
{
  "name": "product name (in original language, keep Thai if Thai)",
  "description": "brief product description, materials, features (max 200 chars)",
  "price_thb": <number or null if not visible — if price is in THB/Baht/฿, use that number. If in another currency, convert approximately to THB>,
  "width_cm": <number or null — width in centimeters>,
  "depth_cm": <number or null — depth in centimeters>,
  "height_cm": <number or null — height in centimeters>
}

Rules:
- Extract the product name exactly as shown (do not translate)
- If dimensions are in mm, convert to cm. If in inches, convert to cm.
- If you see WxDxH or similar, map correctly: W=width, D=depth, H=height
- If price shows a range (e.g. ฿1,990 - ฿2,590), use the lowest price
- If a field is not visible in the screenshot, use null
- Return ONLY the JSON object, nothing else`,
              },
            ],
          },
        ],
      }),
    })

    if (!resp.ok) {
      const errText = await resp.text()
      console.error('[extract-from-screenshot] Claude API error:', resp.status, errText)
      return jsonResp({ error: `Claude API error: ${resp.status}` }, 502)
    }

    const result = await resp.json()
    const textBlock = result?.content?.find((b: { type: string }) => b.type === 'text')
    const rawText = textBlock?.text ?? ''

    // Extract token usage from Claude response
    const inputTokens = result?.usage?.input_tokens ?? 0
    const outputTokens = result?.usage?.output_tokens ?? 0
    const costUsd = inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN

    // Log usage to database (fire and forget — don't block the response)
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const sb = createClient(supabaseUrl, serviceKey)
      sb.from('ai_usage_log').insert({
        function_name: 'extract-from-screenshot',
        model: MODEL,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
        user_id: userId,
        metadata: { extracted_name: rawText.slice(0, 100) },
      }).then(({ error }) => {
        if (error) console.error('[extract-from-screenshot] Usage log insert error:', error)
      })
    } catch (logErr) {
      console.error('[extract-from-screenshot] Usage log error:', logErr)
    }

    // Parse JSON from response — handle potential markdown wrapping
    let parsed: Record<string, unknown>
    try {
      const jsonStr = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()
      parsed = JSON.parse(jsonStr)
    } catch {
      console.error('[extract-from-screenshot] Failed to parse Claude response:', rawText)
      return jsonResp({ error: 'Failed to parse AI response', raw: rawText }, 500)
    }

    const extracted: ExtractedProduct = {
      name: String(parsed.name ?? ''),
      description: String(parsed.description ?? '').slice(0, 500),
      price_thb: typeof parsed.price_thb === 'number' ? parsed.price_thb : null,
      width_cm: typeof parsed.width_cm === 'number' ? Math.round(parsed.width_cm) : null,
      depth_cm: typeof parsed.depth_cm === 'number' ? Math.round(parsed.depth_cm) : null,
      height_cm: typeof parsed.height_cm === 'number' ? Math.round(parsed.height_cm) : null,
      source_domain: 'screenshot',
    }

    return jsonResp(extracted)
  } catch (err) {
    console.error('[extract-from-screenshot] Unhandled error:', err)
    return jsonResp({ error: 'Extraction failed: ' + String(err) }, 500)
  }
})

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
