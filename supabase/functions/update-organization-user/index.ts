// @ts-expect-error Supabase Edge Functions resolve URL imports through Deno.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

declare const Deno: {
  env: {
    get: (name: string) => string | undefined
  }
  serve: (
    handler: (request: Request) => Response | Promise<Response>,
  ) => void
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type UpdateUserRequest = {
  organizationId?: unknown
  organizationUserId?: unknown
  fullName?: unknown
  email?: unknown
  password?: unknown
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  )
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', {
      headers: corsHeaders,
    })
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      {
        error: 'Method not allowed.',
      },
      405,
    )
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const supabaseServiceRoleKey = Deno.env.get(
    'SUPABASE_SERVICE_ROLE_KEY',
  )

  if (
    !supabaseUrl ||
    !supabaseAnonKey ||
    !supabaseServiceRoleKey
  ) {
    console.error(
      'Required Supabase environment variables are missing.',
    )

    return jsonResponse(
      {
        error: 'The organization user service is not configured.',
      },
      500,
    )
  }

  const authorizationHeader =
    request.headers.get('Authorization')

  if (!authorizationHeader) {
    return jsonResponse(
      {
        error: 'You must be signed in.',
      },
      401,
    )
  }

  const callerClient = createClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      global: {
        headers: {
          Authorization: authorizationHeader,
        },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )

  const adminClient = createClient(
    supabaseUrl,
    supabaseServiceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  )

  const {
    data: { user: caller },
    error: callerError,
  } = await callerClient.auth.getUser()

  if (callerError || !caller) {
    return jsonResponse(
      {
        error: 'Your session is invalid or has expired.',
      },
      401,
    )
  }

  let requestBody: UpdateUserRequest

  try {
    requestBody =
      (await request.json()) as UpdateUserRequest
  } catch {
    return jsonResponse(
      {
        error: 'The submitted request is not valid JSON.',
      },
      400,
    )
  }

  const organizationId =
    typeof requestBody.organizationId === 'string'
      ? requestBody.organizationId.trim()
      : ''

  const organizationUserId =
    typeof requestBody.organizationUserId === 'string'
      ? requestBody.organizationUserId.trim()
      : ''

  const fullName =
    typeof requestBody.fullName === 'string'
      ? requestBody.fullName.trim()
      : ''

  const email =
    typeof requestBody.email === 'string'
      ? normalizeEmail(requestBody.email)
      : ''

  const password =
    typeof requestBody.password === 'string'
      ? requestBody.password
      : ''

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse(
      {
        error: 'A valid organization ID is required.',
      },
      400,
    )
  }

  if (
    !organizationUserId ||
    !isUuid(organizationUserId)
  ) {
    return jsonResponse(
      {
        error: 'A valid organization user ID is required.',
      },
      400,
    )
  }

  if (!fullName) {
    return jsonResponse(
      {
        error: 'The user’s full name is required.',
      },
      400,
    )
  }

  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return jsonResponse(
      {
        error: 'Enter a valid email address.',
      },
      400,
    )
  }

  if (password && password.length < 8) {
    return jsonResponse(
      {
        error:
          'The replacement password must contain at least 8 characters.',
      },
      400,
    )
  }

  const {
    data: callerMembership,
    error: callerMembershipError,
  } = await adminClient
    .from('organization_users')
    .select('role, is_active')
    .eq('organization_id', organizationId)
    .eq('user_id', caller.id)
    .eq('is_active', true)
    .maybeSingle()

  if (
    callerMembershipError ||
    !callerMembership ||
    !['organization_admin', 'user_admin'].includes(
      callerMembership.role,
    )
  ) {
    return jsonResponse(
      {
        error:
          'Only an active Organization Admin or User Admin can update organization users.',
      },
      403,
    )
  }

  const {
    data: targetMembership,
    error: targetMembershipError,
  } = await adminClient
    .from('organization_users')
    .select('user_id')
    .eq('id', organizationUserId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (
    targetMembershipError ||
    !targetMembership?.user_id
  ) {
    return jsonResponse(
      {
        error:
          'The selected organization user was not found.',
      },
      404,
    )
  }

  const targetUserId = targetMembership.user_id

  const {
    data: existingAuthResult,
    error: existingAuthError,
  } = await adminClient.auth.admin.getUserById(
    targetUserId,
  )

  if (
    existingAuthError ||
    !existingAuthResult.user
  ) {
    console.error(
      'Organization Auth user failed to load:',
      existingAuthError,
    )

    return jsonResponse(
      {
        error:
          'The user’s authentication account could not be loaded.',
      },
      500,
    )
  }

  const existingMetadata =
    existingAuthResult.user.user_metadata ?? {}

  const authUpdates: {
    email: string
    email_confirm: boolean
    password?: string
    user_metadata: Record<string, unknown>
  } = {
    email,
    email_confirm: true,
    user_metadata: {
      ...existingMetadata,
      full_name: fullName,
      ...(password
        ? {
            must_change_password: true,
          }
        : {}),
    },
  }

  if (password) {
    authUpdates.password = password
  }

  const { error: authUpdateError } =
    await adminClient.auth.admin.updateUserById(
      targetUserId,
      authUpdates,
    )

  if (authUpdateError) {
    console.error(
      'Organization Auth user update failed:',
      authUpdateError,
    )

    return jsonResponse(
      {
        error:
          authUpdateError.message ||
          'The authentication account could not be updated.',
      },
      400,
    )
  }

  const { error: profileUpdateError } =
    await adminClient
      .from('profiles')
      .upsert(
        {
          id: targetUserId,
          full_name: fullName,
          email,
          account_email: email,
          account_type: 'organization',
          organization_id: organizationId,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'id',
        },
      )

  if (profileUpdateError) {
    console.error(
      'Organization profile update failed:',
      profileUpdateError,
    )

    return jsonResponse(
      {
        error:
          'The authentication account was updated, but the user profile could not be saved.',
      },
      500,
    )
  }

  return jsonResponse(
    {
      message: password
        ? 'Name, email, and password updated successfully.'
        : 'Name and email updated successfully.',
      fullName,
      email,
      passwordChanged: Boolean(password),
    },
    200,
  )
})