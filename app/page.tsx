import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/firebase/session";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/list" : "/sign-in");
}
