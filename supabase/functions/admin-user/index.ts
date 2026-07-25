import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.replace('Bearer ', '')
    if (!token) return json({ error: 'No autorizado' }, 401)

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: authData, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !authData.user) return json({ error: 'Sesión inválida' }, 401)

    const { data: caller } = await adminClient
      .from('profiles')
      .select('role, active')
      .eq('id', authData.user.id)
      .single()
    if (!caller?.active || caller.role !== 'admin') return json({ error: 'Solo Administrador puede realizar esta acción' }, 403)

    const body = await request.json()
    const action = String(body.action ?? '')

    if (action === 'create') {
      const fullName = String(body.full_name ?? '').trim()
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const role = String(body.role ?? 'reception')
      if (!fullName || !email.includes('@') || password.length < 8 || !['admin', 'seller', 'reception'].includes(role)) {
        return json({ error: 'Datos de usuario inválidos' }, 400)
      }
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role,
          active: true,
          must_change_password: true,
        },
      })
      if (error) return json({ error: error.message }, 400)
      return json({ id: data.user.id }, 201)
    }

    const userId = String(body.user_id ?? '')
    if (!userId) return json({ error: 'Falta user_id' }, 400)

    if (action === 'reset_password') {
      const password = String(body.password ?? '')
      if (password.length < 8) return json({ error: 'La contraseña debe tener al menos 8 caracteres' }, 400)
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password })
      if (error) return json({ error: error.message }, 400)
      await adminClient.from('profiles').update({ must_change_password: true }).eq('id', userId)
      return json({ ok: true })
    }

    if (action === 'deactivate' || action === 'activate') {
      const active = action === 'activate'
      const { error } = await adminClient.from('profiles').update({ active }).eq('id', userId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Acción no reconocida' }, 400)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Error inesperado' }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
