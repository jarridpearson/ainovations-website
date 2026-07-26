import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const validRoles = new Set([
  'organization_admin',
  'billing_admin',
  'user_admin',
  'group_manager',
  'view_only',
  'member',
])

type RequestedUser = {
  fullName?: unknown
  email?: unknown
  password?: unknown
  role?: unknown
  billingAccessEnabled?: unknown
  primaryGroupId?: unknown
}

type CreateUsersRequest = {
  organizationId?: unknown
  users?: unknown
}

type ValidatedUser = {
  fullName: string
  email: string
  password: string
  role: string
  billingAccessEnabled: boolean
  primaryGroupId: string
}

type CreationResult = {
  email: string
  fullName: string
  success: boolean
  userId?: string
  error?: string
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

function normalizeRole(value: unknown) {
  if (typeof value !== 'string') {
    return 'member'
  }

  const normalized = value.trim().toLowerCase()

  return validRoles.has(normalized) ? normalized : 'member'
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
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('Required Supabase environment variables are missing.')

    return jsonResponse(
      {
        error: 'The user creation service is not configured.',
      },
      500,
    )
  }

  const authorizationHeader = request.headers.get('Authorization')

  if (!authorizationHeader) {
    return jsonResponse(
      {
        error: 'You must be signed in.',
      },
      401,
    )
  }

  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: authorizationHeader,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

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

  let requestBody: CreateUsersRequest

  try {
    requestBody = (await request.json()) as CreateUsersRequest
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

  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse(
      {
        error: 'A valid organization ID is required.',
      },
      400,
    )
  }

  if (!Array.isArray(requestBody.users) || requestBody.users.length === 0) {
    return jsonResponse(
      {
        error: 'At least one user is required.',
      },
      400,
    )
  }

  if (requestBody.users.length > 500) {
    return jsonResponse(
      {
        error: 'A maximum of 500 users can be created in one submission.',
      },
      400,
    )
  }

  const [membershipResult, organizationResult] = await Promise.all([
    adminClient
      .from('organization_users')
      .select('id, role, is_active')
      .eq('organization_id', organizationId)
      .eq('user_id', caller.id)
      .eq('is_active', true)
      .maybeSingle(),
    adminClient
      .from('organizations')
      .select('paid_seat_count')
      .eq('id', organizationId)
      .maybeSingle(),
  ])

  if (
    membershipResult.error ||
    !membershipResult.data ||
    !['organization_admin', 'user_admin'].includes(
      membershipResult.data.role,
    )
  ) {
    return jsonResponse(
      {
        error:
          'Only an active Organization Admin or User Admin can create organization users.',
      },
      403,
    )
  }

  if (organizationResult.error || !organizationResult.data) {
    console.error(
      'Organization seat allowance failed to load:',
      organizationResult.error,
    )

    return jsonResponse(
      {
        error: 'Unable to determine the organization seat allowance.',
      },
      500,
    )
  }

  const paidSeatCount = Math.max(
    0,
    Number(organizationResult.data.paid_seat_count ?? 0),
  )

  const validatedUsers: ValidatedUser[] = []
  const validationErrors: Array<{
    row: number
    field: string
    message: string
  }> = []

  const submittedEmails = new Set<string>()

  requestBody.users.forEach((rawUser, index) => {
    const row = index + 1
    const user = rawUser as RequestedUser

    const fullName =
      typeof user.fullName === 'string' ? user.fullName.trim() : ''

    const email =
      typeof user.email === 'string' ? normalizeEmail(user.email) : ''

    const password =
      typeof user.password === 'string' ? user.password : ''

    const primaryGroupId =
      typeof user.primaryGroupId === 'string'
        ? user.primaryGroupId.trim()
        : ''

    const role = normalizeRole(user.role)

    const billingAccessEnabled =
      role === 'billing_admin' ||
      user.billingAccessEnabled === true

    if (!fullName) {
      validationErrors.push({
        row,
        field: 'full_name',
        message: 'Full Name is required.',
      })
    }

    if (!email) {
      validationErrors.push({
        row,
        field: 'email_address',
        message: 'Email Address is required.',
      })
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      validationErrors.push({
        row,
        field: 'email_address',
        message: `"${email}" is not a valid email address.`,
      })
    } else if (submittedEmails.has(email)) {
      validationErrors.push({
        row,
        field: 'email_address',
        message: `"${email}" appears more than once in this submission.`,
      })
    } else {
      submittedEmails.add(email)
    }

    if (!password) {
      validationErrors.push({
        row,
        field: 'password',
        message: 'Password is required.',
      })
    } else if (password.length < 8) {
      validationErrors.push({
        row,
        field: 'password',
        message: 'Password must contain at least 8 characters.',
      })
    }

    if (!primaryGroupId) {
      validationErrors.push({
        row,
        field: 'primary_group',
        message: 'Primary Group is required.',
      })
    } else if (!isUuid(primaryGroupId)) {
      validationErrors.push({
        row,
        field: 'primary_group',
        message: 'Primary Group does not contain a valid group ID.',
      })
    }

    validatedUsers.push({
      fullName,
      email,
      password,
      role,
      billingAccessEnabled,
      primaryGroupId,
    })
  })

  if (validationErrors.length > 0) {
    return jsonResponse(
      {
        error: 'One or more user fields are invalid.',
        validationErrors,
      },
      400,
    )
  }

  const uniqueGroupIds = [
    ...new Set(validatedUsers.map((user) => user.primaryGroupId)),
  ]

  const { data: matchingGroups, error: groupsError } = await adminClient
    .from('organization_groups')
    .select('id, name')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .in('id', uniqueGroupIds)

  if (groupsError) {
    console.error('Organization group validation failed:', groupsError)

    return jsonResponse(
      {
        error: 'Unable to validate the selected organization groups.',
      },
      500,
    )
  }

  const matchingGroupIds = new Set(
    (matchingGroups ?? []).map((group) => group.id),
  )

  const invalidGroupUsers = validatedUsers
    .map((user, index) => ({
      row: index + 1,
      email: user.email,
      primaryGroupId: user.primaryGroupId,
    }))
    .filter((user) => !matchingGroupIds.has(user.primaryGroupId))

  if (invalidGroupUsers.length > 0) {
    return jsonResponse(
      {
        error:
          'One or more Primary Group values do not match an active group in this organization.',
        invalidGroups: invalidGroupUsers,
        validGroups: matchingGroups ?? [],
      },
      400,
    )
  }

  const { count: activeBillableUserCount, error: seatCountError } =
    await adminClient
      .from('organization_users')
      .select('id', {
        count: 'exact',
        head: true,
      })
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .eq('is_billable', true)

  if (seatCountError) {
    console.error('Organization seat usage failed to load:', seatCountError)

    return jsonResponse(
      {
        error: 'Unable to determine the current organization seat usage.',
      },
      500,
    )
  }

  const usedSeatCount = activeBillableUserCount ?? 0
  const availableSeatCount = Math.max(0, paidSeatCount - usedSeatCount)
  const results: CreationResult[] = []

  for (const [userIndex, submittedUser] of validatedUsers.entries()) {
    if (userIndex >= availableSeatCount) {
      results.push({
        email: submittedUser.email,
        fullName: submittedUser.fullName,
        success: false,
        error:
          'No purchased seat is available. Add another seat in Billing and resubmit this user.',
      })

      continue
    }
    let createdAuthUserId = ''

    try {
      const { data: authResult, error: authError } =
        await adminClient.auth.admin.createUser({
          email: submittedUser.email,
          password: submittedUser.password,
          email_confirm: true,
          user_metadata: {
            full_name: submittedUser.fullName,
            account_type: 'organization',
            organization_id: organizationId,
            organization_role: submittedUser.role,
            must_change_password: true,
          },
        })

      if (authError || !authResult.user) {
        results.push({
          email: submittedUser.email,
          fullName: submittedUser.fullName,
          success: false,
          error:
            authError?.message ??
            'Supabase Auth did not return the created user.',
        })

        continue
      }

      createdAuthUserId = authResult.user.id

      const { error: profileError } = await adminClient.from('profiles').upsert(
        {
          id: createdAuthUserId,
          email: submittedUser.email,
          account_email: submittedUser.email,
          full_name: submittedUser.fullName,
          account_type: 'organization',
          organization_id: organizationId,
          subscription_tier: 'organization',
          subscription_status: 'active',
          role: submittedUser.role,
          onboarding_state: 'pending',
          auth_provider: 'email',
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'id',
        },
      )

      if (profileError) {
        throw new Error(`Profile creation failed: ${profileError.message}`)
      }

      const { error: membershipInsertError } = await adminClient
        .from('organization_users')
        .insert({
          user_id: createdAuthUserId,
          organization_id: organizationId,
          role: submittedUser.role,
          billing_access_enabled:
            submittedUser.billingAccessEnabled,
          is_billable: true,
          is_active: true,
          can_create_goals: submittedUser.role !== 'view_only',
          can_assign_goals:
            submittedUser.role === 'organization_admin' ||
            submittedUser.role === 'group_manager',
          can_add_users:
            submittedUser.role === 'organization_admin' ||
            submittedUser.role === 'user_admin',
          can_remove_users:
            submittedUser.role === 'organization_admin' ||
            submittedUser.role === 'user_admin',
          can_manage_groups:
            submittedUser.role === 'organization_admin' ||
            submittedUser.role === 'group_manager',
          can_assign_admins:
            submittedUser.role === 'organization_admin',
          can_purchase_seats:
            submittedUser.role === 'organization_admin' ||
            submittedUser.billingAccessEnabled,
          can_view_ai_credits:
            submittedUser.role === 'organization_admin' ||
            submittedUser.billingAccessEnabled,
          updated_at: new Date().toISOString(),
        })

      if (membershipInsertError) {
        throw new Error(
          `Organization membership creation failed: ${membershipInsertError.message}`,
        )
      }

      const { error: groupMembershipError } = await adminClient
        .from('organization_group_users')
        .insert({
          organization_id: organizationId,
          group_id: submittedUser.primaryGroupId,
          user_id: createdAuthUserId,
          is_primary: true,
          is_active: true,
          updated_at: new Date().toISOString(),
        })

      if (groupMembershipError) {
        throw new Error(
          `Primary group assignment failed: ${groupMembershipError.message}`,
        )
      }

      if (submittedUser.role === 'group_manager') {
        const { error: groupAdminError } = await adminClient
          .from('organization_group_admins')
          .insert({
            organization_id: organizationId,
            group_id: submittedUser.primaryGroupId,
            user_id: createdAuthUserId,
            admin_role: 'manager',
            is_active: true,
            updated_at: new Date().toISOString(),
          })

        if (groupAdminError) {
          throw new Error(
            `Group Manager assignment failed: ${groupAdminError.message}`,
          )
        }
      }

      results.push({
        email: submittedUser.email,
        fullName: submittedUser.fullName,
        success: true,
        userId: createdAuthUserId,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'An unknown user creation error occurred.'

      console.error('Organization user creation failed:', {
        email: submittedUser.email,
        error: message,
      })

      if (createdAuthUserId) {
        await adminClient
          .from('organization_group_admins')
          .delete()
          .eq('user_id', createdAuthUserId)
          .eq('organization_id', organizationId)

        await adminClient
          .from('organization_group_users')
          .delete()
          .eq('user_id', createdAuthUserId)
          .eq('organization_id', organizationId)

        await adminClient
          .from('organization_users')
          .delete()
          .eq('user_id', createdAuthUserId)
          .eq('organization_id', organizationId)

        await adminClient
          .from('profiles')
          .delete()
          .eq('id', createdAuthUserId)

        await adminClient.auth.admin.deleteUser(createdAuthUserId)
      }

      results.push({
        email: submittedUser.email,
        fullName: submittedUser.fullName,
        success: false,
        error: message,
      })
    }
  }

  const successfulUsers = results.filter((result) => result.success)
  const failedUsers = results.filter((result) => !result.success)

  return jsonResponse(
    {
      message:
        failedUsers.length === 0
          ? `${successfulUsers.length} user${
              successfulUsers.length === 1 ? '' : 's'
            } created successfully.`
          : `${successfulUsers.length} user${
              successfulUsers.length === 1 ? '' : 's'
            } created and ${failedUsers.length} failed.`,
      successfulCount: successfulUsers.length,
      failedCount: failedUsers.length,
      purchasedSeatCount: paidSeatCount,
      previouslyUsedSeatCount: usedSeatCount,
      availableSeatCountBeforeCreation: availableSeatCount,
      availableSeatCountAfterCreation: Math.max(
        0,
        availableSeatCount - successfulUsers.length,
      ),
      results,
    },
    failedUsers.length === 0 ? 200 : 207,
  )
})