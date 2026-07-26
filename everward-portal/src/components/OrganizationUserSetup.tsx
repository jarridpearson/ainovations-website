import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../lib/supabase'

type OrganizationGroup = {
  id: string
  name: string
  parent_group_id: string | null
}

type OrganizationRole =
  | 'organization_admin'
  | 'billing_admin'
  | 'user_admin'
  | 'group_manager'
  | 'view_only'
  | 'member'

type OrganizationUserSetupProps = {
  organizationId: string
  mode?: 'onboarding' | 'management'
  onFinishSetup?: () => Promise<void>
  onUsersChanged?: () => void
  onBack: () => void
}

type UserFormErrors = {
  fullName?: string
  email?: string
  password?: string
  primaryGroupId?: string
}

type CsvUser = {
  rowNumber: number
  fullName: string
  email: string
  password: string
  submittedRole: string
  normalizedRole: OrganizationRole
  primaryGroupName: string
  primaryGroupId: string
  roleDefaulted: boolean
}

type CsvValidationError = {
  rowNumber: number
  field: string
  message: string
}

type CreationResult = {
  email: string
  fullName: string
  success: boolean
  userId?: string
  error?: string
}

type CreateUsersResponse = {
  message?: string
  successfulCount?: number
  failedCount?: number
  purchasedSeatCount?: number
  previouslyUsedSeatCount?: number
  availableSeatCountBeforeCreation?: number
  availableSeatCountAfterCreation?: number
  results?: CreationResult[]
  error?: string
  validationErrors?: Array<{
    row: number
    field: string
    message: string
  }>
}

const requiredCsvHeaders = [
  'full_name',
  'email_address',
  'password',
  'organization_role',
  'primary_group',
]

const roleOptions: Array<{
  value: OrganizationRole
  label: string
  description: string
}> = [
  {
    value: 'member',
    label: 'Employee',
    description: 'Uses Everward through the organization account.',
  },
  {
    value: 'group_manager',
    label: 'Group Manager',
    description: 'Manages the assigned group and permitted descendant groups.',
  },
  {
    value: 'view_only',
    label: 'View Only',
    description:
      'Can view permitted portal information but cannot initiate controls or AI.',
  },
  {
    value: 'user_admin',
    label: 'User Admin',
    description: 'Can add, edit, and remove organization users.',
  },
  {
    value: 'billing_admin',
    label: 'Billing Admin',
    description: 'Can manage billing, seats, and payment information.',
  },
  {
    value: 'organization_admin',
    label: 'Organization Admin',
    description: 'Has full organization portal administration access.',
  },
]

const roleAliases = new Map<string, OrganizationRole>([
  ['employee', 'member'],
  ['member', 'member'],
  ['user', 'member'],
  ['organization employee', 'member'],
  ['group manager', 'group_manager'],
  ['group_manager', 'group_manager'],
  ['manager', 'group_manager'],
  ['view only', 'view_only'],
  ['view_only', 'view_only'],
  ['readonly', 'view_only'],
  ['read only', 'view_only'],
  ['user admin', 'user_admin'],
  ['user_admin', 'user_admin'],
  ['billing admin', 'billing_admin'],
  ['billing_admin', 'billing_admin'],
  ['organization admin', 'organization_admin'],
  ['organization_admin', 'organization_admin'],
  ['org admin', 'organization_admin'],
])

function normalizeLookupValue(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeRole(value: string) {
  const normalized = normalizeLookupValue(value)
  const matchedRole = roleAliases.get(normalized)

  return {
    role: matchedRole ?? 'member',
    defaulted: !matchedRole,
  }
}

function formatRole(role: OrganizationRole) {
  return roleOptions.find((option) => option.value === role)?.label ?? 'Employee'
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function parseCsv(content: string) {
  const normalizedContent = content.replace(/^\uFEFF/, '')
  const firstLine =
    normalizedContent.split(/\r?\n/, 1)[0] ?? ''

  const delimiter =
    firstLine.includes('\t') && !firstLine.includes(',')
      ? '\t'
      : ','

  const rows: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let insideQuotes = false

  for (
    let index = 0;
    index < normalizedContent.length;
    index += 1
  ) {
    const character = normalizedContent[index]
    const nextCharacter = normalizedContent[index + 1]

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentField += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }

      continue
    }

    if (character === delimiter && !insideQuotes) {
      currentRow.push(currentField)
      currentField = ''
      continue
    }

    if (
      (character === '\n' || character === '\r') &&
      !insideQuotes
    ) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1
      }

      currentRow.push(currentField)

      if (currentRow.some((field) => field.trim() !== '')) {
        rows.push(currentRow)
      }

      currentRow = []
      currentField = ''
      continue
    }

    currentField += character
  }

  currentRow.push(currentField)

  if (currentRow.some((field) => field.trim() !== '')) {
    rows.push(currentRow)
  }

  return rows
}

function OrganizationUserSetup({
  organizationId,
  mode = 'onboarding',
  onFinishSetup,
  onUsersChanged,
  onBack,
}: OrganizationUserSetupProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [groups, setGroups] = useState<OrganizationGroup[]>([])
  const [purchasedSeatCount, setPurchasedSeatCount] = useState(0)
  const [usedSeatCount, setUsedSeatCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<OrganizationRole>('member')
  const [billingAccessEnabled, setBillingAccessEnabled] = useState(false)
  const [primaryGroupId, setPrimaryGroupId] = useState('')
  const [singleUserErrors, setSingleUserErrors] =
    useState<UserFormErrors>({})
  const [singleUserMessage, setSingleUserMessage] = useState('')
  const [isCreatingSingleUser, setIsCreatingSingleUser] = useState(false)

  const [csvFileName, setCsvFileName] = useState('')
  const [csvUsers, setCsvUsers] = useState<CsvUser[]>([])
  const [csvErrors, setCsvErrors] = useState<CsvValidationError[]>([])
  const [csvMessage, setCsvMessage] = useState('')
  const [isReadingCsv, setIsReadingCsv] = useState(false)
  const [isCreatingCsvUsers, setIsCreatingCsvUsers] = useState(false)
  const [creationResults, setCreationResults] = useState<CreationResult[]>([])
  const [isFinishingSetup, setIsFinishingSetup] = useState(false)
  const [finishSetupMessage, setFinishSetupMessage] = useState('')

  useEffect(() => {
    let isMounted = true

    async function loadUserSetup() {
      setIsLoading(true)

      const [groupsResult, seatSummaryResult] = await Promise.all([
        supabase.rpc('get_organization_visible_groups', {
          p_organization_id: organizationId,
        }),
        supabase.rpc('get_organization_seat_summary', {
          p_organization_id: organizationId,
        }),
      ])

      if (!isMounted) {
        return
      }

      if (groupsResult.error) {
        console.error(
          'Organization groups failed to load:',
          groupsResult.error,
        )
        setCsvMessage('Unable to load organization groups.')
        setIsLoading(false)
        return
      }

      if (seatSummaryResult.error) {
        console.error(
          'Organization seat summary failed to load:',
          seatSummaryResult.error,
        )
        setCsvMessage('Unable to load the organization seat summary.')
        setIsLoading(false)
        return
      }

      const seatSummary = seatSummaryResult.data?.[0]

      if (!seatSummary) {
        setCsvMessage('Unable to load the organization seat summary.')
        setIsLoading(false)
        return
      }

      setGroups(
        (groupsResult.data ?? []).map(
          (group: {
            group_id: string
            group_name: string
            parent_group_id: string | null
          }) => ({
            id: group.group_id,
            name: group.group_name,
            parent_group_id: group.parent_group_id,
          }),
        ),
      )
      setPurchasedSeatCount(
        Math.max(0, Number(seatSummary.purchased_seat_count ?? 0)),
      )
      setUsedSeatCount(
        Math.max(0, Number(seatSummary.used_seat_count ?? 0)),
      )
      setIsLoading(false)
    }

    void loadUserSetup()

    return () => {
      isMounted = false
    }
  }, [organizationId])

  const validGroupNames = useMemo(
    () => groups.map((group) => group.name).sort((a, b) => a.localeCompare(b)),
    [groups],
  )

  const groupByNormalizedName = useMemo(() => {
    const lookup = new Map<string, OrganizationGroup[]>()

    groups.forEach((group) => {
      const key = normalizeLookupValue(group.name)
      const existingGroups = lookup.get(key) ?? []
      existingGroups.push(group)
      lookup.set(key, existingGroups)
    })

    return lookup
  }, [groups])

  const defaultedRoleCount = useMemo(
    () => csvUsers.filter((user) => user.roleDefaulted).length,
    [csvUsers],
  )

  const availableSeatCount = Math.max(
    0,
    purchasedSeatCount - usedSeatCount,
  )

  async function createUsers(
    users: Array<{
      fullName: string
      email: string
      password: string
      role: OrganizationRole
      billingAccessEnabled: boolean
      primaryGroupId: string
    }>,
  ) {
    const { data, error } = await supabase.functions.invoke<CreateUsersResponse>(
      'create-organization-users',
      {
        body: {
          organizationId,
          users,
        },
      },
    )

    if (error) {
      console.error('Organization user function failed:', error)
      throw new Error(
        error.message || 'The organization user service could not be reached.',
      )
    }

    if (data?.error) {
      throw new Error(data.error)
    }

    return data
  }

  async function handleCreateSingleUser(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()

    if (availableSeatCount === 0) {
      setSingleUserMessage(
        'No seats are available. Add another seat in Billing before creating this user.',
      )
      return
    }

    const normalizedFullName = fullName.trim()
    const normalizedEmail = email.trim().toLowerCase()
    const nextErrors: UserFormErrors = {}

    if (!normalizedFullName) {
      nextErrors.fullName = 'Enter the user’s full name.'
    }

    if (!normalizedEmail) {
      nextErrors.email = 'Enter the user’s email address.'
    } else if (!isValidEmail(normalizedEmail)) {
      nextErrors.email = 'Enter a valid email address.'
    }

    if (!password) {
      nextErrors.password = 'Enter an initial password.'
    } else if (password.length < 8) {
      nextErrors.password =
        'The initial password must contain at least 8 characters.'
    }

    if (!primaryGroupId) {
      nextErrors.primaryGroupId = 'Select the user’s primary group.'
    }

    setSingleUserErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setSingleUserMessage('Complete all required user fields.')
      return
    }

    setIsCreatingSingleUser(true)
    setSingleUserMessage('Creating organization user...')

    try {
      const response = await createUsers([
        {
          fullName: normalizedFullName,
          email: normalizedEmail,
          password,
          role,
          billingAccessEnabled:
            role === 'organization_admin' ||
            role === 'billing_admin' ||
            billingAccessEnabled,
          primaryGroupId,
        },
      ])

      const result = response?.results?.[0]

      if (!result?.success) {
        setSingleUserMessage(
          result?.error ?? 'The organization user could not be created.',
        )
        setIsCreatingSingleUser(false)
        return
      }

      setFullName('')
      setEmail('')
      setPassword('')
      setRole('member')
      setBillingAccessEnabled(false)
      setPrimaryGroupId('')
      setSingleUserErrors({})
      setUsedSeatCount((current) => current + 1)
      setSingleUserMessage(
        `${normalizedFullName} was created successfully.`,
      )
      onUsersChanged?.()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The organization user could not be created.'

      setSingleUserMessage(message)
    }

    setIsCreatingSingleUser(false)
  }

  function clearCsvUpload() {
    setCsvFileName('')
    setCsvUsers([])
    setCsvErrors([])
    setCsvMessage('')
    setCreationResults([])

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  async function handleCsvFileChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]

    event.target.value = ''

    setCsvUsers([])
    setCsvErrors([])
    setCsvMessage('')
    setCreationResults([])

    if (!file) {
      setCsvFileName('')
      return
    }

    if (!file.name.toLowerCase().endsWith('.csv')) {
      setCsvFileName(file.name)
      setCsvErrors([
        {
          rowNumber: 0,
          field: 'file',
          message: 'Upload a CSV file ending in .csv.',
        },
      ])
      return
    }

    setIsReadingCsv(true)
    setCsvFileName(file.name)
    setCsvMessage('Validating CSV file...')

    try {
      const content = await file.text()
      const parsedRows = parseCsv(content)

      if (parsedRows.length === 0) {
        setCsvErrors([
          {
            rowNumber: 0,
            field: 'file',
            message: 'The CSV file is empty.',
          },
        ])
        setCsvMessage('')
        setIsReadingCsv(false)
        return
      }

      const submittedHeaders = parsedRows[0].map((header) =>
        normalizeLookupValue(header).replace(/\s+/g, '_'),
      )

      const headersMatch =
        submittedHeaders.length === requiredCsvHeaders.length &&
        requiredCsvHeaders.every(
          (requiredHeader, index) =>
            submittedHeaders[index] === requiredHeader,
        )

      if (!headersMatch) {
        setCsvErrors([
          {
            rowNumber: 1,
            field: 'headers',
            message: `The CSV headers do not match. Use these exact fields in this exact order: ${requiredCsvHeaders.join(
              ', ',
            )}`,
          },
        ])
        setCsvMessage('')
        setIsReadingCsv(false)
        return
      }

      const nextUsers: CsvUser[] = []
      const nextErrors: CsvValidationError[] = []
      const submittedEmails = new Set<string>()

      parsedRows.slice(1).forEach((row, index) => {
        const rowNumber = index + 2
        const [
          submittedFullName = '',
          submittedEmail = '',
          submittedPassword = '',
          submittedRole = '',
          submittedPrimaryGroup = '',
        ] = row

        const normalizedFullName = submittedFullName.trim()
        const normalizedEmail = submittedEmail.trim().toLowerCase()
        const normalizedPassword = submittedPassword
        const primaryGroupName = submittedPrimaryGroup.trim()
        const normalizedGroupName =
          normalizeLookupValue(primaryGroupName)
        const matchingGroups =
          groupByNormalizedName.get(normalizedGroupName) ?? []
        const normalizedRoleResult = normalizeRole(submittedRole)

        let rowHasError = false

        if (!normalizedFullName) {
          nextErrors.push({
            rowNumber,
            field: 'full_name',
            message: 'Full Name is required.',
          })
          rowHasError = true
        }

        if (!normalizedEmail) {
          nextErrors.push({
            rowNumber,
            field: 'email_address',
            message: 'Email Address is required.',
          })
          rowHasError = true
        } else if (!isValidEmail(normalizedEmail)) {
          nextErrors.push({
            rowNumber,
            field: 'email_address',
            message: `"${submittedEmail}" is not a valid email address.`,
          })
          rowHasError = true
        } else if (submittedEmails.has(normalizedEmail)) {
          nextErrors.push({
            rowNumber,
            field: 'email_address',
            message: `"${normalizedEmail}" appears more than once in the CSV.`,
          })
          rowHasError = true
        } else {
          submittedEmails.add(normalizedEmail)
        }

        if (!normalizedPassword) {
          nextErrors.push({
            rowNumber,
            field: 'password',
            message: 'Password is required.',
          })
          rowHasError = true
        } else if (normalizedPassword.length < 8) {
          nextErrors.push({
            rowNumber,
            field: 'password',
            message: 'Password must contain at least 8 characters.',
          })
          rowHasError = true
        }

        if (!primaryGroupName) {
          nextErrors.push({
            rowNumber,
            field: 'primary_group',
            message: `Primary Group is required. Valid group names: ${validGroupNames.join(
              ', ',
            )}`,
          })
          rowHasError = true
        } else if (matchingGroups.length === 0) {
          nextErrors.push({
            rowNumber,
            field: 'primary_group',
            message: `"${primaryGroupName}" does not match an organization group. Valid group names: ${validGroupNames.join(
              ', ',
            )}`,
          })
          rowHasError = true
        } else if (matchingGroups.length > 1) {
          nextErrors.push({
            rowNumber,
            field: 'primary_group',
            message: `"${primaryGroupName}" matches more than one organization group. Rename the duplicate groups before uploading users.`,
          })
          rowHasError = true
        }

        if (!rowHasError) {
          nextUsers.push({
            rowNumber,
            fullName: normalizedFullName,
            email: normalizedEmail,
            password: normalizedPassword,
            submittedRole: submittedRole.trim(),
            normalizedRole: normalizedRoleResult.role,
            primaryGroupName: matchingGroups[0].name,
            primaryGroupId: matchingGroups[0].id,
            roleDefaulted: normalizedRoleResult.defaulted,
          })
        }
      })

      setCsvErrors(nextErrors)

      if (nextErrors.length > 0) {
        setCsvUsers([])
        setCsvMessage(
          `The file contains ${nextErrors.length} validation error${
            nextErrors.length === 1 ? '' : 's'
          }. Correct the CSV and upload it again. Required fields: ${requiredCsvHeaders.join(
            ', ',
          )}`,
        )
      } else if (nextUsers.length === 0) {
        setCsvUsers([])
        setCsvMessage('The CSV contains no user rows.')
      } else {
        setCsvUsers(nextUsers)
        setCsvMessage(
          `${nextUsers.length} user${
            nextUsers.length === 1 ? '' : 's'
          } ready for review. No users have been added yet.`,
        )
      }
    } catch (error) {
      console.error('CSV processing failed:', error)
      setCsvErrors([
        {
          rowNumber: 0,
          field: 'file',
          message: 'The CSV file could not be read.',
        },
      ])
      setCsvMessage('')
    }

    setIsReadingCsv(false)
  }

  async function handleCreateCsvUsers() {
    if (csvUsers.length === 0 || csvErrors.length > 0) {
      setCsvMessage(
        'Upload a valid CSV before creating organization users.',
      )
      return
    }

    if (availableSeatCount === 0) {
      setCsvMessage(
        'No seats are available. Add another seat in Billing before creating users.',
      )
      return
    }

    setIsCreatingCsvUsers(true)
    setCreationResults([])
    setCsvMessage(
      `Creating ${csvUsers.length} organization user${
        csvUsers.length === 1 ? '' : 's'
      }...`,
    )

    try {
      const response = await createUsers(
        csvUsers.map((user) => ({
          fullName: user.fullName,
          email: user.email,
          password: user.password,
          role: user.normalizedRole,
          billingAccessEnabled: false,
          primaryGroupId: user.primaryGroupId,
        })),
      )

      const results = response?.results ?? []
      const successfulCount = results.filter(
        (result) => result.success,
      ).length
      const failedCount = results.length - successfulCount

      setCreationResults(results)

      if (
        typeof response?.availableSeatCountAfterCreation === 'number'
      ) {
        setPurchasedSeatCount(response.purchasedSeatCount ?? purchasedSeatCount)
        setUsedSeatCount(
          Math.max(
            0,
            (response.purchasedSeatCount ?? purchasedSeatCount) -
              response.availableSeatCountAfterCreation,
          ),
        )
      } else if (successfulCount > 0) {
        setUsedSeatCount((current) => current + successfulCount)
      }

      if (successfulCount > 0) {
        onUsersChanged?.()
      }

      if (failedCount === 0) {
        setCsvMessage(
          `${successfulCount} organization user${
            successfulCount === 1 ? '' : 's'
          } created successfully.`,
        )
        setCsvUsers([])
      } else {
        setCsvMessage(
          `${successfulCount} user${
            successfulCount === 1 ? '' : 's'
          } created and ${failedCount} failed. Review the results below.`,
        )
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The CSV users could not be created.'

      setCsvMessage(message)
    }

    setIsCreatingCsvUsers(false)
  }

  async function handleFinishSetup() {
    if (!onFinishSetup) {
      return
    }

    setIsFinishingSetup(true)
    setFinishSetupMessage('Completing organization setup...')

    try {
      await onFinishSetup()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to complete organization setup. Try again.'

      setFinishSetupMessage(message)
      setIsFinishingSetup(false)
    }
  }

  if (isLoading) {
    return (
      <section className="organization-setup">
        <div className="setup-heading">
          <p className="eyebrow">
            {mode === 'onboarding'
              ? 'Organization onboarding'
              : 'User management'}
          </p>

          <h1>Loading user setup...</h1>
        </div>
      </section>
    )
  }

  return (
    <section className="organization-setup">
      <div className="setup-heading">
        <p className="eyebrow">
          {mode === 'onboarding'
            ? 'Organization onboarding'
            : 'User management'}
        </p>

        <h1>
          {mode === 'onboarding'
            ? 'Add your organization users.'
            : 'Add organization users.'}
        </h1>

        <p>
          Create one user at a time or upload a CSV. Administrators set each
          user’s initial password and must provide it to the user securely.
        </p>
      </div>

      <div className="setup-form">
        <section className="seat-summary">
          <div>
            <span>Purchased seats</span>
            <strong>{purchasedSeatCount}</strong>
          </div>

          <div>
            <span>Seats in use</span>
            <strong>{usedSeatCount}</strong>
          </div>

          <div>
            <span>Available seats</span>
            <strong>{availableSeatCount}</strong>
          </div>

          {availableSeatCount === 0 ? (
            <p>
              No seats are currently available. Add another seat in Billing
              before creating another user.
            </p>
          ) : null}
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            {mode === 'onboarding' ? (
              <span className="setup-step-number">6</span>
            ) : null}

            <div>
              <h2>Add one user</h2>
              <p>
                Create an organization account with an initial password,
                organization role, and primary group.
              </p>
            </div>
          </div>

          <form
            className="group-creation-form"
            onSubmit={handleCreateSingleUser}
            noValidate
          >
            <div className="setup-field">
              <label htmlFor="user-full-name">Full name</label>

              <input
                id="user-full-name"
                type="text"
                value={fullName}
                disabled={isCreatingSingleUser || availableSeatCount === 0}
                aria-invalid={Boolean(singleUserErrors.fullName)}
                onChange={(event) => {
                  setFullName(event.target.value)
                  setSingleUserErrors((current) => ({
                    ...current,
                    fullName: undefined,
                  }))
                  setSingleUserMessage('')
                }}
              />

              {singleUserErrors.fullName ? (
                <p className="field-error">
                  {singleUserErrors.fullName}
                </p>
              ) : null}
            </div>

            <div className="setup-field">
              <label htmlFor="user-email">Email address</label>

              <input
                id="user-email"
                type="email"
                value={email}
                disabled={isCreatingSingleUser || availableSeatCount === 0}
                aria-invalid={Boolean(singleUserErrors.email)}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setSingleUserErrors((current) => ({
                    ...current,
                    email: undefined,
                  }))
                  setSingleUserMessage('')
                }}
              />

              {singleUserErrors.email ? (
                <p className="field-error">{singleUserErrors.email}</p>
              ) : null}
            </div>

            <div className="setup-field">
              <label htmlFor="user-password">Initial password</label>

              <input
                id="user-password"
                type="password"
                value={password}
                disabled={isCreatingSingleUser || availableSeatCount === 0}
                aria-invalid={Boolean(singleUserErrors.password)}
                autoComplete="new-password"
                onChange={(event) => {
                  setPassword(event.target.value)
                  setSingleUserErrors((current) => ({
                    ...current,
                    password: undefined,
                  }))
                  setSingleUserMessage('')
                }}
              />

              <p className="setup-help">
                Use at least 8 characters. Provide the initial password to the
                user securely.
              </p>

              {singleUserErrors.password ? (
                <p className="field-error">
                  {singleUserErrors.password}
                </p>
              ) : null}
            </div>

            <div className="setup-field">
              <label htmlFor="user-role">Organization role</label>

              <select
                id="user-role"
                value={role}
                disabled={isCreatingSingleUser || availableSeatCount === 0}
                onChange={(event) => {
                  const nextRole =
                    event.target.value as OrganizationRole

                  setRole(nextRole)

                  if (nextRole === 'billing_admin') {
                    setBillingAccessEnabled(false)
                  }

                  setSingleUserMessage('')
                }}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <p className="setup-help">
                {
                  roleOptions.find((option) => option.value === role)
                    ?.description
                }
              </p>
            </div>

            {role !== 'billing_admin' ? (
              <div className="setup-field">
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{
                      width: 'auto',
                      flex: '0 0 auto',
                      marginTop: '3px',
                    }}
                    checked={billingAccessEnabled}
                    disabled={
                      isCreatingSingleUser ||
                      availableSeatCount === 0
                    }
                    onChange={(event) => {
                      setBillingAccessEnabled(event.target.checked)
                      setSingleUserMessage('')
                    }}
                  />

                  Give this user billing access
                </label>

                <p className="setup-help">
                  The user will keep the selected organization role and also
                  receive access to billing, seats, and payment information.
                </p>
              </div>
            ) : null}

            <div className="setup-field">
              <label htmlFor="user-primary-group">Primary group</label>

              <select
                id="user-primary-group"
                value={primaryGroupId}
                disabled={isCreatingSingleUser || availableSeatCount === 0}
                aria-invalid={Boolean(singleUserErrors.primaryGroupId)}
                onChange={(event) => {
                  setPrimaryGroupId(event.target.value)
                  setSingleUserErrors((current) => ({
                    ...current,
                    primaryGroupId: undefined,
                  }))
                  setSingleUserMessage('')
                }}
              >
                <option value="">Select a group</option>

                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>

              {singleUserErrors.primaryGroupId ? (
                <p className="field-error">
                  {singleUserErrors.primaryGroupId}
                </p>
              ) : null}
            </div>

            <button
              className="primary-button group-add-button"
              type="submit"
              disabled={isCreatingSingleUser || availableSeatCount === 0}
            >
              {isCreatingSingleUser
                ? 'Creating user...'
                : availableSeatCount === 0
                  ? 'No seats available'
                  : 'Create organization user'}
            </button>

            {singleUserMessage ? (
              <p className="form-message" role="status">
                {singleUserMessage}
              </p>
            ) : null}
          </form>
        </section>

        <section className="setup-section">
          <div className="setup-section-heading">
            {mode === 'onboarding' ? (
              <span className="setup-step-number">7</span>
            ) : null}

            <div>
              <h2>Bulk add users by CSV</h2>
              <p>
                Download the template, complete every required field, and
                upload the finished CSV.
              </p>
            </div>
          </div>

          <div className="csv-upload-flow">
            <article className="csv-upload-step">
              <span>1</span>

              <div>
                <strong>Download the prepared template</strong>
                <p>
                  The file already contains the required columns in the correct
                  order.
                </p>

                <a
                  className="csv-download-link"
                  href="/everward-organization-users-template.csv"
                  download="everward-organization-users-template.csv"
                >
                  Download user template
                </a>
              </div>
            </article>

            <article className="csv-upload-step">
              <span>2</span>

              <div>
                <strong>Add your users</strong>
                <p>
                  Complete one row for each user and save the finished file as a
                  CSV.
                </p>

                <p className="csv-field-reference">
                  Organization roles: Employee, Group Manager, View Only, User
                  Admin, Billing Admin, or Organization Admin.
                </p>

                <p className="csv-field-reference">
                  Available primary groups:{' '}
                  {validGroupNames.join(', ') || 'No groups available'}
                </p>
              </div>
            </article>

            <article className="csv-upload-step">
              <span>3</span>

              <div>
                <strong>Upload the completed file</strong>
                <p>
                  Everward will check the file and show any corrections needed
                  before creating users.
                </p>

                <div className="csv-actions">
                  <label
                    className="csv-upload-button"
                    htmlFor="organization-user-csv"
                  >
                    {csvErrors.length > 0
                      ? 'Upload corrected CSV'
                      : 'Upload completed CSV'}
                  </label>

                  <input
                    ref={fileInputRef}
                    id="organization-user-csv"
                    className="csv-file-input"
                    type="file"
                    accept=".csv,text/csv"
                    disabled={isReadingCsv || isCreatingCsvUsers}
                    onChange={(event) => {
                      void handleCsvFileChange(event)
                    }}
                  />

                  {csvFileName ? <span>{csvFileName}</span> : null}
                </div>
              </div>
            </article>
          </div>

          {csvErrors.length > 0 ? (
            <div className="csv-error-panel" role="alert">
              <strong>Correct the file and upload it again</strong>

              <p>
                Fix the errors listed below, save the corrected file, then
                click Upload corrected CSV. You may select the same file name.
              </p>

              <p>
                Required fields: {requiredCsvHeaders.join(', ')}
              </p>

              <ul>
                {csvErrors.map((error, index) => (
                  <li key={`${error.rowNumber}-${error.field}-${index}`}>
                    {error.rowNumber > 0
                      ? `Row ${error.rowNumber}, ${error.field}: `
                      : `${error.field}: `}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {csvUsers.length > 0 ? (
            <div className="csv-preview">
              <div className="csv-preview-heading">
                <div>
                  <strong>Users ready to create</strong>
                  <span>
                    {csvUsers.length} user
                    {csvUsers.length === 1 ? '' : 's'} found in the file
                  </span>
                </div>

                {defaultedRoleCount > 0 ? (
                  <p>
                    {defaultedRoleCount} unrecognized role
                    {defaultedRoleCount === 1 ? ' was' : 's were'} defaulted
                    to Employee.
                  </p>
                ) : null}
              </div>

              {csvUsers.length > availableSeatCount ? (
                <div className="csv-seat-warning">
                  <strong>
                    Only {availableSeatCount} seat
                    {availableSeatCount === 1 ? '' : 's'} available
                  </strong>
                  <p>
                    The first {availableSeatCount} user
                    {availableSeatCount === 1 ? '' : 's'} in the file will be
                    created. The remaining{' '}
                    {csvUsers.length - availableSeatCount} will not be created
                    until more seats are added in Billing.
                  </p>
                </div>
              ) : null}

              <div className="csv-preview-table-wrapper">
                <table className="csv-preview-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Full name</th>
                      <th>Email</th>
                      <th>Organization role</th>
                      <th>Primary group</th>
                    </tr>
                  </thead>

                  <tbody>
                    {csvUsers.map((user) => (
                      <tr key={`${user.rowNumber}-${user.email}`}>
                        <td>{user.rowNumber}</td>
                        <td>{user.fullName}</td>
                        <td>{user.email}</td>
                        <td>
                          {formatRole(user.normalizedRole)}
                          {user.roleDefaulted ? ' — defaulted' : ''}
                        </td>
                        <td>{user.primaryGroupName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="csv-submit-actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={
                    isCreatingCsvUsers || availableSeatCount === 0
                  }
                  onClick={() => {
                    void handleCreateCsvUsers()
                  }}
                >
                  {isCreatingCsvUsers
                    ? 'Creating users...'
                    : availableSeatCount === 0
                      ? 'No seats available'
                      : `Create ${Math.min(
                          csvUsers.length,
                          availableSeatCount,
                        )} organization user${
                          Math.min(
                            csvUsers.length,
                            availableSeatCount,
                          ) === 1
                            ? ''
                            : 's'
                        }`}
                </button>

                <button
                  className="text-button"
                  type="button"
                  disabled={isCreatingCsvUsers}
                  onClick={clearCsvUpload}
                >
                  Clear upload
                </button>
              </div>
            </div>
          ) : null}

          {creationResults.length > 0 ? (
            <div className="csv-results">
              <strong>Creation results</strong>

              {creationResults.map((result) => (
                <article
                  key={result.email}
                  className={
                    result.success
                      ? 'csv-result csv-result-success'
                      : 'csv-result csv-result-error'
                  }
                >
                  <div>
                    <strong>{result.fullName}</strong>
                    <span>{result.email}</span>
                  </div>

                  <span>
                    {result.success
                      ? 'Created'
                      : result.error ?? 'Creation failed'}
                  </span>
                </article>
              ))}
            </div>
          ) : null}

          {csvMessage ? (
            <p className="form-message" role="status">
              {csvMessage}
            </p>
          ) : null}
        </section>

        <div className="setup-actions">
          {mode === 'onboarding' ? (
            <>
              <button
                className="primary-button"
                type="button"
                disabled={
                  isCreatingSingleUser ||
                  isCreatingCsvUsers ||
                  isReadingCsv ||
                  isFinishingSetup
                }
                onClick={() => {
                  void handleFinishSetup()
                }}
              >
                {isFinishingSetup
                  ? 'Completing setup...'
                  : 'Finish setup and open dashboard'}
              </button>

              <p className="setup-help">
                You can add more users later from User Management. Unused seats
                will remain available.
              </p>
            </>
          ) : null}

          <button
            className="text-button setup-back-button"
            type="button"
            disabled={
              isCreatingSingleUser ||
              isCreatingCsvUsers ||
              isReadingCsv ||
              isFinishingSetup
            }
            onClick={onBack}
          >
            {mode === 'onboarding'
              ? 'Back to groups'
              : 'Back to user directory'}
          </button>

          {finishSetupMessage ? (
            <p className="form-message" role="status">
              {finishSetupMessage}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default OrganizationUserSetup