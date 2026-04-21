/**
 * generate-3d-model — Supabase Edge Function
 *
 * Generates a 3D model (.glb) from one or more designer-uploaded product images
 * using TRELLIS via the Replicate API (firtoz/trellis).
 *
 * TRELLIS does its own background removal — no rembg pre-step. Multi-image
 * input is the biggest .glb quality lever; designers should upload 2–4 clean
 * product-page angle shots when available.
 *
 * Called immediately after variant creation (no approval gate before TRELLIS).
 * Post-TRELLIS, the designer reviews the .glb via ModelApprovalModal and sets
 * render_approval_status.
 *
 * Request body: { variant_id: string }
 *
 * Required env vars:
 *   REPLICATE_API_TOKEN
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const TRELLIS_VERSION = 'e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const replicateToken = Deno.env.get('REPLICATE_API_TOKEN')

  if (!replicateToken) {
    return jsonError('REPLICATE_API_TOKEN not configured', 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    const { variant_id } = await req.json()
    if (!variant_id) return jsonError('variant_id is required', 400)

    // 1. Fetch variant — we need original_image_urls
    const { data: variant, error: fetchError } = await supabase
      .from('furniture_variants')
      .select('id, original_image_urls, furniture_item_id')
      .eq('id', variant_id)
      .single()

    if (fetchError || !variant) return jsonError('Variant not found', 404)

    const imageUrls = (variant.original_image_urls as string[] | null) ?? []
    if (imageUrls.length === 0) {
      return jsonError('Variant has no uploaded images', 400)
    }

    // 2. Mark as processing
    await supabase
      .from('furniture_variants')
      .update({ render_status: 'processing' })
      .eq('id', variant_id)

    // 3. Sign each image URL (original-images bucket is private)
    const bucketPrefix = '/storage/v1/object/public/original-images/'
    const signedUrls: string[] = []
    for (const url of imageUrls) {
      const idx = url.indexOf(bucketPrefix)
      if (idx === -1) {
        // URL is already public or external — pass through
        signedUrls.push(url)
        continue
      }
      const storagePath = url.substring(idx + bucketPrefix.length)
      const { data: signed, error: signErr } = await supabase.storage
        .from('original-images')
        .createSignedUrl(storagePath, 600)
      if (signErr || !signed?.signedUrl) {
        console.error('Sign URL failed:', signErr)
        await markFailed(supabase, variant_id)
        return jsonError('Failed to sign image URL', 500)
      }
      signedUrls.push(signed.signedUrl)
    }

    // 4. Call TRELLIS with all images
    const { prediction, error: replicateError } = await createReplicatePrediction(
      replicateToken,
      signedUrls,
    )
    if (!prediction?.id) {
      await markFailed(supabase, variant_id)
      return jsonError(
        `Failed to start TRELLIS prediction: ${replicateError ?? 'unknown Replicate error'}`,
        500,
      )
    }

    // 5. Poll for completion — TRELLIS takes ~30-60 seconds
    const outputs = await pollReplicatePrediction(replicateToken, prediction.id, 60)
    if (!outputs) {
      await markFailed(supabase, variant_id)
      return jsonError('TRELLIS timed out or failed', 500)
    }

    const glbUrl = findGlbUrl(outputs)
    if (!glbUrl) {
      await markFailed(supabase, variant_id)
      return jsonError('TRELLIS did not return a .glb file', 500)
    }

    // 6. Download the .glb
    const glbResp = await fetch(glbUrl)
    if (!glbResp.ok) {
      await markFailed(supabase, variant_id)
      return jsonError('Failed to download .glb file', 500)
    }
    const glbBlob = await glbResp.blob()

    // 7. Upload .glb to glb-models bucket
    const glbPath = `${variant_id}/model.glb`
    const { error: uploadError } = await supabase.storage
      .from('glb-models')
      .upload(glbPath, glbBlob, {
        contentType: 'model/gltf-binary',
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload .glb error:', uploadError)
      await markFailed(supabase, variant_id)
      return jsonError('Failed to store .glb: ' + uploadError.message, 500)
    }

    // 8. Update variant with glb_path AND flip render_status to 'completed'.
    // Without writing render_status here, the DB stays at 'processing' forever
    // — the client's in-memory patch is the only trace of completion, so on
    // refresh the tile shows "Generating 3D…" indefinitely.
    await supabase
      .from('furniture_variants')
      .update({ glb_path: glbPath, render_status: 'completed' })
      .eq('id', variant_id)

    return new Response(
      JSON.stringify({ success: true, glb_path: glbPath }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('generate-3d-model error:', err)
    return jsonError('Unexpected error: ' + String(err), 500)
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

interface ReplicatePrediction {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: unknown
  error?: string | null
}

async function createReplicatePrediction(
  token: string,
  imageUrls: string[]
): Promise<{ prediction: ReplicatePrediction | null; error: string | null }> {
  const resp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: TRELLIS_VERSION,
      input: {
        images: imageUrls,
        texture_size: 1024,
        mesh_simplify: 0.95,
        generate_model: true,
        generate_color: false,
        generate_normal: false,
      },
    }),
  })
  if (!resp.ok) {
    const body = await resp.text()
    console.error('Replicate create prediction failed:', resp.status, body)
    // Truncate oversized bodies but keep enough for diagnosis.
    const snippet = body.length > 400 ? body.slice(0, 400) + '…' : body
    return { prediction: null, error: `HTTP ${resp.status}: ${snippet}` }
  }
  return { prediction: await resp.json(), error: null }
}

async function pollReplicatePrediction(
  token: string,
  predictionId: string,
  maxAttempts: number
): Promise<unknown | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000)

    const resp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${token}` },
    })
    if (!resp.ok) continue

    const prediction: ReplicatePrediction = await resp.json()

    if (prediction.status === 'succeeded') {
      return prediction.output
    }
    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.error('TRELLIS prediction failed:', prediction.error)
      return null
    }
  }
  return null
}

function findGlbUrl(output: unknown): string | null {
  if (typeof output === 'string' && output.endsWith('.glb')) return output
  if (Array.isArray(output)) {
    for (const item of output) {
      if (typeof item === 'string' && item.endsWith('.glb')) return item
    }
  }
  if (typeof output === 'object' && output !== null) {
    for (const val of Object.values(output as Record<string, unknown>)) {
      if (typeof val === 'string' && val.endsWith('.glb')) return val
    }
  }
  return null
}

async function markFailed(supabase: ReturnType<typeof createClient>, variantId: string) {
  await supabase
    .from('furniture_variants')
    .update({ render_status: 'failed' })
    .eq('id', variantId)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
