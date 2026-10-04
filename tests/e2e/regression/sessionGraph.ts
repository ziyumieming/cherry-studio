import { expect, type Locator, type Page } from '@playwright/test'

import type { HttpMethod } from '../../../src/shared/data/api/types'
import type { BranchMessagesResponse, Message } from '../../../src/shared/data/types/message'
import type { SessionGraphCategory } from '../../../src/shared/data/types/sessionGraphCategory'
import type { Topic } from '../../../src/shared/data/types/topic'

export async function graphData<T>(page: Page, path: string, query?: Record<string, unknown>): Promise<T> {
  const response = await page.evaluate(
    ({ path, query }) =>
      window.api.dataApi.request({
        id: `graph-read-${Date.now()}`,
        method: 'GET',
        path,
        params: query
      }),
    { path, query }
  )
  expect(response.status, path).toBe(200)
  return response.data as T
}

export async function seedGraphInput(page: Page, method: HttpMethod, path: string, body: object): Promise<unknown> {
  const response = await page.evaluate(
    ({ method, path, body }) => window.api.dataApi.request({ id: `graph-fixture-${Date.now()}`, method, path, body }),
    { method, path, body }
  )
  expect(response.status, path).toBeGreaterThanOrEqual(200)
  expect(response.status, path).toBeLessThan(300)
  return response.data
}

export function topicRow(page: Page, id: string): Locator {
  return page.locator(`[data-testid="topic-list-row"][id="resource-list-option-${encodeURIComponent(id)}"]:visible`)
}

export async function openGraphTopic(page: Page, id: string): Promise<void> {
  await topicRow(page, id).click()
  await expect(topicRow(page, id)).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('[data-ui~="chat.composer"]:visible')).toBeVisible()
}

export async function renameGraphTopic(page: Page, id: string, name: string): Promise<void> {
  await topicRow(page, id).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit conversation name', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit conversation name', exact: true })
  const input = dialog.getByRole('textbox', { name: 'Name', exact: true })
  await input.fill(name)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(async () => (await graphData<Topic>(page, `/topics/${id}`)).name).toBe(name)
}

export async function openCategoryDialog(page: Page, topicId: string): Promise<Locator> {
  await topicRow(page, topicId).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Session categories', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Session categories', exact: true })
  await expect(dialog.getByRole('button', { name: 'New category', exact: true })).toBeEnabled()
  return dialog
}

export async function chooseCategoryParent(page: Page, dialog: Locator, path: string): Promise<void> {
  await dialog.getByRole('combobox', { name: 'Parent category', exact: true }).click()
  await page.getByRole('option', { name: path, exact: true }).click()
}

export async function createGraphCategory(page: Page, dialog: Locator, name: string, parent?: string): Promise<void> {
  await dialog.getByRole('button', { name: 'New category', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Name', exact: true }).fill(name)
  if (parent) await chooseCategoryParent(page, dialog, parent)
  await dialog.locator('form').getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.locator('form')).toHaveCount(0)
  await expect(dialog.getByRole('checkbox', { name: parent ? `${parent} / ${name}` : name, exact: true })).toBeVisible()
}

export async function saveGraphCategories(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toBeHidden()
}

export async function categoryPaths(page: Page, topicId: string): Promise<string[]> {
  const categories = await graphData<SessionGraphCategory[]>(page, `/topics/${topicId}/session-graph-categories`)
  return categories.map((category) => category.path.map(({ name }) => name).join(' / ')).sort()
}

export async function browseGraphTopics(page: Page, category: string): Promise<Locator> {
  await page.locator('[data-testid="topic-list-row"]:visible').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Browse conversations by category', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Browse conversations by category', exact: true })
  await dialog.getByRole('button', { name: category, exact: true }).click()
  await expect(dialog.getByRole('searchbox', { name: 'Search conversation titles', exact: true })).toBeEnabled()
  return dialog
}

export async function forkGraphReply(page: Page, messageId: string): Promise<Topic> {
  const before = (await graphData<{ items: Topic[] }>(page, '/topics', { limit: 200 })).items.map(({ id }) => id)
  const message = page.locator(`[data-ui~="chat.message"][data-message-id="${messageId}"]:visible`)
  await message.hover()
  await message.getByRole('button', { name: 'More actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Copy as New Conversation', exact: true }).click()
  let created: Topic[] = []
  await expect
    .poll(async () => {
      created = (await graphData<{ items: Topic[] }>(page, '/topics', { limit: 200 })).items.filter(
        ({ id }) => !before.includes(id)
      )
      return created.length
    })
    .toBe(1)
  return created[0]
}

export async function graphMessages(page: Page, topicId: string): Promise<Message[]> {
  return (await graphData<BranchMessagesResponse>(page, `/topics/${topicId}/messages`, { limit: 100 })).items.map(
    ({ message }) => message
  )
}

export function messageText(message: Message): string {
  expect(message.data.parts).toBeDefined()
  return message.data
    .parts!.filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}
