import { redirect } from 'next/navigation';

export default function MarksAndRoutesRedirect(): never {
  redirect('/waypoints');
}
