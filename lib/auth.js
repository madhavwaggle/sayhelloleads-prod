/**
 * lib/auth.js — NextAuth with email verification gate
 */

import CredentialsProvider from 'next-auth/providers/credentials';
import { getUserByEmail, verifyPassword } from './users';

export const authOptions = {
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await getUserByEmail(credentials.email);
        if (!user) return null;

        const valid = await verifyPassword(user, credentials.password);
        if (!valid) return null;

        // Block login if email not verified
        if (!user.emailVerified) {
          // Throw a specific error NextAuth will surface as a URL param
          throw new Error('EMAIL_NOT_VERIFIED');
        }

        return {
          id:         user.id,
          email:      user.email,
          name:       user.name,
          agencyName: user.agencyName || '',
        };
      },
    }),
  ],

  pages: { signIn: '/login', error: '/login' },
  session: { strategy: 'jwt', maxAge: 30 * 24 * 60 * 60 },

  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id         = user.id;
        token.agencyName = user.agencyName;
      }
      // Handle updateSession() calls from the client (e.g. after profile name save)
      if (trigger === 'update' && session?.name) {
        token.name = session.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id         = token.id;
        session.user.agencyName = token.agencyName;
      }
      return session;
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};
