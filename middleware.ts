import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function middleware(req: NextRequest) {
  if (req.cookies.get('sr_sid')) return NextResponse.next();
  const sid = uuidv4();
  // Also set it on the request so route handlers see the id on the very first request.
  req.cookies.set('sr_sid', sid);
  const res = NextResponse.next({ request: { headers: req.headers } });
  res.cookies.set('sr_sid', sid, { path: '/', maxAge: THIRTY_DAYS, sameSite: 'lax' });
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
