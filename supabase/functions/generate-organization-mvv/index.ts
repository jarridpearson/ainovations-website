import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

const portalCreditCost = 1

type GenerateMvvRequest = {
  organizationId: string
  organizationName: string
  organizationPurpose: string
  customersServed: string
  productsOrServices: string
  futureDirection: string
  operatingPrinciples: string
}

type OpenAiResponse = {
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
    }>
  }>
  error?: {
    message?: string
  }
}

type PortalCreditConsumptionResult = {
  portal_credits_available: number
  portal_credits_used: number
  portal_credit_renewal_date: string | null
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

function normalizeRequiredText(
  value: unknown,
  fieldName: string,
) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(fieldName)
  }

  return value.trim()
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

  try {
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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseAnonKey =
      Deno.env.get('SUPABASE_ANON_KEY')
    const supabaseServiceRoleKey =
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const openAiApiKey = Deno.env.get(
      'ORGANIZATION_MVV_OPENAI_API_KEY',
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
          error:
            'The organization service is not configured correctly.',
        },
        500,
      )
    }

    if (!openAiApiKey) {
      console.error('OPENAI_API_KEY is missing.')

      return jsonResponse(
        {
          error: 'AI generation is not configured yet.',
        },
        500,
      )
    }

    const authenticatedClient = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authorizationHeader,
          },
        },
      },
    )

    const {
      data: { user },
      error: userError,
    } = await authenticatedClient.auth.getUser()

    if (userError || !user) {
      console.error(
        'Authenticated user could not be verified:',
        userError,
      )

      return jsonResponse(
        {
          error:
            'Your session could not be verified. Sign in again.',
        },
        401,
      )
    }

    const body =
      (await request.json()) as Partial<GenerateMvvRequest>

    let organizationId = ''
    let organizationName = ''
    let organizationPurpose = ''
    let customersServed = ''
    let productsOrServices = ''
    let futureDirection = ''
    let operatingPrinciples = ''

    try {
      organizationId = normalizeRequiredText(
        body.organizationId,
        'Enter the organization ID.',
      )

      organizationName = normalizeRequiredText(
        body.organizationName,
        'Enter the organization name.',
      )

      organizationPurpose = normalizeRequiredText(
        body.organizationPurpose,
        'Describe why the organization exists.',
      )

      customersServed = normalizeRequiredText(
        body.customersServed,
        'Describe who the organization serves.',
      )

      productsOrServices = normalizeRequiredText(
        body.productsOrServices,
        'Describe what the organization provides.',
      )

      futureDirection = normalizeRequiredText(
        body.futureDirection,
        'Describe the future the organization is working toward.',
      )

      operatingPrinciples = normalizeRequiredText(
        body.operatingPrinciples,
        'Describe the principles that guide the organization.',
      )
    } catch (validationError) {
      return jsonResponse(
        {
          error:
            validationError instanceof Error
              ? validationError.message
              : 'Complete all guided questions.',
        },
        400,
      )
    }

    const serviceClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
    )

    const { data: membership, error: membershipError } =
      await serviceClient
        .from('organization_users')
        .select('role, is_active')
        .eq('organization_id', organizationId)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle()

    if (membershipError) {
      console.error(
        'Organization membership lookup failed:',
        membershipError,
      )

      return jsonResponse(
        {
          error:
            'Your organization permissions could not be verified.',
        },
        500,
      )
    }

    if (
      !membership ||
      membership.role !== 'organization_admin'
    ) {
      return jsonResponse(
        {
          error:
            'Only an Organization Admin can generate organization statements.',
        },
        403,
      )
    }

    const {
      data: organizationRecord,
      error: organizationError,
    } = await serviceClient
      .from('organizations')
      .select(
        'current_billing_period_start, current_billing_period_end',
      )
      .eq('id', organizationId)
      .maybeSingle()

    if (organizationError) {
      console.error(
        'Organization billing period lookup failed:',
        organizationError,
      )

      return jsonResponse(
        {
          error:
            'The organization billing period could not be verified.',
        },
        500,
      )
    }

    if (
      !organizationRecord?.current_billing_period_start ||
      !organizationRecord.current_billing_period_end
    ) {
      return jsonResponse(
        {
          error:
            'The organization billing period is not configured.',
        },
        400,
      )
    }

    const billingPeriodStart = new Date(
      organizationRecord.current_billing_period_start,
    )

    const periodKey = [
      billingPeriodStart.getUTCFullYear(),
      String(
        billingPeriodStart.getUTCMonth() + 1,
      ).padStart(2, '0'),
    ].join('-')

    const {
      data: portalCreditLedger,
      error: portalCreditLedgerError,
    } = await serviceClient
      .from('ai_credit_ledger')
      .select(
        `
          monthly_allocation,
          addon_allocation,
          recurring_addon_allocation,
          one_time_top_up_balance,
          used_credits
        `,
      )
      .eq('organization_id', organizationId)
      .is('user_id', null)
      .eq('credit_pool_type', 'portal')
      .eq('period_key', periodKey)
      .maybeSingle()

    if (portalCreditLedgerError) {
      console.error(
        'Portal-credit lookup failed:',
        portalCreditLedgerError,
      )

      return jsonResponse(
        {
          error:
            'The portal AI credit balance could not be verified.',
        },
        500,
      )
    }

    if (!portalCreditLedger) {
      return jsonResponse(
        {
          error:
            'The organization portal-credit pool is not available.',
        },
        400,
      )
    }

    const totalPortalCredits =
      (portalCreditLedger.monthly_allocation ?? 0) +
      (portalCreditLedger.addon_allocation ?? 0) +
      (portalCreditLedger.recurring_addon_allocation ?? 0) +
      (portalCreditLedger.one_time_top_up_balance ?? 0)

    const portalCreditsAvailable = Math.max(
      totalPortalCredits -
        (portalCreditLedger.used_credits ?? 0),
      0,
    )

    if (portalCreditsAvailable < portalCreditCost) {
      return jsonResponse(
        {
          error:
            'Not enough portal AI credits are available. This action requires 1 portal AI credit.',
          portalCreditsAvailable,
          portalCreditCost,
          portalCreditRenewalDate:
            organizationRecord.current_billing_period_end,
        },
        402,
      )
    }

    const prompt = `
Create professional Mission, Vision, and Values statements for the organization below.

Organization name:
${organizationName}

Why the organization exists:
${organizationPurpose}

Who it serves:
${customersServed}

Products or services:
${productsOrServices}

Future direction:
${futureDirection}

Operating principles:
${operatingPrinciples}

Requirements:
- Do not make claims not supported by the supplied information.
- Keep the Mission to one or two clear sentences.
- Keep the Vision to one or two aspirational but realistic sentences.
- Write Values as a concise list of 4 to 7 named principles.
- Each value must include a short explanation.
- Use direct, professional language.
- Do not use buzzwords merely to sound impressive.
- Do not mention AI.
- Return only the required JSON structure.
`.trim()

    const openAiResponse = await fetch(
      'https://api.openai.com/v1/responses',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          store: false,
          input: [
            {
              role: 'system',
              content: [
                {
                  type: 'input_text',
                  text:
                    'You write clear organization Mission, Vision, and Values statements using only the facts supplied by the organization.',
                },
              ],
            },
            {
              role: 'user',
              content: [
                {
                  type: 'input_text',
                  text: prompt,
                },
              ],
            },
          ],
          text: {
            format: {
              type: 'json_schema',
              name: 'organization_mvv',
              strict: true,
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  missionStatement: {
                    type: 'string',
                  },
                  visionStatement: {
                    type: 'string',
                  },
                  valuesStatement: {
                    type: 'string',
                  },
                },
                required: [
                  'missionStatement',
                  'visionStatement',
                  'valuesStatement',
                ],
              },
            },
          },
        }),
      },
    )

    const openAiBody =
      (await openAiResponse.json()) as OpenAiResponse

    if (!openAiResponse.ok) {
      console.error(
        'OpenAI MVV generation failed:',
        openAiBody,
      )

      return jsonResponse(
        {
          error:
            openAiBody.error?.message ||
            'The AI suggestions could not be generated.',
        },
        502,
      )
    }

    const responseText = openAiBody.output
      ?.flatMap((outputItem) => outputItem.content ?? [])
      .find(
        (contentItem) =>
          contentItem.type === 'output_text' &&
          typeof contentItem.text === 'string',
      )?.text

    if (!responseText) {
      console.error(
        'OpenAI returned no structured MVV output:',
        openAiBody,
      )

      return jsonResponse(
        {
          error:
            'The AI response did not contain usable suggestions.',
        },
        502,
      )
    }

    let generatedStatements: {
      missionStatement: string
      visionStatement: string
      valuesStatement: string
    }

    try {
      generatedStatements = JSON.parse(responseText)
    } catch (parseError) {
      console.error(
        'OpenAI MVV JSON could not be parsed:',
        parseError,
        responseText,
      )

      return jsonResponse(
        {
          error: 'The AI response could not be read.',
        },
        502,
      )
    }

    const missionStatement =
      generatedStatements.missionStatement?.trim() ?? ''

    const visionStatement =
      generatedStatements.visionStatement?.trim() ?? ''

    const valuesStatement =
      generatedStatements.valuesStatement?.trim() ?? ''

    if (
      !missionStatement ||
      !visionStatement ||
      !valuesStatement
    ) {
      console.error(
        'OpenAI returned incomplete MVV statements:',
        generatedStatements,
      )

      return jsonResponse(
        {
          error:
            'The AI response did not contain complete Mission, Vision, and Values suggestions.',
        },
        502,
      )
    }

    const {
      data: consumptionData,
      error: consumptionError,
    } = await serviceClient.rpc(
      'consume_organization_portal_credits',
      {
        p_organization_id: organizationId,
        p_user_id: user.id,
        p_credit_cost: portalCreditCost,
        p_event_type: 'ai_generation',
        p_feature_key: 'organization_mvv_generation',
        p_route: '/organization/settings',
        p_metadata: {
          organization_name: organizationName,
        },
      },
    )

    if (consumptionError) {
      console.error(
        'Portal-credit consumption failed:',
        consumptionError,
      )

      return jsonResponse(
        {
          error:
            consumptionError.message ||
            'The portal AI credit could not be applied.',
        },
        409,
      )
    }

    const consumptionResult =
      (
        consumptionData as PortalCreditConsumptionResult[] | null
      )?.[0] ?? null

    if (!consumptionResult) {
      console.error(
        'Portal-credit consumption returned no result:',
        consumptionData,
      )

      return jsonResponse(
        {
          error:
            'The updated portal AI credit balance could not be confirmed.',
        },
        500,
      )
    }

    return jsonResponse(
      {
        missionStatement,
        visionStatement,
        valuesStatement,
        portalCreditsAvailable:
          consumptionResult.portal_credits_available,
        portalCreditsUsed:
          consumptionResult.portal_credits_used,
        portalCreditRenewalDate:
          consumptionResult.portal_credit_renewal_date,
        portalCreditCost,
      },
      200,
    )
  } catch (error) {
    console.error(
      'Unexpected organization MVV generation error:',
      error,
    )

    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : 'The AI suggestions could not be generated.',
      },
      500,
    )
  }
})