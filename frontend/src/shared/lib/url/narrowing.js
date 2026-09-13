/**
 * What a list is narrowed by, as one query parameter.
 *
 * `narrow=kind:Image;owner:robin@zzmock.test` — a flat `{key: value}` set,
 * each half escaped, readable before you follow the link. That last part is
 * the whole reason it is not JSON: a person should be able to see what a link
 * does from the link.
 *
 * This was written inside `onemobility/lib/facets.js` for the facet bar and is
 * here because the Drive is the second caller, which is the moment it stops
 * being that module's business — `docs/UNIFICATION.md` §F1 is a list of
 * abstractions built at the second caller and abandoned at the third, and the
 * cheapest time to not do that again is now.
 *
 * What each surface keeps is *what it narrows by*: the mobility space asks the
 * server for its dimensions, the Drive declares a list. This is only the
 * spelling of the set in the address bar.
 *
 * `docs/UNIFICATION.md` §B2, §C4.
 */
import { ref } from 'vue'

import { useAddress } from '@/shared/composables/useAddress'

/** `{kind: 'Image'}` → `kind:Image`, each half escaped. */
export function written(what) {
  return Object.entries(what || {})
    .filter(([, value]) => value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}:${encodeURIComponent(value)}`)
    .join(';')
}

/** And back. A pair with no colon in it is dropped rather than guessed at. */
export function read(text) {
  const found = {}
  for (const pair of (text || '').split(';')) {
    if (!pair) continue
    const at = pair.indexOf(':')
    if (at < 1) continue
    found[decodeURIComponent(pair.slice(0, at))] = decodeURIComponent(pair.slice(at + 1))
  }
  return found
}

/**
 * One surface's narrowing, bound to the address.
 *
 * `into` is where it is kept — a module-level ref where a whole space shares
 * one narrowing, and a local one where it belongs to the surface. The mobility
 * space passes its own, which is what makes the map and the charts agree about
 * what you are looking at.
 */
export function useNarrowing(into = null) {
  const chosen = into || ref({})
  useAddress('narrow', {
    read: () => written(chosen.value),
    write: (value) => { chosen.value = read(value) },
  })
  return chosen
}
