import { createClient } from 'npm:@supabase/supabase-js@2.110.8'

const defaultAllowedOrigins = [
  'https://agenda-casonamalu.vercel.app',
  'https://agenda-casona-malu.vercel.app',
  'https://agenda-git-main-casona-malu.vercel.app',
  'http://localhost:5173',
]

Deno.serve(async (request) => {
  if (!isAllowedOrigin(request)) return json(request, { error: 'Origen no autorizado' }, 403)
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) })
  if (request.method !== 'POST') return json(request, { error: 'Método no permitido' }, 405)

  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (contentLength > 16_384) return json(request, { error: 'Solicitud demasiado grande' }, 413)

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return json(request, { error: 'No autorizado' }, 401)

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { data: authData, error: authError } = await adminClient.auth.getUser(token)
    if (authError || !authData.user) return json(request, { error: 'Sesión inválida' }, 401)

    const { data: caller } = await adminClient
      .from('profiles')
      .select('role, active')
      .eq('id', authData.user.id)
      .single()
    if (!caller?.active || caller.role !== 'admin') return json(request, { error: 'Solo Administrador puede realizar esta acción' }, 403)

    const body = await request.json()
    const action = String(body.action ?? '')

    if (action === 'create') {
      const fullName = String(body.full_name ?? '').trim()
      const email = String(body.email ?? '').trim().toLowerCase()
      const password = String(body.password ?? '')
      const role = String(body.role ?? 'reception')
      if (
        fullName.length < 2 || fullName.length > 120 ||
        !isValidEmail(email) || !isStrongPassword(password) ||
        !['admin', 'seller', 'reception', 'workshop'].includes(role)
      ) {
        return json(request, { error: 'Datos de usuario inválidos. La contraseña debe tener 12 caracteres, mayúscula, minúscula y número.' }, 400)
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
      if (error) return json(request, { error: error.message }, 400)
      return json(request, { id: data.user.id }, 201)
    }

    const userId = String(body.user_id ?? '')
    if (!isUuid(userId)) return json(request, { error: 'user_id inválido' }, 400)

    if (action === 'reset_password') {
      const password = String(body.password ?? '')
      if (!isStrongPassword(password)) {
        return json(request, { error: 'La contraseña debe tener 12 caracteres, mayúscula, minúscula y número.' }, 400)
      }
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password })
      if (error) return json(request, { error: error.message }, 400)
      await adminClient.from('profiles').update({ must_change_password: true }).eq('id', userId)
      return json(request, { ok: true })
    }

    if (action === 'deactivate' || action === 'activate') {
      const active = action === 'activate'
      if (!active && userId === authData.user.id) {
        return json(request, { error: 'No puedes desactivar tu propia cuenta.' }, 400)
      }
      if (!active) {
        const { data: target } = await adminClient.from('profiles').select('role,active').eq('id', userId).single()
        if (target?.role === 'admin' && target.active) {
          const { count } = await adminClient
            .from('profiles')
            .select('id', { count: 'exact', head: true })
            .eq('role', 'admin')
            .eq('active', true)
          if ((count ?? 0) <= 1) return json(request, { error: 'No se puede desactivar al último administrador activo.' }, 400)
        }
      }
      const { error } = await adminClient.from('profiles').update({ active }).eq('id', userId)
      if (error) return json(request, { error: error.message }, 400)
      return json(request, { ok: true })
    }

    return json(request, { error: 'Acción no reconocida' }, 400)
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : 'Error inesperado' }, 500)
  }
})

function configuredOrigins() {
  const configured = Deno.env.get('APP_ALLOWED_ORIGINS')
  return new Set((configured ? configured.split(',') : defaultAllowedOrigins).map((origin) => origin.trim()).filter(Boolean))
}

function isAllowedOrigin(request: Request) {
  const origin = request.headers.get('Origin')
  return !origin || configuredOrigins().has(origin)
}

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin')
  return {
    ...(origin && configuredOrigins().has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function isValidEmail(value: string) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isStrongPassword(value: string) {
  return value.length >= 12 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  })
}
