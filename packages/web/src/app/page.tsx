import { redirect } from 'next/navigation';

/**
 * Home (`/`) is just a redirect to `/helm`. The helm is the primary view
 * for active passages — wanting the boat's live values on landing matches
 * how the app actually gets used. /helm stays as a canonical URL so
 * existing bookmarks keep working.
 */
export default function Home(): never {
  redirect('/helm');
}
