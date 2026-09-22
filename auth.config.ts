import type {
  NextAuthConfig,
} from "next-auth";

export const authConfig = {
  providers: [],

  pages: {
    signIn: "/login",
  },

  callbacks: {
    authorized({
      auth,
      request,
    }) {
      const isLoggedIn =
        Boolean(auth?.user);

      const pathname =
        request.nextUrl.pathname;

      const isDashboard =
        pathname.startsWith(
          "/dashboard",
        );

      const isAuthPage =
        pathname === "/login" ||
        pathname === "/register";

      if (isDashboard) {
        return isLoggedIn;
      }

      if (
        isAuthPage &&
        isLoggedIn
      ) {
        return Response.redirect(
          new URL(
            "/dashboard",
            request.nextUrl,
          ),
        );
      }

      return true;
    },
  },
} satisfies NextAuthConfig;