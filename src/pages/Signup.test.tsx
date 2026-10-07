// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Signup from './Signup'

const signUp = vi.fn()
vi.mock('../context/SupabaseAuthContext', () => ({
  useAuth: () => ({ signUp, user: null })
}))

function fillAndSubmit(honeypot?: string) {
  render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>
  )
  fireEvent.change(screen.getByPlaceholderText('First Name'), { target: { value: 'Christina' } })
  fireEvent.change(screen.getByPlaceholderText('Last Name'), { target: { value: 'Trinidad' } })
  fireEvent.change(screen.getByPlaceholderText('Email address'), { target: { value: 'buyer@example.com' } })
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'hunter22' } })
  if (honeypot) fireEvent.change(screen.getByTestId('honeypot'), { target: { value: honeypot } })
  fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
}

describe('Signup honeypot', () => {
  beforeEach(() => {
    signUp.mockReset()
    signUp.mockResolvedValue({})
  })
  afterEach(() => cleanup())

  it('a person (hidden field empty) creates the account', async () => {
    fillAndSubmit()
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp.mock.calls[0][0]).toBe('buyer@example.com')
  })

  it('a bot that fills the hidden field sees success but nothing is sent', async () => {
    fillAndSubmit('http://seo.example')
    expect(await screen.findByText(/Account created! Please check your email/)).toBeTruthy()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('a person the bot gate refuses sees plain words, not a database error', async () => {
    signUp.mockResolvedValue({ error: 'Database error saving new user' })
    fillAndSubmit()
    const msg = await screen.findByText(/We could not create your account/)
    expect(msg.className).toContain('text-red-700')
    expect(screen.queryByText(/Database error/)).toBeNull()
  })

  it('keeps the hidden field away from people: off-screen, not tabbable, not read out', () => {
    render(
      <MemoryRouter>
        <Signup />
      </MemoryRouter>
    )
    const field = screen.getByTestId('honeypot')
    expect(field.getAttribute('tabindex')).toBe('-1')
    expect(field.closest('[aria-hidden="true"]')).toBeTruthy()
  })
})
