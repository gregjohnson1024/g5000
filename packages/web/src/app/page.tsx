import { redirect } from 'next/navigation';

/**
 * Home (`/`) redirects to `/sail` (the SAIL section default, formerly /helm).
 * Legacy /helm is redirected via next.config redirects() in Task 2f.
 */
export default function Home(): never {
  redirect('/sail');
}
