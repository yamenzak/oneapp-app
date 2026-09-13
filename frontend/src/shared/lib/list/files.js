/**
 * Where a list of *files* comes from.
 *
 * One source for every file surface in the product, because there is one
 * query behind all of them. `onestorage/reading.listing` takes a place —
 * home, recents, favourites, shared, templates, trash, all, record — and a
 * folder, and a record's Files tab is the `record` place with a doctype and a
 * name on it. That was already true on the server and §E1 is the note that it
 * was not true in the browser: the Drive, the record tab and the picker each
 * wrote their own skeleton, their own empty state and their own paging over
 * the same call.
 *
 * So the fetch is here and the frame is `components/DataList.vue`. What a
 * caller still owns is what it *does* with a row — the Drive selects and
 * moves and trashes, the picker chooses, the record tab attaches — which is
 * the half that really is different.
 *
 * A folder on somebody else's server is the same source with a `remote://`
 * folder: `listing` branches to an FTP socket and answers in the same shape.
 * What it cannot do it refuses through `can`, which the caller declares,
 * because only the caller knows it is looking at a mount.
 *
 * There is one other door, and it is on the server rather than here. A
 * record's Files tab goes through `spaceview.attachments` instead of
 * `listing`, because two of the things it needs are things the browser may
 * not be trusted to send: which doctype a screen is (`_attachable` decides,
 * and it is also the permission check) and which of a record's files belong
 * to *this* Attachment Gallery (read off the docfield's own `link_filters`).
 * A client that could send either could read any `File` row on the site. So
 * the caller passes `record` and the source knocks on that door instead; the
 * answer is in the same shape and everything above it is unchanged.
 *
 * `docs/UNIFICATION.md` §B1.
 */
import { unref } from 'vue'

import { CAN, offers } from '@/shared/lib/capability'
import { KIND_VALUES, labelForKind } from '@/modules/onestorage/lib/files'
import { __ } from '@/shared/lib/runtime/translate'
import { workspace } from '@/shared/lib/workspace'

/** How many rows one page is. The server caps at this, so asking for more is asking for this. */
export const PAGE = 50

/**
 * What a file place can be narrowed by — §B2's "a declared list for a file
 * place", which `Narrow.vue` has named in its own docstring since it was
 * written and which nothing ever declared.
 *
 * The Drive was the same frame as every list and a tenth of the chrome, for
 * one reason: `recordSource` declares thirteen capabilities and this one
 * declared three, and `DataList` draws what the source offers. It was not a
 * different engine. It was a thinner sentence.
 *
 * **Kind** first because `kinds.py` opens by saying what a kind is *for* — "a
 * file manager's first question is 'show me the drawings', and the answer has
 * to be a column" — and the column has been there, indexed and filtered by
 * `listing(kind=…)`, since that module was written. No surface ever offered
 * it. **Owner** second because it is the other question people ask of a
 * shared drive, and it costs one clause.
 *
 * `load` rather than `options` for the owner: a workspace's people is a list
 * the server holds and a set too big to send is what `load` is for.
 */
export const FILE_FIELDS = [
  {
    key: 'kind',
    label: __('Kind'),
    options: KIND_VALUES.map((kind) => ({ label: labelForKind(kind), value: kind })),
  },
  {
    key: 'owner',
    label: __('Added by'),
    load: async (query) => {
      const people = (await workspace.members().catch(() => null))?.members || []
      const asked = String(query || '').toLowerCase()
      return people
        .filter((one) => !asked || `${one.full_name || ''} ${one.name || ''}`
          .toLowerCase().includes(asked))
        .map((one) => ({ label: one.full_name || one.name, value: one.name }))
    },
  },
]

/**
 * Files, from the one file query.
 *
 * Everything but `place` is optional and every one of them may be a ref: a
 * Drive that walks into a folder and a tab that follows the record it is on
 * both change what they are asking for without building a new source.
 *
 * `onAnswer` is how the caller gets the parts of the answer that are not
 * rows — the path to the folder, whether this place may be written to, which
 * order is actually in force. They belong to the caller because they are
 * drawn outside the list: a breadcrumb is not a row.
 */
export function fileSource({
  place,
  folder = '',
  attachedTo = null,
  record = null,
  kind = '',
  //: `{kind, owner}` — what `FILE_FIELDS` sets, straight through to the query.
  //: A ref, because the bar changes it without rebuilding the source.
  narrow = null,
  sort = '',
  descending = false,
  can = {},
  empty = {},
  keep = null,
  onAnswer = null,
} = {}) {
  //: Rows the caller cannot use, dropped after the page arrives.
  //:
  //: A post-filter and not a `where`, because these are not things `listing`
  //: can be asked. The picker refuses folders — you cannot attach one — and
  //: refuses anything outside the extensions its caller declared, and an
  //: extension is a suffix on `file_name` rather than a column. The cost is
  //: that a page can come back shorter than it was asked for, which is
  //: honest: the alternative is a list that offers rows the caller will
  //: reject.
  const kept = (rows) => (keep ? rows.filter(keep) : rows)
  return {
    identify: (file) => file.name,
    empty,

    //: Search, sort and paging come from the query itself. Anything else —
    //: bulk, create, delete — is the caller's to declare, because the same
    //: query is read-only over a mount and writable at home.
    can: offers({
      // The record door takes neither: `attachments` narrows by the
      // docfield's own filter and orders by when a file arrived, and a box
      // that searched nothing would be a box that looks broken.
      ...(record ? {} : {
        [CAN.SEARCH]: true,
        [CAN.SORT]: true,
        //: Only where the caller hands in somewhere to keep it. A bar over a
        //: source that drops what it is set to is a control that does nothing.
        ...(narrow ? { [CAN.FILTER]: true } : {}),
      }),
      [CAN.PAGE]: true,
      ...can,
    }),

    async load({ start = 0, pageLength = PAGE, search = '', orderBy = '' } = {}) {
      const about = unref(record)
      if (about) {
        // A record place with no record is every attachment on the site.
        // The server refuses it; there is no reason to ask.
        if (!about.name) return { rows: [], total: 0, hasMore: false }
        const found = await workspace.attachments(
          about.spaceCode, about.screen, about.name, about.fieldname || '',
          { start, limit: pageLength || PAGE },
        )
        onAnswer?.(found || {})
        return {
          rows: kept(found?.files || []),
          total: found?.total,
          hasMore: !!found?.more,
        }
      }

      const on = unref(attachedTo) || {}
      const narrowed = unref(narrow) || {}
      const found = await workspace.driveList({
        place: unref(place),
        folder: unref(folder) || '',
        // The bar's answer wins over the caller's fixed one: the picker pins a
        // kind it will accept and nothing draws a bar over it, so the two
        // never both apply.
        kind: narrowed.kind || unref(kind) || '',
        owner: narrowed.owner || '',
        search,
        start,
        limit: pageLength || PAGE,
        // The frame asks for an order when it has a control for one; until
        // `DoctypeSource` brings that control, the order is the caller's and
        // it hands it in as a ref. Either way it is a key from an allowlist,
        // never a string that reaches `order_by`.
        sort: orderBy || unref(sort) || '',
        descending: unref(descending) ? 1 : 0,
        doctype: on.doctype || '',
        docname: on.docname || '',
      })
      onAnswer?.(found || {})
      const rows = kept(found?.files || [])
      // `listing` answers "is there another page", not "how many are there".
      // A count would be a second query over the same filters on every page,
      // and no file surface draws one — so the source does not claim `count`
      // and the frame does not draw it.
      return { rows, hasMore: !!found?.more }
    },
  }
}
