/**
 * Extract the hostname from a given URL, or null if the URL is invalid.
 */
export function getHostnameFromUrl(url: string): string | null {
    try {
        const hostname = new URL(url).hostname;
        if (!hostname || hostname.split('.').join('') === '') {
            return null;
        }

        return hostname;
    } catch {
        return null;
    }
}

export function getPathFromUrl(url: string): string | null {
    try {
        const path = new URL(url).pathname;
        return path || null;
    } catch {
        return null;
    }
} 