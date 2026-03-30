/**
 * manage-team — Supabase Edge Function
 *
 * Admin-only operations for team management:
 *   - invite: Create a new user with a temporary password
 *   - change-role: Update a user's role (admin/designer)
 *   - remove: Delete a user from the system
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY for auth.admin operations.
 *
 * Request body:
 *   { action: 'invite', email: string, display_name: string, role: 'admin' | 'designer' }
 *   { action: 'change-role', user_id: string, role: 'admin' | 'designer' }
 *   { action: 'remove', user_id: string }
 *
 * Required env vars:
 *   SUPABASE_URL (auto-provided)
 *   SUPABASE_SERVICE_ROLE_KEY (auto-provided)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(supabaseUrl, serviceRoleKey)

  try {
    // Verify caller is admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError('Missing authorization', 401)

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !caller) return jsonError('Unauthorized', 401)

    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', caller.id)
      .single()

    if (callerProfile?.role !== 'admin') {
      return jsonError('Admin access required', 403)
    }

    const body = await req.json()
    const { action } = body

    switch (action) {
      case 'invite':
        return await handleInvite(supabase, body)
      case 'change-role':
        return await handleChangeRole(supabase, caller.id, body)
      case 'remove':
        return await handleRemove(supabase, caller.id, body)
      default:
        return jsonError(`Unknown action: ${action}`, 400)
    }
  } catch (err) {
    console.error('manage-team error:', err)
    return jsonError('Unexpected error: ' + String(err), 500)
  }
})

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleInvite(
  supabase: ReturnType<typeof createClient>,
  body: { email?: string; display_name?: string; role?: string }
) {
  const { email, display_name, role } = body
  if (!email || !display_name) return jsonError('email and display_name are required', 400)
  if (role && role !== 'admin' && role !== 'designer') return jsonError('Invalid role', 400)

  // Generate temporary password
  const tempPassword = generateTempPassword()

  // Create user via auth admin API
  const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { display_name },
  })

  if (createError) {
    console.error('createUser error:', createError)
    return jsonError(createError.message, 400)
  }

  if (!newUser.user) return jsonError('User creation failed', 500)

  // The database trigger `handle_new_user` creates the profile automatically
  // with role='designer'. If a different role was requested, update it.
  if (role === 'admin') {
    await supabase
      .from('profiles')
      .update({ role: 'admin', display_name })
      .eq('id', newUser.user.id)
  } else {
    // Ensure display_name is set correctly (trigger uses metadata)
    await supabase
      .from('profiles')
      .update({ display_name })
      .eq('id', newUser.user.id)
  }

  return new Response(
    JSON.stringify({
      success: true,
      user_id: newUser.user.id,
      temp_password: tempPassword,
    }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  )
}

async function handleChangeRole(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  body: { user_id?: string; role?: string }
) {
  const { user_id, role } = body
  if (!user_id || !role) return jsonError('user_id and role are required', 400)
  if (role !== 'admin' && role !== 'designer') return jsonError('Invalid role', 400)

  // Prevent self-demotion
  if (user_id === callerId) return jsonError('Cannot change your own role', 400)

  // Verify target exists
  const { data: target } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user_id)
    .single()
  if (!target) return jsonError('User not found', 404)

  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', user_id)

  if (error) return jsonError(error.message, 500)

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  )
}

async function handleRemove(
  supabase: ReturnType<typeof createClient>,
  callerId: string,
  body: { user_id?: string }
) {
  const { user_id } = body
  if (!user_id) return jsonError('user_id is required', 400)

  // Prevent self-deletion
  if (user_id === callerId) return jsonError('Cannot remove yourself', 400)

  // Delete user via auth admin API (cascade handles profile)
  const { error } = await supabase.auth.admin.deleteUser(user_id)
  if (error) return jsonError(error.message, 500)

  return new Response(
    JSON.stringify({ success: true }),
    { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } }
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let result = ''
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
