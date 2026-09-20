import { signOut } from "@/auth";
import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  async function logout() {
    "use server";

    await signOut({
      redirectTo: "/login",
    });
  }

  return <DashboardClient logoutAction={logout} />;
}