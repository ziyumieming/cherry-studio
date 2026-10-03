import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label
} from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery, useQuery } from '@data/hooks/useDataApi'
import { useConversationNavigation } from '@renderer/hooks/useConversationNavigation'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { formatErrorMessage } from '@renderer/utils/error'
import type { SessionGraphCategory } from '@shared/data/types/sessionGraphCategory'
import type { Topic } from '@shared/data/types/topic'

export type SessionCategoryTopicSelection = { categoryId: string; topic: Topic }
type PickerProps = {
  onSelect: (selection: SessionCategoryTopicSelection) => void | Promise<void>
  onCancel: () => void
}

function CategoryTopicResults({
  category,
  onSelect
}: {
  category: SessionGraphCategory
  onSelect: PickerProps['onSelect']
}) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [descendants, setDescendants] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    []
  )
  const query = useMemo(
    () => ({ sessionGraphCategoryId: category.id, includeCategoryDescendants: descendants, q: search.trim() }),
    [category.id, descendants, search]
  )
  const topics = useInfiniteQuery('/topics', { query, limit: 50, swrOptions: { keepPreviousData: false } })
  useDataChange(
    [
      '/topics',
      '/topics/:id',
      '/topics/:topicId/session-graph-categories',
      '/session-graph/categories/:id/topics',
      '/session-graph/categories'
    ],
    () => void topics.refresh()
  )
  const items = useInfiniteFlatItems(topics.pages)
  const ready = topics.pages.length > 0 && !topics.error && !topics.isLoading
  const select = async (topic: Topic) => {
    if (busy || !ready) return
    setBusy(true)
    setError(null)
    const token = ++request.current
    try {
      // Recheck the active category membership before navigating from a potentially stale list.
      const current = await dataApiService.get('/topics', {
        query: {
          sessionGraphCategoryId: category.id,
          includeCategoryDescendants: descendants,
          ids: [topic.id],
          limit: 1
        }
      })
      if (token !== request.current) return
      if (!current.items.length) throw new Error(t('session_graph.candidates.unavailable'))
      await onSelect({ categoryId: category.id, topic: current.items[0] })
    } catch (cause) {
      if (token !== request.current) return
      setError(formatErrorMessage(cause))
      void topics.refresh()
    } finally {
      if (token === request.current) setBusy(false)
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <p className="break-words font-medium">{category.path.map((part) => part.name).join(' / ')}</p>
      <Label className="flex items-center gap-2">
        <Checkbox checked={descendants} disabled={busy} onCheckedChange={(value) => setDescendants(value === true)} />
        {t('session_graph.candidates.descendants')}
      </Label>
      <Input
        type="search"
        aria-label={t('session_graph.candidates.search')}
        placeholder={t('session_graph.candidates.search')}
        value={search}
        disabled={busy}
        onChange={(event) => setSearch(event.target.value)}
      />
      {topics.error ? (
        <div role="alert" className="text-error-subtle-foreground">
          {t('session_graph.candidates.load_failed')}
          <Button variant="ghost" disabled={busy} onClick={() => void topics.refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !ready ? (
        <p role="status">{t('session_graph.categories.loading')}</p>
      ) : null}
      {error && (
        <p role="alert" className="text-error-subtle-foreground">
          {error}
        </p>
      )}
      <div className="max-h-72 space-y-1 overflow-y-auto" aria-busy={topics.isRefreshing || busy}>
        {ready &&
          items.map((topic) => (
            <Button
              key={topic.id}
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal text-left"
              disabled={busy}
              aria-label={t('session_graph.candidates.open_named', { name: topic.name || t('common.unnamed') })}
              onClick={() => void select(topic)}>
              <span className="min-w-0">
                <span className="block break-words">{topic.name || t('common.unnamed')}</span>
                <span className="block text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
                    new Date(topic.lastActivityAt)
                  )}
                </span>
              </span>
            </Button>
          ))}
        {ready && !items.length && <p className="text-muted-foreground">{t('session_graph.candidates.empty')}</p>}
      </div>
      {ready && topics.hasNext && (
        <Button
          variant="outline"
          loading={topics.isRefreshing}
          disabled={busy || topics.isRefreshing}
          onClick={topics.loadNext}>
          {t('session_graph.candidates.more')}
        </Button>
      )}
    </div>
  )
}

export function SessionCategoryTopicsPicker({ onSelect, onCancel }: PickerProps) {
  const { t } = useTranslation()
  const categories = useQuery('/session-graph/categories')
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const cancelled = useRef(false)
  useDataChange('/session-graph/categories', () => void categories.refetch())
  const ready = categories.data !== undefined && !categories.error
  const all = categories.data ?? []
  const selected = ready ? all.find((category) => category.id === categoryId) : undefined
  const visible = all.filter((category) =>
    category.path
      .map((part) => part.name)
      .join(' / ')
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  )
  return (
    <div className="space-y-4">
      {categories.error ? (
        <div role="alert" className="text-error-subtle-foreground">
          {t('session_graph.categories.load_failed')}
          <Button variant="ghost" onClick={() => void categories.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !ready ? (
        <p role="status">{t('session_graph.categories.loading')}</p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[2fr_3fr]">
        <div className="min-w-0 space-y-3">
          <Input
            type="search"
            aria-label={t('session_graph.categories.search')}
            placeholder={t('session_graph.categories.search')}
            value={search}
            disabled={!ready}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {ready &&
              visible.map((category) => (
                <Button
                  key={category.id}
                  variant={category.id === selected?.id ? 'secondary' : 'ghost'}
                  className="h-auto w-full justify-start whitespace-normal break-words text-left"
                  aria-pressed={category.id === selected?.id}
                  onClick={() => setCategoryId(category.id)}>
                  {category.path.map((part) => part.name).join(' / ')}
                </Button>
              ))}
            {ready && !visible.length && (
              <p className="text-muted-foreground">
                {t(all.length ? 'session_graph.categories.no_matches' : 'session_graph.categories.empty')}
              </p>
            )}
          </div>
        </div>
        {selected ? (
          <CategoryTopicResults
            key={selected.id}
            category={selected}
            onSelect={(selection) => {
              if (!cancelled.current) return onSelect(selection)
            }}
          />
        ) : (
          <p className="text-muted-foreground">{t('session_graph.candidates.choose')}</p>
        )}
      </div>
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={() => {
            cancelled.current = true
            onCancel()
          }}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}

export function SessionCategoryTopicsDialog({
  open,
  resolve
}: PopupInjectedProps<SessionCategoryTopicSelection | null>) {
  const { t } = useTranslation()
  const navigation = useConversationNavigation('assistants')
  const closing = useRef(false)
  const dismiss = () => {
    closing.current = true
    resolve(null)
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('session_graph.candidates.title')}</DialogTitle>
          <DialogDescription>{t('session_graph.candidates.hint')}</DialogDescription>
        </DialogHeader>
        <SessionCategoryTopicsPicker
          onCancel={dismiss}
          onSelect={(selection) => {
            if (closing.current) return
            navigation.openConversation(selection.topic.id, selection.topic.name)
            resolve(selection)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

export default createPopup<{}, SessionCategoryTopicSelection | null>(SessionCategoryTopicsDialog, {
  dismissResult: null
})
