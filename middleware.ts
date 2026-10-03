import { NextResponse, type NextRequest } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

const THIRTY_DAYS = 60 * 60 * 24 * 30;

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  if (!req.cookies.get('sr_sid')) {
    res.cookies.set('sr_sid', uuidv4(), {
      path: '/',
      maxAge: THIRTY_DAYS,
      sameSite: 'lax',
    });
  }
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
