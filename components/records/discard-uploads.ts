import { RECORD_FILES_MAX } from '@/lib/record-files'

/**
 * Files uploaded for a record that isn't saved with them: removed again,
 * without waiting (DELETE /api/records/uploads).
 *
 * As many to a request as the route takes, a record's worth. A form can
 * upload more than that across saves that fail, with files taken off and
 * others added in between, and one request for them all was refused whole,
 * leaving every one of them in storage.
 */
export function discardUploads(urls: readonly string[]) {
    for (let i = 0; i < urls.length; i += RECORD_FILES_MAX) {
        void fetch('/api/records/uploads', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ urls: urls.slice(i, i + RECORD_FILES_MAX) }),
            keepalive: true,
        }).catch(() => {})
    }
}
