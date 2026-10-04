import { caseDefinition } from '../../../scripts/e2e/regression/cases'
import type { Message } from '../../../src/shared/data/types/message'
import type { SessionGraphCategory } from '../../../src/shared/data/types/sessionGraphCategory'
import type { Topic } from '../../../src/shared/data/types/topic'
import { ensureCustomAssistant } from './assistants'
import { sendChatMarker } from './chat'
import { expect, test } from './fixture'
import { dismissOnboarding, selectSidebarApp } from './navigation'
import {
  browseGraphTopics,
  categoryPaths,
  chooseCategoryParent,
  createGraphCategory,
  forkGraphReply,
  graphData,
  graphMessages,
  messageText,
  openCategoryDialog,
  openGraphTopic,
  renameGraphTopic,
  saveGraphCategories,
  seedGraphInput
} from './sessionGraph'

test(...caseDefinition('SG-01'), async ({ app, mainWindow }) => {
  let page = mainWindow
  await ensureCustomAssistant(app, page)
  await page.evaluate(() => window.api.preference.set('topic.tab.display_mode', 'time'))
  await expect(page.locator('[data-ui~="chat.message"][data-message-id]:visible')).toHaveCount(0)
  const rootReply = await sendChatMarker(page, 'Reply with SG_ROOT_31415.', 'SG_ROOT_31415', false)
  const sourceId = (await graphData<Message>(page, `/messages/${rootReply}`)).topicId
  await sendChatMarker(page, 'Reply with SG_SOURCE_TAIL_27182.', 'SG_SOURCE_TAIL_27182', false)
  const sourceName = app.resourceName(`SDN ${Date.now()}`)
  await renameGraphTopic(page, sourceId, sourceName)

  const category = app.resourceName(`Networking ${Date.now()}`)
  let dialog = await openCategoryDialog(page, sourceId)
  await createGraphCategory(page, dialog, category)
  await dialog.getByRole('checkbox', { name: category, exact: true }).check()
  await saveGraphCategories(dialog)
  const original = await graphMessages(page, sourceId)

  const child = await forkGraphReply(page, rootReply)
  await openGraphTopic(page, child.id)
  await renameGraphTopic(page, child.id, app.resourceName('VXLAN'))
  await expect.poll(() => categoryPaths(page, child.id)).toEqual([category])
  await expect(page.getByText('SG_SOURCE_TAIL_27182', { exact: false })).toHaveCount(0)
  const childMessages = await graphMessages(page, child.id)
  expect(childMessages).toHaveLength(2)
  const childReply = childMessages.find((message) => message.role === 'assistant')!
  const copiedText = messageText(childReply)
  const sharedMessage = page.locator(`[data-ui~="chat.message"][data-message-id="${childReply.id}"]:visible`)
  await expect(
    sharedMessage.getByLabel('Shared history is read-only after a fork. Continue with a new question.')
  ).toBeVisible()
  await sharedMessage.hover()
  await expect(sharedMessage.getByRole('button', { name: 'Regenerate', exact: true })).toBeDisabled()
  await expect(sharedMessage.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
  await sharedMessage.getByRole('button', { name: 'More actions', exact: true }).click()
  await expect(page.getByRole('menuitem', { name: 'Edit', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')

  const childNewReply = await sendChatMarker(page, 'Reply with SG_VXLAN_16180.', 'SG_VXLAN_16180', false)
  dialog = await openCategoryDialog(page, child.id)
  await createGraphCategory(page, dialog, 'VXLAN', category)
  await dialog.getByRole('checkbox', { name: category, exact: true }).uncheck()
  await dialog.getByRole('checkbox', { name: `${category} / VXLAN`, exact: true }).check()
  await saveGraphCategories(dialog)
  const grandchild = await forkGraphReply(page, childNewReply)
  await openGraphTopic(page, grandchild.id)
  await renameGraphTopic(page, grandchild.id, app.resourceName('Encapsulation'))
  await expect.poll(() => categoryPaths(page, grandchild.id)).toEqual([`${category} / VXLAN`])
  await expect(page.getByText('Shared history', { exact: true })).toHaveCount(4)
  await sendChatMarker(page, 'Reply with SG_ENCAPSULATION_14142.', 'SG_ENCAPSULATION_14142', false)

  await openGraphTopic(page, sourceId)
  const sourceRoot = page.locator(`[data-message-id="${rootReply}"]:visible`)
  await expect(
    sourceRoot.getByLabel('Shared history is read-only after a fork. Continue with a new question.')
  ).toBeVisible()
  await sourceRoot.hover()
  await expect(sourceRoot.getByRole('button', { name: 'Regenerate', exact: true })).toBeDisabled()
  await sendChatMarker(page, 'Reply with SG_SOURCE_CONTINUED_17320.', 'SG_SOURCE_CONTINUED_17320', false)
  const sourceMessages = await graphMessages(page, sourceId)
  const historyContent = (messages: Message[]) =>
    messages.map(({ id, parentId, role, data }) => ({ id, parentId, role, data }))
  expect(historyContent(sourceMessages.filter(({ id }) => original.some((message) => message.id === id)))).toEqual(
    historyContent(original)
  )
  expect(sourceMessages.map(messageText).join('\n')).not.toContain('SG_VXLAN_16180')
  expect(sourceMessages.map(messageText).join('\n')).not.toContain('SG_ENCAPSULATION_14142')
  expect((await graphMessages(page, child.id)).map(messageText).join('\n')).not.toContain('SG_SOURCE_CONTINUED_17320')

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Chat')
  await openGraphTopic(page, grandchild.id)
  await expect(page.getByText('SG_ENCAPSULATION_14142', { exact: false }).last()).toBeVisible()
  await expect(page.getByText('Shared history', { exact: true })).toHaveCount(4)
  await expect.poll(() => categoryPaths(page, grandchild.id)).toEqual([`${category} / VXLAN`])
  expect(messageText(await graphData<Message>(page, `/messages/${childReply.id}`))).toBe(copiedText)
  await openGraphTopic(page, sourceId)
  await expect(page.getByText('SG_SOURCE_CONTINUED_17320', { exact: false }).last()).toBeVisible()
  await expect.poll(() => categoryPaths(page, sourceId)).toEqual([category])
})

test(...caseDefinition('SG-02'), async ({ app, mainWindow }) => {
  let page = mainWindow
  const prefix = app.resourceName(`Organization ${Date.now()}`)
  // Seed empty conversations, then exercise category writes and navigation through the UI.
  const rootTopic = (await seedGraphInput(page, 'POST', '/topics', { name: `${prefix} SDN` })) as Topic
  const childTopic = (await seedGraphInput(page, 'POST', '/topics', { name: `${prefix} VXLAN` })) as Topic
  const childText = `${prefix} VXLAN discussion`
  await seedGraphInput(page, 'POST', `/topics/${childTopic.id}/messages`, {
    role: 'user',
    data: { parts: [{ type: 'text', text: childText }] },
    status: 'success'
  })
  await page.evaluate(() => window.api.preference.set('topic.tab.display_mode', 'time'))
  await page.reload()
  await dismissOnboarding(page)
  await openGraphTopic(page, rootTopic.id)

  const root = `${prefix} Networks`
  const other = `${prefix} Protocols`
  let dialog = await openCategoryDialog(page, rootTopic.id)
  await createGraphCategory(page, dialog, root)
  await createGraphCategory(page, dialog, other)
  await createGraphCategory(page, dialog, 'Tunnels', root)
  await dialog.getByRole('searchbox', { name: 'Search category paths', exact: true }).fill(`${root} / Tunnels`)
  await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await dialog.getByRole('searchbox', { name: 'Search category paths', exact: true }).fill('')
  await dialog.getByRole('checkbox', { name: root, exact: true }).check()
  await saveGraphCategories(dialog)
  dialog = await openCategoryDialog(page, childTopic.id)
  await dialog.getByRole('checkbox', { name: `${root} / Tunnels`, exact: true }).check()
  await saveGraphCategories(dialog)

  dialog = await browseGraphTopics(page, root)
  await expect(dialog.getByRole('button', { name: `Open ${rootTopic.name}`, exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: `Open ${childTopic.name}`, exact: true })).toHaveCount(0)
  await dialog.getByRole('checkbox', { name: 'Include subcategories', exact: true }).check()
  await expect(dialog.getByRole('button', { name: `Open ${childTopic.name}`, exact: true })).toBeVisible()
  await dialog.getByRole('searchbox', { name: 'Search conversation titles', exact: true }).fill('VXLAN')
  await expect(dialog.getByRole('button', { name: `Open ${rootTopic.name}`, exact: true })).toHaveCount(0)
  const tabs = page.locator('[data-ui="app.tab-bar"] button[data-tab-id]')
  const tabsBefore = await tabs.count()
  await dialog.getByRole('button', { name: `Open ${childTopic.name}`, exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(tabs).toHaveCount(tabsBefore + 1)
  await expect(
    page.locator('[data-ui="app.tab-bar"]').getByRole('button', { name: childTopic.name, exact: true })
  ).toBeVisible()
  await expect(page.locator('[data-ui="chat.view"]:visible').getByText(childText, { exact: true })).toBeVisible()

  dialog = await openCategoryDialog(page, childTopic.id)
  await dialog.getByRole('button', { name: `Edit ${root} / Tunnels`, exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill('VXLAN')
  await chooseCategoryParent(page, dialog, other)
  await dialog.locator('form').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: `${other} / VXLAN`, exact: true })).toBeChecked()
  await saveGraphCategories(dialog)
  await expect.poll(() => categoryPaths(page, childTopic.id)).toEqual([`${other} / VXLAN`])

  const categories = await graphData<SessionGraphCategory[]>(page, '/session-graph/categories')
  const rootId = categories.find((category) => category.name === root)!.id
  // Persisted inputs exercise the browser's real cursor boundary beyond its first 50 results.
  for (let index = 0; index < 50; index++) {
    const topic = (await seedGraphInput(page, 'POST', '/topics', {
      name: `${prefix} Page ${String(index).padStart(2, '0')}`
    })) as Topic
    await seedGraphInput(page, 'PUT', `/topics/${topic.id}/session-graph-categories`, { categoryIds: [rootId] })
  }
  dialog = await browseGraphTopics(page, root)
  await expect(dialog.getByRole('button', { name: /^Open / })).toHaveCount(50)
  await dialog.getByRole('button', { name: 'Load more', exact: true }).click()
  await expect(dialog.getByRole('button', { name: /^Open / })).toHaveCount(51)
  await expect(dialog.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: other, exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: 'Include subcategories', exact: true })).not.toBeChecked()
  await expect(dialog.getByRole('searchbox', { name: 'Search conversation titles', exact: true })).toHaveValue('')
  await expect(dialog.getByText('No conversations match this category and search.', { exact: true })).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'Include subcategories', exact: true }).check()
  await expect(dialog.getByRole('button', { name: /^Open / })).toHaveCount(1)
  await expect(dialog.getByRole('button', { name: `Open ${childTopic.name}`, exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()

  page = await app.restart('authenticated')
  await dismissOnboarding(page)
  await selectSidebarApp(page, 'Chat')
  await expect.poll(() => categoryPaths(page, rootTopic.id)).toEqual([root])
  await expect.poll(() => categoryPaths(page, childTopic.id)).toEqual([`${other} / VXLAN`])
  dialog = await browseGraphTopics(page, other)
  await dialog.getByRole('checkbox', { name: 'Include subcategories', exact: true }).check()
  await dialog.getByRole('button', { name: `Open ${childTopic.name}`, exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-ui="chat.view"]:visible').getByText(childText, { exact: true })).toBeVisible()
})
