import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import './App.css'

type SignInErrors = {
  email?: string
  password?: string
}

type OrganizationAccess = {
  organizationId: string
  organizationName: string
  role: string
  setupComplete: boolean
  subscriptionStatus: string
}

type AccessResult = {
  access: OrganizationAccess | null
  error: string | null
}

async function getOrganizationAccess(userId: string): Promise<AccessResult> {
  const { data: membership, error: membershipError } = await supabase
    .from('organization_users')
    .select('organization_id, role, is_active')
    .eq('user_id', userId)
    .eq('is_active', true)
    .maybeSingle()

  if (membershipError) {
    return {
      access: null,
      error: 'Unable to verify organization access.',
    }
  }

  if (!membership?.organization_id || !membership.role) {
    return {
      access: null,
      error: 'This account does not have active organization portal access.',
    }
  }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name, setup_complete, subscription_status')
    .eq('id', membership.organization_id)
    .maybeSingle()

  if (organizationError || !organization) {
    return {
      access: null,
      error: 'Unable to load the organization connected to this account.',
    }
  }

  if (organization.subscription_status !== 'active') {
    return {
      access: null,
      error: 'This organization does not have an active portal subscription.',
    }
  }

  return {
    access: {
      organizationId: organization.id,
      organizationName: organization.name,
      role: membership.role,
      setupComplete: Boolean(organization.setup_complete),
      subscriptionStatus: organization.subscription_status,
    },
    error: null,
  }
}

function formatRole(role: string) {
  return role
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [organizationAccess, setOrganizationAccess] =
    useState<OrganizationAccess | null>(null)
  const [accessError, setAccessError] = useState('')
  const [isCheckingSession, setIsCheckingSession] = useState(true)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<SignInErrors>({})
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let isMounted = true

    async function loadSession(nextSession: Session | null) {
      if (!isMounted) {
        return
      }

      setSession(nextSession)
      setOrganizationAccess(null)
      setAccessError('')

      if (!nextSession) {
        setIsCheckingSession(false)
        return
      }

      setIsCheckingSession(true)

      const result = await getOrganizationAccess(nextSession.user.id)

      if (!isMounted) {
        return
      }

      setOrganizationAccess(result.access)
      setAccessError(result.error ?? '')
      setIsCheckingSession(false)
    }

    async function initializeSession() {
      const {
        data: { session: existingSession },
      } = await supabase.auth.getSession()

      await loadSession(existingSession)
    }

    void initializeSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadSession(nextSession)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextErrors: SignInErrors = {}
    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      nextErrors.email = 'Enter your organization email address.'
    } else if (!normalizedEmail.includes('@')) {
      nextErrors.email = 'Enter a valid email address.'
    }

    if (!password) {
      nextErrors.password = 'Enter your password.'
    }

    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      setMessage('')
      return
    }

    setIsSubmitting(true)
    setMessage('')

    const { error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    })

    if (error) {
      setMessage('The email address or password is incorrect.')
      setIsSubmitting(false)
      return
    }

    setPassword('')
    setIsSubmitting(false)
  }

  async function handleForgotPassword() {
    const normalizedEmail = email.trim()

    if (!normalizedEmail) {
      setErrors((current) => ({
        ...current,
        email: 'Enter your organization email address first.',
      }))
      setMessage('')
      return
    }

    if (!normalizedEmail.includes('@')) {
      setErrors((current) => ({
        ...current,
        email: 'Enter a valid email address.',
      }))
      setMessage('')
      return
    }

    setErrors((current) => ({
      ...current,
      email: undefined,
    }))
    setMessage('Sending password reset email...')

    const { error } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      {
        redirectTo: `${window.location.origin}/reset-password`,
      },
    )

    if (error) {
      setMessage('Unable to send the password reset email. Try again.')
      return
    }

    setMessage('Check your email for a password reset link.')
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    setEmail('')
    setPassword('')
    setErrors({})
    setMessage('')
  }

  if (isCheckingSession) {
    return (
      <main className="session-loading">
        <img className="session-loading-logo" src="/icon.png" alt="Everward" />
        <p>Loading your organization portal...</p>
      </main>
    )
  }

  if (session && accessError) {
    return (
      <main className="access-page">
        <section className="access-card">
          <img className="access-logo" src="/icon.png" alt="Everward" />
          <p className="eyebrow">Organization access required</p>
          <h1>Unable to open the portal</h1>
          <p>{accessError}</p>
          <button
            className="primary-button"
            type="button"
            onClick={handleSignOut}
          >
            Sign out
          </button>
        </section>
      </main>
    )
  }

  if (session && organizationAccess) {
    return (
      <main className="dashboard-page">
        <header className="dashboard-header">
          <div className="dashboard-brand">
            <img src="/icon.png" alt="Everward" />
            <div>
              <span>Everward</span>
              <small>Organization Portal</small>
            </div>
          </div>

          <div className="dashboard-account">
            <div>
              <strong>{session.user.email}</strong>
              <span>{formatRole(organizationAccess.role)}</span>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="dashboard-content">
          <div className="dashboard-welcome">
            <p className="eyebrow">Organization dashboard</p>
            <h1>Welcome to {organizationAccess.organizationName}</h1>
            <p>
              Your secure organization portal is connected and your access has
              been verified.
            </p>
          </div>

          <div className="dashboard-grid">
            <article className="dashboard-card">
              <span className="dashboard-card-label">Your role</span>
              <strong>{formatRole(organizationAccess.role)}</strong>
              <p>
                Your portal permissions will be based on this organization
                role.
              </p>
            </article>

            <article className="dashboard-card">
              <span className="dashboard-card-label">Subscription</span>
              <strong>
                {organizationAccess.subscriptionStatus === 'active'
                  ? 'Active'
                  : organizationAccess.subscriptionStatus}
              </strong>
              <p>The organization portal subscription is active.</p>
            </article>

            <article className="dashboard-card">
              <span className="dashboard-card-label">Organization setup</span>
              <strong>
                {organizationAccess.setupComplete
                  ? 'Complete'
                  : 'Setup required'}
              </strong>
              <p>
                Organization onboarding and configuration will continue from
                this dashboard.
              </p>
            </article>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="portal-page">
      <section className="portal-introduction">
        <img className="brand-logo" src="/icon.png" alt="Everward" />

        <p className="eyebrow">Everward for Organizations</p>

        <h1>Keep your organization moving in the right direction.</h1>

        <p className="introduction-copy">
          Manage users, groups, AI credits, reporting, company guidance, and
          organization-wide insights from one secure portal.
        </p>

        <div className="feature-list" aria-label="Portal capabilities">
          <div className="feature-item">
            <span className="feature-number">01</span>
            <div>
              <h2>Structured access</h2>
              <p>
                Organization Admin, Billing Admin, User Admin, Group Manager,
                View Only, and Employee access.
              </p>
            </div>
          </div>

          <div className="feature-item">
            <span className="feature-number">02</span>
            <div>
              <h2>Organization visibility</h2>
              <p>
                Review authorized individual, group, hierarchy, and saved-view
                activity without giving managers editing control.
              </p>
            </div>
          </div>

          <div className="feature-item">
            <span className="feature-number">03</span>
            <div>
              <h2>AI reporting</h2>
              <p>
                Run and retain scoped organization analyses, usage reporting,
                and executive outputs.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sign-in-panel" aria-labelledby="sign-in-heading">
        <div className="sign-in-card">
          <div className="mobile-brand">
            <img className="brand-logo" src="/icon.png" alt="Everward" />
            <span>Everward</span>
          </div>

          <p className="eyebrow">Secure organization access</p>
          <h2 id="sign-in-heading">Sign in to your organization</h2>

          <p className="sign-in-description">
            Use the email address and password connected to your Everward
            organization account.
          </p>

          <form className="sign-in-form" onSubmit={handleSubmit} noValidate>
            <div className="form-field">
              <label htmlFor="email">Organization email</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                onChange={(event) => {
                  setEmail(event.target.value)
                  setErrors((current) => ({
                    ...current,
                    email: undefined,
                  }))
                  setMessage('')
                }}
              />

              {errors.email ? (
                <p id="email-error" className="field-error">
                  {errors.email}
                </p>
              ) : null}
            </div>

            <div className="form-field">
              <div className="password-heading">
                <label htmlFor="password">Password</label>

                <button
                  className="text-button"
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleForgotPassword}
                >
                  Forgot password?
                </button>
              </div>

              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={isSubmitting}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? 'password-error' : undefined
                }
                onChange={(event) => {
                  setPassword(event.target.value)
                  setErrors((current) => ({
                    ...current,
                    password: undefined,
                  }))
                  setMessage('')
                }}
              />

              {errors.password ? (
                <p id="password-error" className="field-error">
                  {errors.password}
                </p>
              ) : null}
            </div>

            <button
              className="primary-button"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </button>

            {message ? (
              <p className="form-message" role="status">
                {message}
              </p>
            ) : null}
          </form>

          <div className="support-note">
            <strong>Need access?</strong>
            <span>
              Contact your organization administrator for an invitation.
            </span>
          </div>
        </div>

        <footer className="portal-footer">
          <span>Everward by AInovations</span>
          <a href="https://ainovations.net/privacy">Privacy</a>
          <a href="https://ainovations.net/terms">Terms</a>
          <a href="https://ainovations.net/support">Support</a>
        </footer>
      </section>
    </main>
  )
}

export default App