/**
 * remove-background — Supabase Edge Function
 *
 * Removes the background from a furniture variant's original image using
 * the Replicate API (cjwbw/rembg model). Updates the furniture_variants row
 * with the clean image URL and sets image_status → pending_approval.
 *
 * Request body: { variant_id: string }
 *
 * Required env vars:
 *   REPLICATE_API_TOKEN — from replicate.com
 *   SUPABASE_URL        — auto-provided by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — auto-provided by Supabase
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Replicate model for background removal
// Using cjwbw/rembg — check latest version at: https://replicate.com/cjwbw/rembg
const REMBG_VERSION = 'fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003'

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

    // 1. Fetch the variant
    const { data: variant, error: fetchError } = await supabase
      .from('furniture_variants')
      .select('id, original_image_url, furniture_item_id')
      .eq('id', variant_id)
      .single()

    if (fetchError || !variant) {
      return jsonError('Variant not found', 404)
    }

    const imageUrl = variant.original_image_url
    if (!imageUrl) {
      return jsonError('Variant has no original image', 400)
    }

    // 2. Create a signed URL so Replicate can access the private bucket
    //    original_image_url looks like: .../storage/v1/object/public/original-images/<path>
    const bucketPrefix = '/storage/v1/object/public/original-images/'
    const pathIdx = imageUrl.indexOf(bucketPrefix)
    let accessibleUrl = imageUrl
    if (pathIdx !== -1) {
      const storagePath = imageUrl.substring(pathIdx + bucketPrefix.length)
      const { data: signedData, error: signedError } = await supabase.storage
        .from('original-images')
        .createSignedUrl(storagePath, 600) // 10 min expiry
      if (signedError || !signedData?.signedUrl) {
        console.error('Failed to create signed URL:', signedError)
        return jsonError('Failed to create signed URL for image', 500)
      }
      accessibleUrl = signedData.signedUrl
      console.log('Using signed URL for Replicate (expires in 10min)')
    }

    // 3. Call Replicate rembg
    const prediction = await createReplicatePrediction(replicateToken, accessibleUrl)
    if (!prediction?.id) {
      return jsonError('Failed to start Replicate prediction', 500)
    }

    // 4. Poll for completion (rembg is fast: ~2-5s)
    const outputUrl = await pollReplicatePrediction(replicateToken, prediction.id, 30)
    if (!outputUrl) {
      // Mark as failed — designer will need to retry
      await supabase
        .from('furniture_variants')
        .update({ image_status: 'rejected' })
        .eq('id', variant_id)
      return jsonError('Background removal timed out or failed', 500)
    }

    // 5. Download the clean image from Replicate
    const cleanImageResp = await fetch(outputUrl)
    if (!cleanImageResp.ok) {
      return jsonError('Failed to download clean image', 500)
    }
    const cleanImageBlob = await cleanImageResp.blob()

    // 6. Upload clean image to Supabase Storage (clean-images bucket)
    const cleanPath = `${variant_id}/clean.png`
    const { error: uploadError } = await supabase.storage
      .from('clean-images')
      .upload(cleanPath, cleanImageBlob, {
        contentType: 'image/png',
        upsert: true,
      })

    if (uploadError) {
      console.error('Upload clean image error:', uploadError)
      return jsonError('Failed to store clean image: ' + uploadError.message, 500)
    }

    // 7. Get public URL for the clean image
    const { data: urlData } = supabase.storage.from('clean-images').getPublicUrl(cleanPath)
    const cleanImageUrl = urlData.publicUrl

    // 8. Update the variant: clean_image_url, image_status → pending_approval
    const { error: updateError } = await supabase
      .from('furniture_variants')
      .update({
        clean_image_url: cleanImageUrl,
        image_status: 'pending_approval',
      })
      .eq('id', variant_id)

    if (updateError) {
      console.error('Update variant error:', updateError)
      return jsonError('Failed to update variant status: ' + updateError.message, 500)
    }

    return new Response(
      JSON.stringify({ success: true, clean_image_url: cleanImageUrl }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
    )
  } catch (err) {
    console.error('remove-background error:', err)
    return jsonError('Unexpected error: ' + String(err), 500)
  }
})

// ── Replicate helpers ─────────────────────────────────────────────────────────

interface ReplicatePrediction {
  id: string
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled'
  output?: string | string[] | null
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
      version: REMBG_VERSION,
      input: { image: imageUrl },
    }),
  })
  if (!resp.ok) {
    const errText = await resp.text()
    console.error('Replicate create prediction failed:', resp.status, errText)
    return null
  }
  return await resp.json()
}

async function pollReplicatePrediction(
  token: string,
  predictionId: string,
  maxAttempts: number
): Promise<string | null> {
  for (let i = 0; i < maxAttempts; i++) {
    await sleep(2000)

    const resp = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { Authorization: `Token ${token}` },
    })
    if (!resp.ok) continue

    const prediction: ReplicatePrediction = await resp.json()

    if (prediction.status === 'succeeded') {
      const output = prediction.output
      if (typeof output === 'string') return output
      if (Array.isArray(output) && output.length > 0) return output[0]
      return null
    }

    if (prediction.status === 'failed' || prediction.status === 'canceled') {
      console.error('Prediction failed:', prediction.error)
      return null
    }
    // Still processing — continue polling
  }
  return null // Timeout
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
