import { redirect } from "next/navigation";

/** The app opens on the machines. */
export default function AppHome() {
  redirect("/app/play");
}
