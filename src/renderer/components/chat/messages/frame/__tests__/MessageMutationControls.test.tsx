import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'

import type { MessageMenuBarToolbarRenderContext } from '../messageMenuBarActions'
import { renderModelPickerToolbarAction, renderTranslateToolbarAction } from '../MessageMenuBarToolbarRenderers'

vi.mock('@cherrystudio/ui', async () => vi.importActual('@cherrystudio/ui'))

it.each([
  ['Choose model', renderModelPickerToolbarAction],
  ['Translate', renderTranslateToolbarAction]
] as const)('keeps the unavailable %s trigger disabled without opening a writing surface', async (label, renderer) => {
  const openModelPicker = vi.fn(() => <div role="dialog">Choose model</div>)
  const requestTranslationLanguages = vi.fn()
  const executeAction = vi.fn()
  const context = {
    action: {
      id: 'protected',
      label,
      danger: false,
      children: [],
      availability: { visible: true, enabled: false, reason: 'Shared history is read-only' }
    },
    actionContext: { actions: { renderRegenerateModelPicker: openModelPicker, requestTranslationLanguages } },
    executeAction,
    softHoverBg: false,
    menuActions: [],
    translationItems: []
  } as unknown as MessageMenuBarToolbarRenderContext
  render(renderer(context))
  const button = screen.getByRole('button', { name: label })
  expect(button).toBeDisabled()
  await userEvent.setup().click(button)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(openModelPicker).not.toHaveBeenCalled()
  expect(requestTranslationLanguages).not.toHaveBeenCalled()
  expect(executeAction).not.toHaveBeenCalled()
})
