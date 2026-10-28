import { registry } from '@generated/registry'
import { createTuyau } from '@tuyau/core/client'

export const client = createTuyau({
  baseUrl: '/',
  registry,
})

export const urlFor = client.urlFor

function xsrfToken() {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

/**
 * Posts JSON to the app outside Inertia and reads the JSON answer, with
 * its status. Null when the answer isn't JSON: a refusal or an expired
 * session answers with a redirect to a page.
 */
export async function postJson<T>(url: string, body: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-XSRF-TOKEN': xsrfToken(),
    },
    body: JSON.stringify(body),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) return null
  return { status: response.status, data: (await response.json()) as T }
}
