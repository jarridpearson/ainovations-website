import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import OrganizationUserSetup from './OrganizationUserSetup'

type BillingInterval = 'monthly' | 'annual'
type MissionVisionValuesChoice = 'enter' | 'ai' | 'skip'
type SetupView = 'foundation' | 'groups' | 'users'

type OrganizationPlan = {
  plan_key: string
  plan_name: string
  portal_monthly_price_cents: number
  portal_annual_price_cents: number
  per_user_monthly_price_cents: number
  per_user_annual_price_cents: number
  included_admin_ai_credits_monthly: number
  included_user_ai_credits_monthly: number
  company_document_limit: number
  allowed_company_document_types: string[]
  allows_company_activity_questions: boolean
  allows_advanced_reporting: boolean
  allows_full_data_export: boolean
}

type OrganizationGroup = {
  id: string
  organization_id: string
  name: string
  slug: string | null
  parent_group_id: string | null
  description: string | null
  is_active: boolean
}

type DisplayGroup = OrganizationGroup & {
  depth: number
}

type OrganizationSetupProps = {
  organizationId: string
  organizationName: string
  initialMission: string
  initialVision: string
  initialValues: string
  onSetupComplete: (details: {
    organizationName: string
    missionStatement: string
    visionStatement: string
    valuesStatement: string
  }) => void
}

type SetupErrors = {
  organizationName?: string
  selectedPlanKey?: string
}

type GroupErrors = {
  groupName?: string
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function createSlug(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return `${normalized || 'group'}-${Date.now()}`
}

function OrganizationSetup({
  organizationId,
  organizationName: initialOrganizationName,
  initialMission,
  initialVision,
  initialValues,
  onSetupComplete,
}: OrganizationSetupProps) {
  const [setupView, setSetupView] = useState<SetupView>('foundation')
  const [organizationName, setOrganizationName] = useState(
    initialOrganizationName,
  )
  const [plans, setPlans] = useState<OrganizationPlan[]>([])
  const [selectedPlanKey, setSelectedPlanKey] = useState('')
  const [billingInterval, setBillingInterval] =
    useState<BillingInterval>('monthly')
  const [mvvChoice, setMvvChoice] =
    useState<MissionVisionValuesChoice>('skip')
  const [missionStatement, setMissionStatement] = useState(initialMission)
  const [visionStatement, setVisionStatement] = useState(initialVision)
  const [valuesStatement, setValuesStatement] = useState(initialValues)
  const [errors, setErrors] = useState<SetupErrors>({})
  const [message, setMessage] = useState('')
  const [isLoadingSetup, setIsLoadingSetup] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  const [groups, setGroups] = useState<OrganizationGroup[]>([])
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [parentGroupId, setParentGroupId] = useState('')
  const [groupErrors, setGroupErrors] = useState<GroupErrors>({})
  const [groupMessage, setGroupMessage] = useState('')
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [isContinuingFromGroups, setIsContinuingFromGroups] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadSetupData() {
      setIsLoadingSetup(true)

      const [plansResult, organizationResult, groupsResult] = await Promise.all([
        supabase
          .from('subscription_plans')
          .select(
            `
              plan_key,
              plan_name,
              portal_monthly_price_cents,
              portal_annual_price_cents,
              per_user_monthly_price_cents,
              per_user_annual_price_cents,
              included_admin_ai_credits_monthly,
              included_user_ai_credits_monthly,
              company_document_limit,
              allowed_company_document_types,
              allows_company_activity_questions,
              allows_advanced_reporting,
              allows_full_data_export
            `,
          )
          .in('plan_key', ['organization_starter', 'organization_pro'])
          .eq('active', true)
          .order('portal_monthly_price_cents'),
        supabase
          .from('organizations')
          .select('current_plan_key, billing_interval, onboarding_stage')
          .eq('id', organizationId)
          .maybeSingle(),
        supabase
          .from('organization_groups')
          .select(
            `
              id,
              organization_id,
              name,
              slug,
              parent_group_id,
              description,
              is_active
            `,
          )
          .eq('organization_id', organizationId)
          .eq('is_active', true)
          .order('name'),
      ])

      if (!isMounted) {
        return
      }

      if (plansResult.error) {
        console.error('Organization plans failed to load:', plansResult.error)
        setMessage('Unable to load organization plans. Refresh and try again.')
        setIsLoadingSetup(false)
        return
      }

      if (organizationResult.error) {
        console.error(
          'Organization setup progress failed to load:',
          organizationResult.error,
        )
        setMessage('Unable to load organization onboarding progress.')
        setIsLoadingSetup(false)
        return
      }

      if (groupsResult.error) {
        console.error('Organization groups failed to load:', groupsResult.error)
        setGroupMessage('Unable to load organization groups.')
      }

      const availablePlans = (plansResult.data ?? []) as OrganizationPlan[]
      const savedPlanKey = organizationResult.data?.current_plan_key ?? ''
      const savedBillingInterval =
        organizationResult.data?.billing_interval === 'annual'
          ? 'annual'
          : 'monthly'
      const savedOnboardingStage =
        organizationResult.data?.onboarding_stage ?? 'not_started'

      setPlans(availablePlans)
      setSelectedPlanKey(
        availablePlans.some((plan) => plan.plan_key === savedPlanKey)
          ? savedPlanKey
          : '',
      )
      setBillingInterval(savedBillingInterval)
      setGroups((groupsResult.data ?? []) as OrganizationGroup[])

      const hasExistingMvv =
        Boolean(initialMission.trim()) ||
        Boolean(initialVision.trim()) ||
        Boolean(initialValues.trim())

      if (hasExistingMvv) {
        setMvvChoice('enter')
      }

      if (savedOnboardingStage === 'groups_saved') {
        setSetupView('users')
      } else if (savedOnboardingStage === 'foundation_saved') {
        setSetupView('groups')
      }

      setIsLoadingSetup(false)
    }

    void loadSetupData()

    return () => {
      isMounted = false
    }
  }, [organizationId, initialMission, initialValues, initialVision])

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.plan_key === selectedPlanKey) ?? null,
    [plans, selectedPlanKey],
  )

  const displayGroups = useMemo(() => {
    const activeGroups = groups.filter((group) => group.is_active)
    const groupsByParent = new Map<string | null, OrganizationGroup[]>()

    activeGroups.forEach((group) => {
      const parentKey = group.parent_group_id ?? null
      const existing = groupsByParent.get(parentKey) ?? []
      existing.push(group)
      groupsByParent.set(parentKey, existing)
    })

    groupsByParent.forEach((groupList) => {
      groupList.sort((first, second) => first.name.localeCompare(second.name))
    })

    const flattened: DisplayGroup[] = []
    const visited = new Set<string>()

    function addGroupAndChildren(group: OrganizationGroup, depth: number) {
      if (visited.has(group.id)) {
        return
      }

      visited.add(group.id)
      flattened.push({
        ...group,
        depth,
      })

      const children = groupsByParent.get(group.id) ?? []

      children.forEach((child) => {
        addGroupAndChildren(child, depth + 1)
      })
    }

    const rootGroups = groupsByParent.get(null) ?? []

    rootGroups.forEach((group) => {
      addGroupAndChildren(group, 0)
    })

    activeGroups.forEach((group) => {
      if (!visited.has(group.id)) {
        addGroupAndChildren(group, 0)
      }
    })

    return flattened
  }, [groups])

  function getPortalPrice(plan: OrganizationPlan) {
    return billingInterval === 'annual'
      ? plan.portal_annual_price_cents
      : plan.portal_monthly_price_cents
  }

  function getUserPrice(plan: OrganizationPlan) {
    return billingInterval === 'annual'
      ? plan.per_user_annual_price_cents
      : plan.per_user_monthly_price_cents
  }

  function getBillingLabel() {
    return billingInterval === 'annual' ? 'per year' : 'per month'
  }

  function getUserBillingLabel() {
    return billingInterval === 'annual'
      ? 'per user, per year'
      : 'per user, per month'
  }

  async function handleFoundationSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    const nextErrors: SetupErrors = {}
    const normalizedName = organizationName.trim()

    if (!normalizedName) {
      nextErrors.organizationName = 'Enter the organization name.'
    }

    if (!selectedPlanKey) {
      nextErrors.selectedPlanKey = 'Select Organization Starter or Pro.'
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setMessage('Complete the required organization and plan fields.')
      return
    }

    setIsSaving(true)
    setMessage('Saving onboarding progress...')

    const shouldSaveMvv = mvvChoice === 'enter'

    const { error } = await supabase
      .from('organizations')
      .update({
        name: normalizedName,
        current_plan_key: selectedPlanKey,
        billing_interval: billingInterval,
        mission_statement: shouldSaveMvv ? missionStatement.trim() : null,
        vision_statement: shouldSaveMvv ? visionStatement.trim() : null,
        values_statement: shouldSaveMvv ? valuesStatement.trim() : null,
        onboarding_stage: 'foundation_saved',
        setup_complete: false,
      })
      .eq('id', organizationId)

    if (error) {
      console.error('Organization onboarding save failed:', error)
      setMessage('Unable to save onboarding progress. Try again.')
      setIsSaving(false)
      return
    }

    setMessage('')
    setIsSaving(false)
    setSetupView('groups')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const normalizedName = groupName.trim()
    const normalizedDescription = groupDescription.trim()
    const nextErrors: GroupErrors = {}

    if (!normalizedName) {
      nextErrors.groupName = 'Enter a group name.'
    }

    setGroupErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setGroupMessage('Enter the required group information.')
      return
    }

    setIsCreatingGroup(true)
    setGroupMessage('Creating group...')

    const { data, error } = await supabase
      .from('organization_groups')
      .insert({
        organization_id: organizationId,
        name: normalizedName,
        slug: createSlug(normalizedName),
        parent_group_id: parentGroupId || null,
        description: normalizedDescription || null,
        is_active: true,
      })
      .select(
        `
          id,
          organization_id,
          name,
          slug,
          parent_group_id,
          description,
          is_active
        `,
      )
      .single()

    if (error) {
      console.error('Organization group creation failed:', error)
      setGroupMessage('Unable to create the group. Try again.')
      setIsCreatingGroup(false)
      return
    }

    setGroups((current) => [...current, data as OrganizationGroup])
    setGroupName('')
    setGroupDescription('')
    setParentGroupId('')
    setGroupErrors({})
    setGroupMessage(`${normalizedName} was added successfully.`)
    setIsCreatingGroup(false)
  }

  async function handleContinueFromGroups() {
    if (groups.length === 0) {
      setGroupMessage('Create at least one group before continuing.')
      return
    }

    setIsContinuingFromGroups(true)
    setGroupMessage('Saving group setup...')

    const { error } = await supabase
      .from('organizations')
      .update({
        onboarding_stage: 'groups_saved',
        setup_complete: false,
      })
      .eq('id', organizationId)

    if (error) {
      console.error('Group onboarding stage save failed:', error)
      setGroupMessage('Unable to save the group setup. Try again.')
      setIsContinuingFromGroups(false)
      return
    }

    setGroupMessage('')
    setIsContinuingFromGroups(false)
    setSetupView('users')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleFinishSetup() {
    const { error } = await supabase
      .from('organizations')
      .update({
        onboarding_stage: 'complete',
        setup_complete: true,
      })
      .eq('id', organizationId)

    if (error) {
      console.error('Organization setup completion failed:', error)
      throw new Error('Unable to complete organization setup. Try again.')
    }

    onSetupComplete({
      organizationName: organizationName.trim(),
      missionStatement:
        mvvChoice === 'enter' ? missionStatement.trim() : '',
      visionStatement:
        mvvChoice === 'enter' ? visionStatement.trim() : '',
      valuesStatement:
        mvvChoice === 'enter' ? valuesStatement.trim() : '',
    })
  }

  if (isLoadingSetup) {
    return (
      <section className="organization-setup">
        <div className="setup-heading">
          <p className="eyebrow">Organization onboarding</p>
          <h1>Loading your organization setup...</h1>
        </div>
      </section>
    )
  }
  if (setupView === 'users') {
    return (
      <OrganizationUserSetup
        organizationId={organizationId}
        onFinishSetup={handleFinishSetup}
        onBack={() => {
          setSetupView('groups')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
      />
    )
  }
  if (setupView === 'groups') {
    return (
      <section className="organization-setup">
        <div className="setup-heading">
          <p className="eyebrow">Organization onboarding</p>
          <h1>Create your organization structure.</h1>
          <p>
            Add departments, teams, locations, or other management groups.
            Parent groups create the hierarchy used later for reporting,
            permissions, and authorized management access.
          </p>
        </div>

        <div className="setup-form">
          <section className="setup-section">
            <div className="setup-section-heading">
              <span className="setup-step-number">4</span>

              <div>
                <h2>Create groups</h2>
                <p>
                  Begin with top-level groups, then place teams or departments
                  beneath them as needed.
                </p>
              </div>
            </div>

            <form
              className="group-creation-form"
              onSubmit={handleCreateGroup}
              noValidate
            >
              <div className="setup-field">
                <label htmlFor="group-name">Group name</label>

                <input
                  id="group-name"
                  name="groupName"
                  type="text"
                  placeholder="Example: Sales"
                  value={groupName}
                  disabled={isCreatingGroup || isContinuingFromGroups}
                  aria-invalid={Boolean(groupErrors.groupName)}
                  aria-describedby={
                    groupErrors.groupName ? 'group-name-error' : undefined
                  }
                  onChange={(event) => {
                    setGroupName(event.target.value)
                    setGroupErrors((current) => ({
                      ...current,
                      groupName: undefined,
                    }))
                    setGroupMessage('')
                  }}
                />

                {groupErrors.groupName ? (
                  <p id="group-name-error" className="field-error">
                    {groupErrors.groupName}
                  </p>
                ) : null}
              </div>

              <div className="setup-field">
                <label htmlFor="parent-group">Parent group</label>

                <select
                  id="parent-group"
                  name="parentGroup"
                  value={parentGroupId}
                  disabled={isCreatingGroup || isContinuingFromGroups}
                  onChange={(event) => {
                    setParentGroupId(event.target.value)
                    setGroupMessage('')
                  }}
                >
                  <option value="">No parent — top-level group</option>

                  {displayGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {`${'— '.repeat(group.depth)}${group.name}`}
                    </option>
                  ))}
                </select>

                <p className="setup-help">
                  Select a parent only when this group reports beneath another
                  group.
                </p>
              </div>

              <div className="setup-field">
                <label htmlFor="group-description">
                  Description <span className="optional-label">Optional</span>
                </label>

                <textarea
                  id="group-description"
                  name="groupDescription"
                  rows={4}
                  placeholder="Describe the purpose or responsibility of this group."
                  value={groupDescription}
                  disabled={isCreatingGroup || isContinuingFromGroups}
                  onChange={(event) => {
                    setGroupDescription(event.target.value)
                    setGroupMessage('')
                  }}
                />
              </div>

              <button
                className="primary-button group-add-button"
                type="submit"
                disabled={isCreatingGroup || isContinuingFromGroups}
              >
                {isCreatingGroup ? 'Saving group...' : 'Save group'}
              </button>
            </form>
          </section>

          <section className="setup-section">
            <div className="setup-section-heading">
              <span className="setup-step-number">5</span>

              <div>
                <h2>Review group hierarchy</h2>
                <p>
                  This structure will be used when users, managers, permissions,
                  reporting, and status indicators are assigned.
                </p>
              </div>
            </div>

            {displayGroups.length === 0 ? (
              <div className="groups-empty-state">
                <strong>No groups created yet</strong>
                <p>
                  Add the first department, team, location, or management group
                  above.
                </p>
              </div>
            ) : (
              <div className="group-hierarchy-list">
                {displayGroups.map((group) => (
                  <article
                    key={group.id}
                    className="group-hierarchy-item"
                    style={{
                      marginLeft: `${Math.min(group.depth, 5) * 28}px`,
                    }}
                  >
                    <div className="group-hierarchy-marker" />

                    <div>
                      <strong>{group.name}</strong>

                      <span>
                        {group.parent_group_id
                          ? `Reports under ${
                              groups.find(
                                (candidate) =>
                                  candidate.id === group.parent_group_id,
                              )?.name ?? 'another group'
                            }`
                          : 'Top-level group'}
                      </span>

                      {group.description ? <p>{group.description}</p> : null}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="setup-actions">
            <button
              className="primary-button"
              type="button"
              disabled={
                isCreatingGroup ||
                isContinuingFromGroups ||
                displayGroups.length === 0
              }
              onClick={handleContinueFromGroups}
            >
              {isContinuingFromGroups
                ? 'Saving group structure...'
                : 'Save group structure and continue to users'}
            </button>

            <button
              className="text-button setup-back-button"
              type="button"
              disabled={isCreatingGroup || isContinuingFromGroups}
              onClick={() => {
                setSetupView('foundation')
                setGroupMessage('')
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            >
              Back to organization foundation
            </button>

            {groupMessage ? (
              <p className="form-message" role="status">
                {groupMessage}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="organization-setup">
      <div className="setup-heading">
        <p className="eyebrow">Organization onboarding</p>
        <h1>Set up Everward for your organization.</h1>
        <p>
          Choose the plan, billing schedule, and organization foundation that
          fit your business. This step saves progress but does not activate the
          organization.
        </p>
      </div>

      <form
        className="setup-form"
        onSubmit={handleFoundationSubmit}
        noValidate
      >
        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">1</span>

            <div>
              <h2>Organization details</h2>
              <p>Confirm the name employees will see throughout Everward.</p>
            </div>
          </div>

          <div className="setup-field">
            <label htmlFor="organization-name">Organization name</label>

            <input
              id="organization-name"
              name="organizationName"
              type="text"
              value={organizationName}
              disabled={isSaving}
              aria-invalid={Boolean(errors.organizationName)}
              aria-describedby={
                errors.organizationName
                  ? 'organization-name-error'
                  : 'organization-name-help'
              }
              onChange={(event) => {
                setOrganizationName(event.target.value)
                setErrors((current) => ({
                  ...current,
                  organizationName: undefined,
                }))
                setMessage('')
              }}
            />

            <p id="organization-name-help" className="setup-help">
              This can be changed later by an authorized organization admin.
            </p>

            {errors.organizationName ? (
              <p id="organization-name-error" className="field-error">
                {errors.organizationName}
              </p>
            ) : null}
          </div>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">2</span>

            <div>
              <h2>Select an organization plan</h2>
              <p>
                The fixed portal charge is combined with the per-user charge.
                Extra AI credits can be purchased when needed.
              </p>
            </div>
          </div>

          <div className="billing-toggle" aria-label="Billing interval">
            <button
              className={
                billingInterval === 'monthly'
                  ? 'billing-option billing-option-active'
                  : 'billing-option'
              }
              type="button"
              disabled={isSaving}
              onClick={() => {
                setBillingInterval('monthly')
                setMessage('')
              }}
            >
              Monthly
            </button>

            <button
              className={
                billingInterval === 'annual'
                  ? 'billing-option billing-option-active'
                  : 'billing-option'
              }
              type="button"
              disabled={isSaving}
              onClick={() => {
                setBillingInterval('annual')
                setMessage('')
              }}
            >
              Annual
              <span>Two months free</span>
            </button>
          </div>

          <div className="plan-selection-grid">
            {plans.map((plan) => {
              const isSelected = selectedPlanKey === plan.plan_key
              const isPro = plan.plan_key === 'organization_pro'

              return (
                <button
                  key={plan.plan_key}
                  className={
                    isSelected
                      ? 'plan-selection-card plan-selection-card-selected'
                      : 'plan-selection-card'
                  }
                  type="button"
                  disabled={isSaving}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedPlanKey(plan.plan_key)
                    setErrors((current) => ({
                      ...current,
                      selectedPlanKey: undefined,
                    }))
                    setMessage('')
                  }}
                >
                  <span className="plan-name">{plan.plan_name}</span>

                  <strong className="plan-portal-price">
                    {formatCurrency(getPortalPrice(plan))}
                    <small>{getBillingLabel()} portal base</small>
                  </strong>

                  <strong className="plan-user-price">
                    + {formatCurrency(getUserPrice(plan))}
                    <small>{getUserBillingLabel()}</small>
                  </strong>

                  <ul className="plan-feature-list">
                    <li>
                      {plan.included_admin_ai_credits_monthly} monthly
                      admin-portal AI credits
                    </li>
                    <li>
                      {plan.included_user_ai_credits_monthly} monthly AI credits
                      per user
                    </li>
                    <li>Basic reporting and full data export</li>
                    <li>
                      {plan.company_document_limit === 1
                        ? 'One company Word document'
                        : `Up to ${plan.company_document_limit} company documents`}
                    </li>
                    <li>
                      Users can ask AI about their own data and approved company
                      content
                    </li>

                    {isPro ? (
                      <>
                        <li>Advanced reporting and executive outputs</li>
                        <li>
                          Authorized portal admins can ask AI about permitted
                          company activity
                        </li>
                      </>
                    ) : null}
                  </ul>

                  <span className="plan-select-label">
                    {isSelected ? 'Selected' : `Choose ${plan.plan_name}`}
                  </span>
                </button>
              )
            })}
          </div>

          {errors.selectedPlanKey ? (
            <p className="field-error">{errors.selectedPlanKey}</p>
          ) : null}

          {selectedPlan ? (
            <div className="selected-plan-summary">
              <strong>{selectedPlan.plan_name} selected</strong>
              <span>
                {formatCurrency(getPortalPrice(selectedPlan))}{' '}
                {getBillingLabel()} plus{' '}
                {formatCurrency(getUserPrice(selectedPlan))}{' '}
                {getUserBillingLabel()}.
              </span>
            </div>
          ) : null}
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            <span className="setup-step-number">3</span>

            <div>
              <h2>Mission, Vision, and Values</h2>
              <p>
                This section is optional. When provided, these statements will
                be visible to organization users and can help Everward keep AI
                guidance aligned with the organization’s purpose and
                principles.
              </p>
            </div>
          </div>

          <div className="mvv-choice-grid">
            <button
              className={
                mvvChoice === 'enter'
                  ? 'mvv-choice mvv-choice-selected'
                  : 'mvv-choice'
              }
              type="button"
              disabled={isSaving}
              aria-pressed={mvvChoice === 'enter'}
              onClick={() => {
                setMvvChoice('enter')
                setMessage('')
              }}
            >
              <strong>Enter our own</strong>
              <span>Add existing Mission, Vision, and Values statements.</span>
            </button>

            <button
              className={
                mvvChoice === 'ai'
                  ? 'mvv-choice mvv-choice-selected'
                  : 'mvv-choice'
              }
              type="button"
              disabled={isSaving}
              aria-pressed={mvvChoice === 'ai'}
              onClick={() => {
                setMvvChoice('ai')
                setMessage(
                  'AI-assisted Mission, Vision, and Values generation will be added in the next onboarding stage.',
                )
              }}
            >
              <strong>Use AI to help</strong>
              <span>
                Answer guided questions and review suggested statements before
                accepting them.
              </span>
            </button>

            <button
              className={
                mvvChoice === 'skip'
                  ? 'mvv-choice mvv-choice-selected'
                  : 'mvv-choice'
              }
              type="button"
              disabled={isSaving}
              aria-pressed={mvvChoice === 'skip'}
              onClick={() => {
                setMvvChoice('skip')
                setMessage('')
              }}
            >
              <strong>Skip for now</strong>
              <span>Continue onboarding without adding these statements.</span>
            </button>
          </div>

          {mvvChoice === 'enter' ? (
            <div className="mvv-fields">
              <div className="setup-field">
                <label htmlFor="mission-statement">Mission</label>

                <textarea
                  id="mission-statement"
                  name="missionStatement"
                  rows={5}
                  value={missionStatement}
                  disabled={isSaving}
                  onChange={(event) => {
                    setMissionStatement(event.target.value)
                    setMessage('')
                  }}
                />

                <p className="setup-help">
                  Describe what the organization does and whom it serves.
                </p>
              </div>

              <div className="setup-field">
                <label htmlFor="vision-statement">Vision</label>

                <textarea
                  id="vision-statement"
                  name="visionStatement"
                  rows={5}
                  value={visionStatement}
                  disabled={isSaving}
                  onChange={(event) => {
                    setVisionStatement(event.target.value)
                    setMessage('')
                  }}
                />

                <p className="setup-help">
                  Describe what success should look like in the future.
                </p>
              </div>

              <div className="setup-field">
                <label htmlFor="values-statement">Values</label>

                <textarea
                  id="values-statement"
                  name="valuesStatement"
                  rows={6}
                  value={valuesStatement}
                  disabled={isSaving}
                  onChange={(event) => {
                    setValuesStatement(event.target.value)
                    setMessage('')
                  }}
                />

                <p className="setup-help">
                  Enter the principles that should guide behavior and
                  priorities.
                </p>
              </div>
            </div>
          ) : null}

          {mvvChoice === 'ai' ? (
            <div className="mvv-ai-notice">
              <strong>AI-assisted setup</strong>
              <p>
                The organization will answer several questions about its
                purpose, customers, future direction, and operating principles.
                Everward will suggest statements for an authorized admin to
                review, edit, and approve.
              </p>
            </div>
          ) : null}
        </section>

        <div className="setup-actions">
          <button
            className="primary-button"
            type="submit"
            disabled={isSaving}
          >
            {isSaving ? 'Saving progress...' : 'Save and continue to groups'}
          </button>

          {message ? (
            <p className="form-message" role="status">
              {message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  )
}

export default OrganizationSetup