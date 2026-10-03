import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { useDataChange, useMutation, useQuery } from '@data/hooks/useDataApi'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { formatErrorMessage } from '@renderer/utils/error'
import {
  CreateSessionGraphCategorySchema,
  SetTopicCategoriesSchema
} from '@shared/data/api/schemas/sessionGraphCategories'
import type { SessionGraphCategory } from '@shared/data/types/sessionGraphCategory'

type Props = { topicId: string } & PopupInjectedProps<boolean>
type Editor = { id?: string; name: string; parentId: string | null }
const pathLabel = (category: SessionGraphCategory) => category.path.map((part) => part.name).join(' / ')

export function SessionCategoriesDialog({ topicId, open, resolve }: Props) {
  const { t } = useTranslation()
  const nameId = useId()
  const parentId = useId()
  const categories = useQuery('/session-graph/categories')
  const assigned = useQuery('/topics/:topicId/session-graph-categories', {
    params: { topicId },
    swrOptions: { keepPreviousData: false }
  })
  const { trigger: createCategory } = useMutation('POST', '/session-graph/categories')
  const { trigger: updateCategory } = useMutation('PATCH', '/session-graph/categories/:id')
  const { trigger: deleteCategory } = useMutation('DELETE', '/session-graph/categories/:id')
  const { trigger: setCategories } = useMutation('PUT', '/topics/:topicId/session-graph-categories')
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ topicId: string; ids: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = () => Promise.allSettled([categories.refetch(), assigned.refetch()])
  useDataChange('/session-graph/categories', () => void refresh())
  useDataChange('/topics/:topicId/session-graph-categories', () => void refresh(), { routeParams: { topicId } })
  useDataChange(['/topics', '/topics/:id'], () => void refresh(), { routeParams: { id: topicId } })

  const all = categories.data ?? []
  const ready = categories.data !== undefined && assigned.data !== undefined && !categories.error && !assigned.error
  const selected = (draft?.topicId === topicId ? draft.ids : (assigned.data ?? []).map((item) => item.id)).filter(
    (id) => all.some((item) => item.id === id)
  )
  const visible = all.filter((item) => pathLabel(item).toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const parents = all.filter((item) => !editor?.id || !item.path.some((part) => part.id === editor.id))
  const deleting = all.find((item) => item.id === deleteId)
  const editorBody = editor && { name: editor.name, parentId: editor.parentId }
  const editorValid = editorBody && CreateSessionGraphCategorySchema.safeParse(editorBody).success
  const editorParentValid = editor?.parentId === null || parents.some((item) => item.id === editor?.parentId)

  const perform = async (action: () => Promise<unknown>, onSuccess: () => void) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onSuccess()
      await refresh()
    } catch (cause) {
      setError(formatErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const saveEditor = () => {
    if (!editor || !editorValid || !editorParentValid || !ready || busy) return
    const body = CreateSessionGraphCategorySchema.parse(editorBody)
    void perform(
      () => (editor.id ? updateCategory({ params: { id: editor.id }, body }) : createCategory({ body })),
      () => setEditor(null)
    )
  }
  const saveSelection = () => {
    if (!ready || busy) return
    void perform(
      () => setCategories({ params: { topicId }, body: SetTopicCategoriesSchema.parse({ categoryIds: selected }) }),
      () => resolve(true)
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && resolve(false)}>
      <DialogContent
        className="max-h-[85vh] gap-4 sm:max-w-2xl"
        closeOnOverlayClick={!busy}
        onEscapeKeyDown={(event) => busy && event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('session_graph.categories.title')}</DialogTitle>
          <DialogDescription>{t('session_graph.categories.hint')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto">
          {categories.error || assigned.error ? (
            <div role="alert" className="mb-3 text-error-subtle-foreground">
              {t('session_graph.categories.load_failed')}
              <Button variant="ghost" onClick={() => void refresh()} disabled={busy}>
                {t('common.retry')}
              </Button>
            </div>
          ) : !ready ? (
            <p role="status">{t('session_graph.categories.loading')}</p>
          ) : null}
          {error && (
            <p role="alert" className="mb-3 text-error-subtle-foreground">
              {error}
            </p>
          )}
          <div className="mb-3 flex items-center gap-2">
            <Input
              type="search"
              aria-label={t('session_graph.categories.search')}
              placeholder={t('session_graph.categories.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              disabled={!ready || busy}
            />
            <Button
              variant="outline"
              disabled={!ready || busy}
              onClick={() => {
                setDeleteId(null)
                setEditor({ name: '', parentId: null })
              }}>
              {t('session_graph.categories.new')}
            </Button>
          </div>
          {editor && (
            <form
              className="mb-3 space-y-3 rounded-md border border-border p-3"
              onSubmit={(event) => {
                event.preventDefault()
                saveEditor()
              }}>
              <div className="space-y-1">
                <Label htmlFor={nameId}>{t('common.name')}</Label>
                <Input
                  id={nameId}
                  value={editor.name}
                  maxLength={64}
                  required
                  disabled={busy}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={parentId}>{t('session_graph.categories.parent')}</Label>
                <Select
                  value={editor.parentId ?? 'root'}
                  disabled={busy}
                  onValueChange={(value) => setEditor({ ...editor, parentId: value === 'root' ? null : value })}>
                  <SelectTrigger id={parentId} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">{t('session_graph.categories.root')}</SelectItem>
                    {parents.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {pathLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditor(null)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={!ready || busy || !editorValid || !editorParentValid}>
                  {t('common.save')}
                </Button>
              </div>
            </form>
          )}
          {deleting && (
            <div className="mb-3 space-y-2 rounded-md border border-border p-3">
              <p>{t('session_graph.categories.delete_confirm', { path: pathLabel(deleting) })}</p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setDeleteId(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="destructive"
                  disabled={!ready || busy}
                  onClick={() =>
                    void perform(
                      () => deleteCategory({ params: { id: deleting.id } }),
                      () => setDeleteId(null)
                    )
                  }>
                  {t('common.confirm')}
                </Button>
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto rounded-md border border-border">
            {visible.map((item) => {
              const path = pathLabel(item)
              const checked = selected.includes(item.id)
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 border-b border-border-subtle px-3 py-2 last:border-b-0">
                  <Checkbox
                    aria-label={path}
                    checked={checked}
                    disabled={!ready || busy || (!checked && selected.length >= 100)}
                    onCheckedChange={(value) =>
                      setDraft({
                        topicId,
                        ids: value === true ? [...selected, item.id] : selected.filter((id) => id !== item.id)
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate" title={path}>
                    {path}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('session_graph.categories.edit_named', { path })}
                    disabled={!ready || busy}
                    onClick={() => {
                      setDeleteId(null)
                      setEditor({ id: item.id, name: item.name, parentId: item.parentId })
                    }}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('session_graph.categories.delete_named', { path })}
                    disabled={!ready || busy}
                    onClick={() => {
                      setEditor(null)
                      setDeleteId(item.id)
                    }}>
                    {t('common.delete')}
                  </Button>
                </div>
              )
            })}
            {ready && visible.length === 0 && (
              <p className="p-3 text-muted-foreground">
                {t(all.length ? 'session_graph.categories.no_matches' : 'session_graph.categories.empty')}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="items-center">
          <span className="mr-auto text-sm text-muted-foreground">
            {t('session_graph.categories.selected', { count: selected.length })}
          </span>
          <Button variant="outline" disabled={busy} onClick={() => resolve(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={busy}
            disabled={!ready || busy || editor !== null || deleting !== undefined}
            onClick={saveSelection}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SessionCategoriesPopup = createPopup<{ topicId: string }, boolean>(SessionCategoriesDialog, {
  dismissResult: false
})
export default SessionCategoriesPopup
