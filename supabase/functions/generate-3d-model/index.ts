/**
 * generate-3d-model — Supabase Edge Function
 *
 * Generates a 3D model (.glb) from a background-removed product image using
 * TRELLIS via the Replicate API (firtoz/trellis).
 *
 * Sprite rendering is handled client-side in the browser after this function returns.
 *
 * Called after designer approves a clean image (image_status → approved).
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

// TRELLIS model on Replicate — Microsoft's image-to-3D model
// Check latest version at: https://replicate.com/firtoz/trellis
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

    // 1. Fetch variant — we need the clean_image_url
    const { data: variant, error: fetchError } = await supabase
      .from('furniture_variants')
      .select('id, clean_image_url, image_status, furniture_item_id')
      .eq('id', variant_id)
      .single()

    if (fetchError || !variant) return jsonError('Variant not found', 404)
    if (variant.image_status !== 'approved') {
      return jsonError('Image must be approved before generating 3D model', 400)
    }
    if (!variant.clean_image_url) {
      return jsonError('Variant has no clean image', 400)
    }

    // 2. Mark as processing
    await supabase
      .from('furniture_variants')
      .update({ render_status: 'processing' })
      .eq('id', variant_id)

    // 3. Create signed URL for clean image (bucket is private)
    const cleanBucketPrefix = '/storage/v1/object/public/clean-images/'
    let accessibleCleanUrl = variant.clean_image_url
    const cleanPathIdx = variant.clean_image_url.indexOf(cleanBucketPrefix)
    if (cleanPathIdx !== -1) {
      const storagePath = variant.clean_image_url.substring(cleanPathIdx + cleanBucketPrefix.length)
      const { data: signedData, error: signedError } = await supabase.storage
        .from('clean-images')
        .createSignedUrl(storagePath, 600)
      if (signedError || !signedData?.signedUrl) {
        console.error('Failed to create signed URL:', signedError)
        await markFailed(supabase, variant_id)
        return jsonError('Failed to create signed URL for clean image', 500)
      }
      accessibleCleanUrl = signedData.signedUrl
    }

    // 4. Call TRELLIS via Replicate
    const prediction = await createReplicatePrediction(replicateToken, accessibleCleanUrl)
    if (!prediction?.id) {
      await markFailed(supabase, variant_id)
      return jsonError('Failed to start TRELLIS prediction', 500)
    }

    // 4. Poll for completion — TRELLIS takes ~30-60 seconds
    const outputs = await pollReplicatePrediction(replicateToken, prediction.id, 60)
    if (!outputs) {
      await markFailed(supabase, variant_id)
      return jsonError('TRELLIS timed out or failed', 500)
    }

    // TRELLIS output contains multiple files; we want the .glb
    const glbUrl = findGlbUrl(outputs)
    if (!glbUrl) {
      await markFailed(supabase, variant_id)
      return jsonError('TRELLIS did not return a .glb file', 500)
    }

    // 5. Download the .glb file
    const glbResp = await fetch(glbUrl)
    if (!glbResp.ok) {
      await markFailed(supabase, variant_id)
      return jsonError('Failed to download .glb file', 500)
    }
    const glbBlob = await glbResp.blob()

    // 6. Upload .glb to Supabase Storage (glb-models bucket)
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

    // 7. Update variant with glb_path — client will handle sprite rendering
    await supabase
      .from('furniture_variants')
      .update({ glb_path: glbPath })
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
  imageUrl: string
): Promise<ReplicatePrediction | null> {
  const resp = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: TRELLIS_VERSION,
      input: {
        images: [imageUrl],
        texture_size: 1024,
        mesh_simplify: 0.95,
        generate_model: true,
        generate_color: false,
        generate_normal: false,
      },
    }),
  })
  if (!resp.ok) {
    console.error('Replicate create prediction failed:', resp.status, await resp.text())
    return null
  }
  return await resp.json()
}

async function pollReplicatePrediction(
  token: string,
  predictionId: string,
  maxAttempts: number
): Promise<unknown | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(5000) // TRELLIS is slower, poll every 5s

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
