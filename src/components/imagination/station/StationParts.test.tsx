// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { StationSteps, ToolRow, StationWelcome, AddWordsModal } from './StationParts'
import { IDEAS_TO_TRY } from './stationIdeas'

afterEach(cleanup)

describe('StationSteps', () => {
  it('marks the current step and reports clicks', () => {
    const onStep = vi.fn()
    render(<StationSteps step={3} onStep={onStep} />)
    const current = screen.getByRole('button', { current: 'step' })
    expect(current.textContent).toContain('Place on sheet')
    fireEvent.click(screen.getByText('4'))
    expect(onStep).toHaveBeenCalledWith(4)
  })
})

describe('ToolRow', () => {
  it('shows the before and after pictures and the price, and runs the tool', () => {
    const onClick = vi.fn()
    const { container } = render(<ToolRow label="Remove Background" art="removebg" price="3 free" onClick={onClick} />)
    const srcs = [...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))
    expect(srcs).toEqual(['/station/tools/removebg-before.webp', '/station/tools/removebg-after.webp'])
    expect(screen.getByText('3 free')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Remove Background/ }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('does not run while busy', () => {
    const onClick = vi.fn()
    render(<ToolRow label="Enhance" art="enhance" price="2 ITC" onClick={onClick} busy />)
    fireEvent.click(screen.getByRole('button', { name: /Enhance/ }))
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('StationWelcome', () => {
  const base = { onFiles: vi.fn(), onBrowse: vi.fn(), imaginePrice: '2 free tries left' }

  it('hands the typed idea to Mr. Imagine exactly as typed', () => {
    const onImagine = vi.fn()
    render(<StationWelcome {...base} onImagine={onImagine} onSurprise={async () => null} />)
    fireEvent.change(screen.getByLabelText('Describe your idea'), { target: { value: '  a tiger in sunglasses  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Imagine' }))
    expect(onImagine).toHaveBeenCalledWith('a tiger in sunglasses')
  })

  it('Surprise me fills the box, and an idea card starts that idea', async () => {
    const onImagine = vi.fn()
    render(<StationWelcome {...base} onImagine={onImagine} onSurprise={async () => 'a cat astronaut'} />)
    fireEvent.click(screen.getByRole('button', { name: /Surprise me/ }))
    await waitFor(() => expect((screen.getByLabelText('Describe your idea') as HTMLInputElement).value).toBe('a cat astronaut'))
    fireEvent.click(screen.getByText(IDEAS_TO_TRY[1].label))
    expect(onImagine).toHaveBeenCalledWith(IDEAS_TO_TRY[1].prompt)
  })

  it('a dropped image goes to uploads, other files do not', () => {
    const onFiles = vi.fn()
    render(<StationWelcome {...base} onFiles={onFiles} onImagine={vi.fn()} onSurprise={async () => null} />)
    const png = new File(['x'], 'art.png', { type: 'image/png' })
    const txt = new File(['x'], 'notes.txt', { type: 'text/plain' })
    fireEvent.drop(screen.getByText('Upload your art'), { dataTransfer: { files: [png, txt] } })
    expect(onFiles).toHaveBeenCalledWith([png])
  })
})

describe('AddWordsModal', () => {
  it('puts the exact words in the lettering idea', () => {
    const onCreate = vi.fn()
    render(<AddWordsModal isOpen onClose={vi.fn()} onCreate={onCreate} />)
    fireEvent.change(screen.getByPlaceholderText('Good Vibes Only'), { target: { value: 'Team Rockmart' } })
    fireEvent.click(screen.getByRole('button', { name: 'Varsity' }))
    fireEvent.click(screen.getByRole('button', { name: /Letter it/ }))
    expect(onCreate).toHaveBeenCalledOnce()
    const prompt = onCreate.mock.calls[0][0] as string
    expect(prompt).toContain('reads exactly "Team Rockmart"')
    expect(prompt).toContain('varsity')
  })

  it('will not letter empty words', () => {
    const onCreate = vi.fn()
    render(<AddWordsModal isOpen onClose={vi.fn()} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: /Letter it/ }))
    expect(onCreate).not.toHaveBeenCalled()
  })
})
